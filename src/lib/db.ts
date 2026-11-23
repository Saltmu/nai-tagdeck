import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DictEntry } from '../types';
import { LEGACY_DRESS_STATE_CATEGORY } from './categories';
import type { TabSyncType } from './tabSync';

type StoredDictEntry = Omit<DictEntry, 'category'> & {
  category: DictEntry['category'] | typeof LEGACY_DRESS_STATE_CATEGORY;
};

/** DB 全体の同期メタデータ。すべての書き込み・全削除で単調増加する。 */
export interface SyncMeta {
  rev: number;
  epoch: number;
}

interface TagDeckDB extends DBSchema {
  dictionary: { key: string; value: StoredDictEntry };
  kv: { key: string; value: unknown };
  meta: { key: 'sync'; value: SyncMeta };
}

const DB_NAME = 'nai-tagdeck';
const SYNC_META_KEY = 'sync' as const;

/**
 * 版 2 で同期メタ専用の meta ストアを追加し、ガード未導入の版 1 タブからの書き込みを拒む。
 */
export const DB_VERSION = 2;

/** IndexedDB の kv ストアにアプリが書くキー。 */
export const KV_KEYS = ['workspace', 'settings', 'generation', 'presets', 'activePreset'] as const;
export type KVKey = (typeof KV_KEYS)[number];

/** 他タブの更新・全削除により、このタブが認識しているリビジョンが古くなったときのエラー。 */
export class StaleWriteError extends Error {
  readonly name = 'StaleWriteError';
  constructor(readonly reason: TabSyncType) {
    super(
      reason === 'reset'
        ? '別のタブですべてのデータが削除されました'
        : '保存が別のタブの更新より古くなっています',
    );
  }
}

export interface AppDataSnapshot {
  dictionary: DictEntry[];
  kv: Record<KVKey, unknown>;
  meta: SyncMeta;
}

export interface AppDataReplacement {
  dictionary: readonly DictEntry[];
  kv: Record<KVKey, unknown>;
}

let dbPromise: Promise<IDBPDatabase<TagDeckDB>> | null = null;
let baseMeta: SyncMeta | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
let dbBlocked = false;
const blockedListeners = new Set<(blocked: boolean) => void>();

function notifyBlocked(blocked: boolean): void {
  if (dbBlocked === blocked) return;
  dbBlocked = blocked;
  for (const listener of blockedListeners) listener(blocked);
}

/** 版 1 の旧タブが閉じないためアップグレード待ちになっている状態を購読する。 */
export function subscribeDbBlocked(listener: (blocked: boolean) => void): () => void {
  blockedListeners.add(listener);
  listener(dbBlocked);
  return () => { blockedListeners.delete(listener); };
}

function emptyMeta(): SyncMeta {
  return { rev: 0, epoch: 0 };
}

function normalizeMeta(raw: unknown): SyncMeta {
  if (!raw || typeof raw !== 'object') return emptyMeta();
  const meta = raw as Partial<SyncMeta>;
  return {
    rev: typeof meta.rev === 'number' && Number.isFinite(meta.rev) ? meta.rev : 0,
    epoch: typeof meta.epoch === 'number' && Number.isFinite(meta.epoch) ? meta.epoch : 0,
  };
}

function advanceBaseMeta(next: SyncMeta): void {
  if (
    !baseMeta ||
    next.epoch > baseMeta.epoch ||
    (next.epoch === baseMeta.epoch && next.rev >= baseMeta.rev)
  ) {
    baseMeta = next;
  }
}

function compareMeta(current: SyncMeta, expected: SyncMeta | null): TabSyncType | null {
  if (!expected) return null;
  if (current.epoch !== expected.epoch) return 'reset';
  if (current.rev !== expected.rev) return 'updated';
  return null;
}

function mapStoredEntries(entries: StoredDictEntry[]): DictEntry[] {
  return entries.map(({ category, ...entry }) => ({
    ...entry,
    category: category === LEGACY_DRESS_STATE_CATEGORY ? 'outfit' : category,
  }));
}

/** 同一タブ内の複数ストア書き込みが自己競合しないよう、書き込みを 1 本のキューに直列化する。 */
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** openDB モックが transaction を持たないテスト（tests/db.test.ts）向けの最小型。 */
interface MinimalDB {
  get(store: 'dictionary' | 'kv' | 'meta', key: string): Promise<unknown>;
  getAll?(store: 'dictionary' | 'kv'): Promise<StoredDictEntry[]>;
  put(store: 'dictionary' | 'kv' | 'meta', value: unknown, key?: string): Promise<unknown>;
  delete?(store: 'dictionary' | 'kv', key: string): Promise<unknown>;
}

type OpenDB = IDBPDatabase<TagDeckDB> | MinimalDB;

function hasTransaction(db: OpenDB): db is IDBPDatabase<TagDeckDB> {
  return typeof (db as { transaction?: unknown }).transaction === 'function';
}

function getDB(): Promise<IDBPDatabase<TagDeckDB>> {
  if (!dbPromise) {
    let opened: IDBPDatabase<TagDeckDB> | null = null;
    const promise = openDB<TagDeckDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('dictionary', { keyPath: 'id' });
          db.createObjectStore('kv');
        }
        if (oldVersion < 2 && !db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      },
      blocked() {
        notifyBlocked(true);
      },
      blocking(_currentVersion, _blockedVersion, event) {
        if (dbPromise === promise) dbPromise = null;
        if (opened) opened.close();
        else (event?.target as { close?: () => void } | null)?.close?.();
      },
      terminated() {
        if (dbPromise === promise) dbPromise = null;
      },
    })
      .then((db) => {
        opened = db;
        notifyBlocked(false);
        return db;
      })
      .catch((error) => {
        if (dbPromise === promise) dbPromise = null;
        notifyBlocked(false);
        throw error;
      });
    dbPromise = promise;
  }
  return dbPromise;
}

async function open(): Promise<OpenDB> {
  return getDB();
}

export async function listEntries(): Promise<DictEntry[]> {
  const db = await open();
  if (!hasTransaction(db)) return mapStoredEntries(await (db.getAll?.('dictionary') ?? Promise.resolve([])));
  const tx = db.transaction(['dictionary', 'meta'], 'readonly');
  const [entries, rawMeta] = await Promise.all([
    tx.objectStore('dictionary').getAll(),
    tx.objectStore('meta').get(SYNC_META_KEY),
  ]);
  await tx.done;
  if (baseMeta === null) baseMeta = normalizeMeta(rawMeta);
  return mapStoredEntries(entries);
}

async function writeDictionary(
  mutate: (store: { put: (value: DictEntry) => Promise<unknown>; delete: (key: string) => Promise<unknown>; clear: () => Promise<unknown> }) => Promise<void>,
  fallback?: (db: MinimalDB) => Promise<void>,
): Promise<void> {
  return enqueueWrite(async () => {
    const db = await open();
    if (!hasTransaction(db)) {
      await fallback?.(db);
      return;
    }
    const tx = db.transaction(['dictionary', 'meta'], 'readwrite');
    // リクエスト失敗時に tx.done が単独で未処理拒否になるのを防ぐ
    tx.done.catch(() => {});
    const metaStore = tx.objectStore('meta');
    const current = normalizeMeta(await metaStore.get(SYNC_META_KEY));
    const reason = compareMeta(current, baseMeta);
    if (reason) {
      await tx.done;
      throw new StaleWriteError(reason);
    }
    const nextMeta: SyncMeta = { rev: current.rev + 1, epoch: current.epoch };
    try {
      await mutate(tx.objectStore('dictionary'));
      await metaStore.put(nextMeta, SYNC_META_KEY);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* 既に終了 */ }
      throw error;
    }
    advanceBaseMeta(nextMeta);
  });
}

export async function putEntry(entry: DictEntry): Promise<void> {
  return writeDictionary(
    async (store) => { await store.put(entry); },
    async (db) => { await db.put('dictionary', entry); },
  );
}

export async function putEntries(entries: readonly DictEntry[]): Promise<void> {
  return writeDictionary(
    async (store) => { await Promise.all(entries.map((entry) => store.put(entry))); },
    async (db) => { await Promise.all(entries.map((entry) => db.put('dictionary', entry))); },
  );
}

export async function deleteEntry(id: string): Promise<void> {
  return writeDictionary(
    async (store) => { await store.delete(id); },
    async (db) => { await db.delete?.('dictionary', id); },
  );
}

export async function replaceAllEntries(entries: readonly DictEntry[]): Promise<void> {
  return writeDictionary(async (store) => {
    await store.clear();
    await Promise.all(entries.map((entry) => store.put(entry)));
  });
}

export async function getKV<T>(key: KVKey): Promise<T | undefined> {
  const db = await open();
  if (!hasTransaction(db)) return (await db.get('kv', key)) as T | undefined;
  const tx = db.transaction(['kv', 'meta'], 'readonly');
  const [value, rawMeta] = await Promise.all([
    tx.objectStore('kv').get(key),
    tx.objectStore('meta').get(SYNC_META_KEY),
  ]);
  await tx.done;
  if (baseMeta === null) baseMeta = normalizeMeta(rawMeta);
  return value as T | undefined;
}

export async function setKV(key: KVKey, value: unknown): Promise<void> {
  return enqueueWrite(async () => {
    const db = await open();
    if (!hasTransaction(db)) {
      await db.put('kv', value, key);
      return;
    }
    const tx = db.transaction(['kv', 'meta'], 'readwrite');
    tx.done.catch(() => {});
    const metaStore = tx.objectStore('meta');
    const current = normalizeMeta(await metaStore.get(SYNC_META_KEY));
    const reason = compareMeta(current, baseMeta);
    if (reason) {
      await tx.done;
      throw new StaleWriteError(reason);
    }
    const nextMeta: SyncMeta = { rev: current.rev + 1, epoch: current.epoch };
    try {
      await tx.objectStore('kv').put(value, key);
      await metaStore.put(nextMeta, SYNC_META_KEY);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* 既に終了 */ }
      throw error;
    }
    advanceBaseMeta(nextMeta);
  });
}

/** 辞書・全 KV・同期メタを 1 つの readonly トランザクションで一括取得し、タブの基準リビジョンを更新する。 */
export async function readAllAppData(): Promise<AppDataSnapshot> {
  await writeQueue;
  const db = await open();
  if (!hasTransaction(db)) {
    const entries = mapStoredEntries(await (db.getAll?.('dictionary') ?? Promise.resolve([])));
    const values = await Promise.all(KV_KEYS.map((key) => db.get('kv', key)));
    const kv = Object.fromEntries(KV_KEYS.map((key, i) => [key, values[i]])) as Record<KVKey, unknown>;
    const meta = normalizeMeta(await db.get('meta', SYNC_META_KEY));
    baseMeta = meta;
    return { dictionary: entries, kv, meta };
  }
  const tx = db.transaction(['dictionary', 'kv', 'meta'], 'readonly');
  const kvStore = tx.objectStore('kv');
  const [entries, rawMeta, ...values] = await Promise.all([
    tx.objectStore('dictionary').getAll(),
    tx.objectStore('meta').get(SYNC_META_KEY),
    ...KV_KEYS.map((key) => kvStore.get(key)),
  ]);
  await tx.done;
  const meta = normalizeMeta(rawMeta);
  baseMeta = meta;
  const kv = Object.fromEntries(KV_KEYS.map((key, i) => [key, values[i]])) as Record<KVKey, unknown>;
  return { dictionary: mapStoredEntries(entries), kv, meta };
}

/** タブの基準リビジョンを進めずに、現在保存されている同期メタだけを返す。 */
export async function readSyncMeta(): Promise<SyncMeta> {
  const db = await open();
  if (!hasTransaction(db)) return normalizeMeta(await db.get('meta', SYNC_META_KEY));
  const tx = db.transaction('meta', 'readonly');
  const rawMeta = await tx.store.get(SYNC_META_KEY);
  await tx.done;
  return normalizeMeta(rawMeta);
}

/** 確認前にキャプチャした expectedMeta と一致する場合のみ、全ストアを 1 トランザクションで上書きする。 */
export async function replaceAllAppData(
  replacement: AppDataReplacement,
  expectedMeta: SyncMeta,
): Promise<SyncMeta> {
  return enqueueWrite(async () => {
    const db = await open();
    if (!hasTransaction(db)) throw new Error('まとめて保存するにはトランザクションが必要です');
    const tx = db.transaction(['dictionary', 'kv', 'meta'], 'readwrite');
    tx.done.catch(() => {});
    const metaStore = tx.objectStore('meta');
    const current = normalizeMeta(await metaStore.get(SYNC_META_KEY));
    const reason = compareMeta(current, expectedMeta);
    if (reason) {
      await tx.done;
      throw new StaleWriteError(reason);
    }
    const nextMeta: SyncMeta = { rev: current.rev + 1, epoch: current.epoch };
    try {
      const kvStore = tx.objectStore('kv');
      for (const key of KV_KEYS) {
        const value = replacement.kv[key];
        if (value === undefined) await kvStore.delete(key);
        else await kvStore.put(value, key);
      }
      const dictStore = tx.objectStore('dictionary');
      await dictStore.clear();
      await Promise.all(replacement.dictionary.map((entry) => dictStore.put(entry)));
      await metaStore.put(nextMeta, SYNC_META_KEY);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* 既に終了 */ }
      throw error;
    }
    advanceBaseMeta(nextMeta);
    return nextMeta;
  });
}

/** 辞書と全保存設定を 1 つのトランザクションで削除し、世代（epoch）とリビジョン（rev）を進める。 */
export async function clearAllData(): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    const tx = db.transaction(['dictionary', 'kv', 'meta'], 'readwrite');
    tx.done.catch(() => {});
    const metaStore = tx.objectStore('meta');
    const current = normalizeMeta(await metaStore.get(SYNC_META_KEY));
    const nextMeta: SyncMeta = { rev: current.rev + 1, epoch: current.epoch + 1 };
    await Promise.all([
      tx.objectStore('dictionary').clear(),
      tx.objectStore('kv').clear(),
      metaStore.put(nextMeta, SYNC_META_KEY),
    ]);
    await tx.done;
    baseMeta = nextMeta;
  });
}

/** テスト用: タブが保持している基準リビジョンを任意の値へ設定（または初期化）する。 */
export function setBaseMetaForTests(meta: SyncMeta | null): void {
  baseMeta = meta ? { ...meta } : null;
}
