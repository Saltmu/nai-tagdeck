import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DictEntry } from '../types';

interface TagDeckDB extends DBSchema {
  dictionary: { key: string; value: DictEntry };
  kv: { key: string; value: unknown };
}

const DB_NAME = 'nai-tagdeck';
let dbPromise: Promise<IDBPDatabase<TagDeckDB>> | null = null;

function getDB(): Promise<IDBPDatabase<TagDeckDB>> {
  dbPromise ??= openDB<TagDeckDB>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('dictionary', { keyPath: 'id' });
      db.createObjectStore('kv');
    },
  });
  return dbPromise;
}

export async function listEntries(): Promise<DictEntry[]> {
  return (await getDB()).getAll('dictionary');
}

export async function putEntry(entry: DictEntry): Promise<void> {
  await (await getDB()).put('dictionary', entry);
}

export async function deleteEntry(id: string): Promise<void> {
  await (await getDB()).delete('dictionary', id);
}

export async function replaceAllEntries(entries: readonly DictEntry[]): Promise<void> {
  const tx = (await getDB()).transaction('dictionary', 'readwrite');
  await tx.store.clear();
  await Promise.all(entries.map((e) => tx.store.put(e)));
  await tx.done;
}

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await (await getDB()).get('kv', key)) as T | undefined;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await (await getDB()).put('kv', value, key);
}
