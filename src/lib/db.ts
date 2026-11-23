import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DictEntry } from '../types';
import { LEGACY_DRESS_STATE_CATEGORY } from './categories';

type StoredDictEntry = Omit<DictEntry, 'category'> & {
  category: DictEntry['category'] | typeof LEGACY_DRESS_STATE_CATEGORY;
};

interface TagDeckDB extends DBSchema {
  dictionary: { key: string; value: StoredDictEntry };
  kv: { key: string; value: unknown };
}

const DB_NAME = 'nai-tagdeck';

/**
 * 版 2 は同期ガード導入前のタブを拒む。ストアの形は版 1 のまま。
 * 新しいタブが開いたあと、版 1 のままのタブは開けなくなる。
 */
export const DB_VERSION = 2;

/** IndexedDB の kv ストアにアプリが書くキー。 */
export const KV_KEYS = ['workspace', 'settings', 'generation', 'presets', 'activePreset'] as const;
export type KVKey = (typeof KV_KEYS)[number];

let dbPromise: Promise<IDBPDatabase<TagDeckDB>> | null = null;

function getDB(): Promise<IDBPDatabase<TagDeckDB>> {
  if (!dbPromise) {
    let opened: IDBPDatabase<TagDeckDB> | null = null;
    const promise = openDB<TagDeckDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('dictionary', { keyPath: 'id' });
          db.createObjectStore('kv');
        }
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
        return db;
      })
      .catch((error) => {
        if (dbPromise === promise) dbPromise = null;
        throw error;
      });
    dbPromise = promise;
  }
  return dbPromise;
}

/** 他タブの書き込みのあとだと、このタブが見た版では保存できない。 */
export class StaleWriteError extends Error {
  readonly name = 'StaleWriteError';
  constructor(readonly scope: string) {
    super(`保存が他のタブの更新より古くなっています (${scope})`);
  }
}

const SYNC_GUARD_KEY = 'syncGuard';
const DICTIONARY_SEQ = 'dictionary';

export interface SyncGuard {
  seqs: Partial<Record<string, number>>;
  epoch: number;
}

/** このタブが範囲ごとに最後に読んだ版。タブのメモリに置く。 */
const seen = new Map<string, { seq: number; epoch: number }>();

function emptyGuard(): SyncGuard {
  return { seqs: {}, epoch: 0 };
}

function normalizeGuard(raw: unknown): SyncGuard {
  if (!raw || typeof raw !== 'object') return emptyGuard();
  const guard = raw as Partial<SyncGuard>;
  const seqs = guard.seqs && typeof guard.seqs === 'object' ? { ...guard.seqs } : {};
  return { seqs, epoch: typeof guard.epoch === 'number' ? guard.epoch : 0 };
}

function remember(scope: string, seq: number, epoch: number): void {
  seen.set(scope, { seq, epoch });
}

function staleScope(scope: string, guard: SyncGuard, epoch?: number, expectedSeq?: number): string | null {
  if (epoch !== undefined && guard.epoch !== epoch) return 'reset';
  if (expectedSeq !== undefined && (guard.seqs[scope] ?? 0) !== expectedSeq) return scope;
  if (epoch !== undefined || expectedSeq !== undefined) return null;
  const prior = seen.get(scope);
  if (!prior) return null;
  if (prior.epoch !== guard.epoch) return 'reset';
  if (prior.seq !== (guard.seqs[scope] ?? 0)) return scope;
  return null;
}

type GuardStore = { get: (key: string) => Promise<unknown> };

async function readGuard(store: GuardStore): Promise<SyncGuard> {
  return normalizeGuard(await store.get(SYNC_GUARD_KEY));
}

/** openDB のモックが transaction を持たないとき、get / put だけで読み書きする。 */
interface RecoveryDB {
  get(store: 'dictionary' | 'kv', key?: string): Promise<unknown>;
  getAll(store: 'dictionary' | 'kv'): Promise<StoredDictEntry[]>;
  put(store: 'dictionary' | 'kv', value: unknown, key?: string): Promise<unknown>;
  delete(store: 'dictionary' | 'kv', key: string): Promise<unknown>;
}

type OpenDB = IDBPDatabase<TagDeckDB> | RecoveryDB;

function hasTransaction(db: OpenDB): db is IDBPDatabase<TagDeckDB> {
  return typeof (db as { transaction?: unknown }).transaction === 'function';
}

async function open(): Promise<OpenDB> {
  return getDB();
}

async function writeDictionary(
  mutate: (store: { put: (value: DictEntry) => Promise<unknown>; delete: (key: string) => Promise<unknown>; clear: () => Promise<unknown> }, guard: SyncGuard) => Promise<void>,
  scope = DICTIONARY_SEQ,
  epoch?: number,
  expectedSeq?: number,
): Promise<void> {
  const db = await open();
  if (!hasTransaction(db)) {
    throw new Error('dictionary writes require a transaction');
  }
  const tx = db.transaction(['dictionary', 'kv'], 'readwrite');
  const kv = tx.objectStore('kv');
  const guard = await readGuard(kv);
  const stale = staleScope(scope, guard, epoch, expectedSeq);
  if (stale) {
    await tx.done;
    throw new StaleWriteError(stale);
  }
  await mutate(tx.objectStore('dictionary'), guard);
  guard.seqs[scope] = (guard.seqs[scope] ?? 0) + 1;
  await kv.put(guard, SYNC_GUARD_KEY);
  await tx.done;
  remember(scope, guard.seqs[scope] ?? 0, guard.epoch);
}

export async function listEntries(): Promise<DictEntry[]> {
  const db = await open();
  const mapEntries = (entries: StoredDictEntry[]) => entries.map(({ category, ...entry }) => ({
    ...entry,
    category: category === LEGACY_DRESS_STATE_CATEGORY ? 'outfit' : category,
  }));
  if (!hasTransaction(db)) return mapEntries(await db.getAll('dictionary'));
  const tx = db.transaction(['dictionary', 'kv'], 'readonly');
  const entries = await tx.objectStore('dictionary').getAll();
  const guard = await readGuard(tx.objectStore('kv'));
  await tx.done;
  remember(DICTIONARY_SEQ, guard.seqs[DICTIONARY_SEQ] ?? 0, guard.epoch);
  return mapEntries(entries);
}

export async function putEntry(entry: DictEntry): Promise<void> {
  const db = await open();
  if (!hasTransaction(db)) {
    await db.put('dictionary', entry);
    return;
  }
  await writeDictionary(async (store) => { await store.put(entry); });
}

export async function putEntries(entries: readonly DictEntry[]): Promise<void> {
  const db = await open();
  if (!hasTransaction(db)) {
    await Promise.all(entries.map((entry) => db.put('dictionary', entry)));
    return;
  }
  await writeDictionary(async (store) => {
    await Promise.all(entries.map((entry) => store.put(entry)));
  });
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await open();
  if (!hasTransaction(db)) {
    await db.delete('dictionary', id);
    return;
  }
  await writeDictionary(async (store) => { await store.delete(id); });
}

export async function replaceAllEntries(entries: readonly DictEntry[], epoch?: number, expectedSeq?: number): Promise<void> {
  const db = await open();
  if (!hasTransaction(db)) return;
  await writeDictionary(async (store) => {
    await store.clear();
    await Promise.all(entries.map((entry) => store.put(entry)));
  }, DICTIONARY_SEQ, epoch, expectedSeq);
}

export async function getKV<T>(key: KVKey): Promise<T | undefined> {
  const db = await open();
  if (!hasTransaction(db)) return (await db.get('kv', key)) as T | undefined;
  const tx = db.transaction('kv', 'readonly');
  const value = await tx.store.get(key);
  const guard = await readGuard(tx.store);
  await tx.done;
  remember(key, guard.seqs[key] ?? 0, guard.epoch);
  return value as T | undefined;
}

async function writeKV(key: KVKey, value: unknown, epoch?: number, expectedSeq?: number): Promise<void> {
  const db = await open();
  if (!hasTransaction(db)) {
    await db.put('kv', value, key);
    return;
  }
  const tx = db.transaction('kv', 'readwrite');
  const guard = await readGuard(tx.store);
  const stale = staleScope(key, guard, epoch, expectedSeq);
  if (stale) {
    await tx.done;
    throw new StaleWriteError(stale);
  }
  guard.seqs[key] = (guard.seqs[key] ?? 0) + 1;
  await tx.store.put(value, key);
  await tx.store.put(guard, SYNC_GUARD_KEY);
  await tx.done;
  remember(key, guard.seqs[key] ?? 0, guard.epoch);
}

export async function setKV(key: KVKey, value: unknown): Promise<void> {
  await writeKV(key, value);
}

/** 確認済みの世代と版のときだけ、このタブの内容でそのキーを上書きする。 */
export async function replaceKV(key: KVKey, value: unknown, epoch: number, expectedSeq?: number): Promise<void> {
  await writeKV(key, value, epoch, expectedSeq);
}

export interface SavedScopeReplacement {
  kv: Partial<Record<KVKey, unknown>>;
  dictionary?: readonly DictEntry[];
}

/** 確認した版のまま、対象の範囲を一つのトランザクションで上書きする。 */
export async function replaceSavedScopes(
  replacement: SavedScopeReplacement,
  epoch: number,
  expectedSeqs: Partial<Record<string, number>>,
): Promise<void> {
  const kvKeys = KV_KEYS.filter((key) => Object.hasOwn(replacement.kv, key));
  const entries = replacement.dictionary;
  const scopes = [...kvKeys, ...(entries ? [DICTIONARY_SEQ] : [])];
  if (scopes.length === 0) return;
  const db = await open();
  if (!hasTransaction(db)) throw new Error('まとめて保存するにはトランザクションが必要です');
  const tx = db.transaction(entries ? ['dictionary', 'kv'] : ['kv'], 'readwrite');
  const kv = tx.objectStore('kv');
  const guard = await readGuard(kv);
  const stale = staleScopeList(guard, epoch, scopes, expectedSeqs);
  if (stale) {
    await tx.done;
    throw new StaleWriteError(stale);
  }
  try {
    for (const key of kvKeys) {
      await kv.put(replacement.kv[key], key);
      guard.seqs[key] = (guard.seqs[key] ?? 0) + 1;
    }
    if (entries) {
      const dictionary = tx.objectStore('dictionary');
      await dictionary.clear();
      await Promise.all(entries.map((entry) => dictionary.put(entry)));
      guard.seqs[DICTIONARY_SEQ] = (guard.seqs[DICTIONARY_SEQ] ?? 0) + 1;
    }
    await kv.put(guard, SYNC_GUARD_KEY);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // 失敗したトランザクションはすでに終わっている
    }
    throw error;
  }
  for (const scope of scopes) remember(scope, guard.seqs[scope] ?? 0, guard.epoch);
}

function staleScopeList(
  guard: SyncGuard,
  epoch: number,
  scopes: readonly string[],
  expectedSeqs: Partial<Record<string, number>>,
): string | null {
  if (guard.epoch !== epoch) return 'reset';
  for (const scope of scopes) {
    if ((guard.seqs[scope] ?? 0) !== (expectedSeqs[scope] ?? 0)) return scope;
  }
  return null;
}

async function readGuardSnapshot(): Promise<SyncGuard> {
  const db = await open();
  if (!hasTransaction(db)) return normalizeGuard(await db.get('kv', SYNC_GUARD_KEY));
  const tx = db.transaction('kv', 'readonly');
  const guard = await readGuard(tx.store);
  await tx.done;
  return guard;
}

export async function readSyncEpoch(): Promise<number> {
  return (await readGuardSnapshot()).epoch;
}

/** 画面の基準は進めず、いま保存されている世代と範囲ごとの版を返す。 */
export async function readSyncGuard(): Promise<SyncGuard> {
  return readGuardSnapshot();
}

/** 辞書と全保存設定を1つのトランザクションで削除する。 */
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['dictionary', 'kv'], 'readwrite');
  const kv = tx.objectStore('kv');
  const guard = await readGuard(kv);
  await Promise.all([tx.objectStore('dictionary').clear(), kv.clear()]);
  const next = emptyGuard();
  next.epoch = guard.epoch + 1;
  await kv.put(next, SYNC_GUARD_KEY);
  await tx.done;
  seen.clear();
  for (const scope of [...KV_KEYS, DICTIONARY_SEQ]) remember(scope, 0, next.epoch);
}
