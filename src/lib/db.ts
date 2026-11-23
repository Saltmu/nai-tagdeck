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

/** IndexedDB の kv ストアにアプリが書くキー。 */
export const KV_KEYS = ['workspace', 'settings', 'generation', 'presets', 'activePreset'] as const;
export type KVKey = (typeof KV_KEYS)[number];

let dbPromise: Promise<IDBPDatabase<TagDeckDB>> | null = null;

function getDB(): Promise<IDBPDatabase<TagDeckDB>> {
  if (!dbPromise) {
    let opened: IDBPDatabase<TagDeckDB> | null = null;
    const promise = openDB<TagDeckDB>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('dictionary', { keyPath: 'id' });
        db.createObjectStore('kv');
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

interface SyncGuard {
  seqs: Partial<Record<string, number>>;
  epoch: number;
}

/** このタブが最後に読んだ版。タブごとにメモリへ置く。 */
const seenSeq = new Map<string, number>();
let seenEpoch = 0;

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
  seenSeq.set(scope, seq);
  seenEpoch = epoch;
}

function isStale(scope: string, guard: SyncGuard): boolean {
  const seen = seenSeq.get(scope);
  if (seen === undefined) return false;
  return seen !== (guard.seqs[scope] ?? 0) || seenEpoch !== guard.epoch;
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
): Promise<void> {
  const db = await open();
  if (!hasTransaction(db)) {
    throw new Error('dictionary writes require a transaction');
  }
  const tx = db.transaction(['dictionary', 'kv'], 'readwrite');
  const kv = tx.objectStore('kv');
  const guard = await readGuard(kv);
  if (epoch !== undefined && guard.epoch !== epoch) {
    await tx.done;
    throw new StaleWriteError('reset');
  }
  if (epoch === undefined && isStale(scope, guard)) {
    await tx.done;
    throw new StaleWriteError(scope);
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

export async function replaceAllEntries(entries: readonly DictEntry[], epoch?: number): Promise<void> {
  const db = await open();
  if (!hasTransaction(db)) return;
  await writeDictionary(async (store) => {
    await store.clear();
    await Promise.all(entries.map((entry) => store.put(entry)));
  }, DICTIONARY_SEQ, epoch);
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

async function writeKV(key: KVKey, value: unknown, epoch?: number): Promise<void> {
  const db = await open();
  if (!hasTransaction(db)) {
    await db.put('kv', value, key);
    return;
  }
  const tx = db.transaction('kv', 'readwrite');
  const guard = await readGuard(tx.store);
  if (epoch !== undefined && guard.epoch !== epoch) {
    await tx.done;
    throw new StaleWriteError('reset');
  }
  if (epoch === undefined && isStale(key, guard)) {
    await tx.done;
    throw new StaleWriteError(key);
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

/** 確認済みの世代のときだけ、このタブの内容でそのキーを上書きする。 */
export async function replaceKV(key: KVKey, value: unknown, epoch: number): Promise<void> {
  await writeKV(key, value, epoch);
}

export async function readSyncEpoch(): Promise<number> {
  const db = await open();
  if (!hasTransaction(db)) {
    const guard = normalizeGuard(await db.get('kv', SYNC_GUARD_KEY));
    seenEpoch = guard.epoch;
    return guard.epoch;
  }
  const tx = db.transaction('kv', 'readonly');
  const guard = await readGuard(tx.store);
  await tx.done;
  seenEpoch = guard.epoch;
  return guard.epoch;
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
  seenSeq.clear();
  seenEpoch = next.epoch;
}
