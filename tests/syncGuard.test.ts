import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, getKV, listEntries, putEntry, readSyncEpoch, readSyncGuard, replaceAllEntries, replaceKV, setKV, StaleWriteError } from '../src/lib/db';
import type { DictEntry } from '../src/types';

interface Guard {
  seqs: Record<string, number>;
  epoch: number;
}

function openRaw(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nai-tagdeck');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** db.ts を通さず、他タブが書いたことにして版だけ進める。 */
async function bumpGuard(mutate: (guard: Guard) => void): Promise<void> {
  const db = await openRaw();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    const get = store.get('syncGuard');
    get.onsuccess = () => {
      const current = (get.result as Guard | undefined) ?? { seqs: {}, epoch: 0 };
      const guard: Guard = { seqs: { ...current.seqs }, epoch: current.epoch };
      mutate(guard);
      store.put(guard, 'syncGuard');
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

const entry = (id: string): DictEntry => ({
  id,
  tag: id,
  category: 'subject',
  alias: '',
  default_weight: 1,
  sort_order: 0,
  updated_at: '',
});

describe('sync guard', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('refuses a kv write when another tab advanced the stored revision', async () => {
    await setKV('workspace', { tag: 'local' });
    await bumpGuard((guard) => { guard.seqs.workspace = 5; });
    await expect(setKV('workspace', { tag: 'stale' })).rejects.toBeInstanceOf(StaleWriteError);
    expect(await getKV('workspace')).toEqual({ tag: 'local' });
  });

  it('refuses a dictionary write when another tab advanced the stored revision', async () => {
    await putEntry(entry('kept'));
    await listEntries();
    await bumpGuard((guard) => { guard.seqs.dictionary = 5; });
    await expect(putEntry(entry('stale'))).rejects.toBeInstanceOf(StaleWriteError);
    expect((await listEntries()).map((item) => item.id)).toEqual(['kept']);
  });

  it('keeps an earlier scope stale when a later read sees a newer reset generation', async () => {
    await setKV('workspace', { tag: 'local' });
    await bumpGuard((guard) => {
      guard.epoch += 1;
      guard.seqs = {};
    });
    const db = await openRaw();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete('workspace');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await getKV('settings');
    await readSyncEpoch();
    await expect(setKV('workspace', { tag: 'revived' })).rejects.toBeInstanceOf(StaleWriteError);
    expect(await getKV('workspace')).toBeUndefined();
  });

  it('reports a missed reset as a reset rather than one store', async () => {
    await setKV('workspace', { tag: 'local' });
    await bumpGuard((guard) => { guard.epoch += 1; });
    await expect(setKV('workspace', { tag: 'stale' })).rejects.toMatchObject({ name: 'StaleWriteError', scope: 'reset' });
    expect(await getKV('workspace')).toEqual({ tag: 'local' });
  });

  it('refuses a confirmed overwrite when that store was saved again', async () => {
    await setKV('workspace', { tag: 'local' });
    const guard = await readSyncGuard();
    await bumpGuard((current) => { current.seqs.workspace = (current.seqs.workspace ?? 0) + 1; });
    await expect(replaceKV('workspace', { tag: 'preferred' }, guard.epoch, guard.seqs.workspace ?? 0)).rejects.toMatchObject({ scope: 'workspace' });
    expect(await getKV('workspace')).toEqual({ tag: 'local' });
  });

  it('writes a confirmed snapshot for the same reset generation and refuses an older one', async () => {
    const epoch = await readSyncEpoch();
    await replaceKV('workspace', { tag: 'preferred' }, epoch);
    await replaceAllEntries([entry('preferred')], epoch);
    expect(await getKV('workspace')).toEqual({ tag: 'preferred' });
    expect((await listEntries()).map((item) => item.id)).toEqual(['preferred']);

    await clearAllData();
    await expect(replaceKV('workspace', { tag: 'revived' }, epoch)).rejects.toBeInstanceOf(StaleWriteError);
    await expect(replaceAllEntries([entry('revived')], epoch)).rejects.toBeInstanceOf(StaleWriteError);
    expect(await getKV('workspace')).toBeUndefined();
    expect(await listEntries()).toEqual([]);
  });
});
