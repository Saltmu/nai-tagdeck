import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllData,
  DB_VERSION,
  deleteEntry,
  getKV,
  listEntries,
  putEntry,
  readAllAppData,
  readSyncMeta,
  replaceAllAppData,
  replaceAllEntries,
  setBaseMetaForTests,
  setKV,
  StaleWriteError,
} from '../src/lib/db';
import type { DictEntry } from '../src/types';

const entry = (id: string, tag: string): DictEntry => ({
  id,
  tag,
  category: 'quality',
  alias: '',
  default_weight: 1,
  sort_order: 0,
  updated_at: '2026-01-01T00:00:00.000Z',
});

/** 別タブが IndexedDB へ書き込んだ状態をシミュレートする（baseMeta は進めない）。 */
async function simulateOtherTabWrite(key: 'workspace' | 'settings', value: unknown): Promise<void> {
  const db = await openDB('nai-tagdeck', DB_VERSION);
  try {
    const tx = db.transaction(['kv', 'meta'], 'readwrite');
    const raw = (await tx.objectStore('meta').get('sync')) as { rev?: number; epoch?: number } | undefined;
    const next = { rev: (raw?.rev ?? 0) + 1, epoch: raw?.epoch ?? 0 };
    await tx.objectStore('kv').put(value, key);
    await tx.objectStore('meta').put(next, 'sync');
    await tx.done;
  } finally {
    db.close();
  }
}

/** 別タブが全削除した状態をシミュレートする（baseMeta は進めない）。 */
async function simulateOtherTabReset(): Promise<void> {
  const db = await openDB('nai-tagdeck', DB_VERSION);
  try {
    const tx = db.transaction(['dictionary', 'kv', 'meta'], 'readwrite');
    const raw = (await tx.objectStore('meta').get('sync')) as { rev?: number; epoch?: number } | undefined;
    const next = { rev: (raw?.rev ?? 0) + 1, epoch: (raw?.epoch ?? 0) + 1 };
    await tx.objectStore('dictionary').clear();
    await tx.objectStore('kv').clear();
    await tx.objectStore('meta').put(next, 'sync');
    await tx.done;
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  setBaseMetaForTests(null);
  await clearAllData();
});

describe('db single-revision sync guard', () => {
  it('reads all stores and meta in one transaction and serializes same-tab concurrent writes', async () => {
    const initial = await readAllAppData();
    expect(initial.dictionary).toEqual([]);
    expect(initial.kv.workspace).toBeUndefined();

    // 同一タブの並列書き込みは writeQueue で直列化され、自己競合しない
    await Promise.all([
      setKV('workspace', { v: 1 }),
      setKV('settings', { weightSyntax: 'brace' }),
      putEntry(entry('1', 'solo')),
    ]);

    const after = await readAllAppData();
    expect(after.kv.workspace).toEqual({ v: 1 });
    expect(after.kv.settings).toEqual({ weightSyntax: 'brace' });
    expect(after.dictionary.map((e) => e.tag)).toEqual(['solo']);
    expect(after.meta.rev).toBe(initial.meta.rev + 3);
  });

  it('rejects stale KV and dictionary writes with StaleWriteError without clobbering newer data', async () => {
    await setKV('workspace', { from: 'tab-a' });
    await putEntry(entry('1', 'initial'));
    await readAllAppData();

    await simulateOtherTabWrite('workspace', { from: 'tab-b' });

    await expect(setKV('workspace', { from: 'stale-a' })).rejects.toMatchObject({
      name: 'StaleWriteError',
      reason: 'updated',
    });
    await expect(putEntry(entry('2', 'stale-tag'))).rejects.toBeInstanceOf(StaleWriteError);
    await expect(deleteEntry('1')).rejects.toBeInstanceOf(StaleWriteError);
    await expect(replaceAllEntries([entry('3', 'stale-all')])).rejects.toBeInstanceOf(StaleWriteError);

    expect(await getKV('workspace')).toEqual({ from: 'tab-b' });
    expect((await listEntries()).map((e) => e.tag)).toEqual(['initial']);
  });

  it('reports reset reason when another tab clears all data', async () => {
    await setKV('workspace', { from: 'tab-a' });
    await readAllAppData();

    await simulateOtherTabReset();

    await expect(setKV('workspace', { from: 'stale-a' })).rejects.toMatchObject({
      name: 'StaleWriteError',
      reason: 'reset',
    });
    expect(await getKV('workspace')).toBeUndefined();
  });

  it('atomically replaces all scopes only when expectedMeta matches', async () => {
    await setKV('workspace', { from: 'initial' });
    await putEntry(entry('1', 'old'));
    await simulateOtherTabWrite('workspace', { from: 'tab-b' });

    const captured = await readSyncMeta();
    const nextMeta = await replaceAllAppData(
      {
        dictionary: [entry('2', 'preferred')],
        kv: {
          workspace: { from: 'tab-a-preferred' },
          settings: { weightSyntax: 'numeric' },
          generation: { mode: 'furry' },
          presets: [],
          activePreset: null,
        },
      },
      captured,
    );
    expect(nextMeta.rev).toBe(captured.rev + 1);
    expect(nextMeta.epoch).toBe(captured.epoch);

    const stored = await readAllAppData();
    expect(stored.kv.workspace).toEqual({ from: 'tab-a-preferred' });
    expect(stored.kv.generation).toEqual({ mode: 'furry' });
    expect(stored.dictionary.map((e) => e.tag)).toEqual(['preferred']);

    // 古い captured での再実行は拒否され、DB は変わらない
    await expect(
      replaceAllAppData(
        {
          dictionary: [entry('3', 'should-not-write')],
          kv: { workspace: { from: 'bad' }, settings: undefined, generation: undefined, presets: [], activePreset: null },
        },
        captured,
      ),
    ).rejects.toMatchObject({ name: 'StaleWriteError', reason: 'updated' });

    expect((await readAllAppData()).dictionary.map((e) => e.tag)).toEqual(['preferred']);
  });

  it('rejects replaceAllAppData with reset reason if another tab resets after capture', async () => {
    const captured = await readSyncMeta();
    await simulateOtherTabReset();

    await expect(
      replaceAllAppData(
        {
          dictionary: [entry('1', 'resurrected')],
          kv: { workspace: { resurrected: true }, settings: undefined, generation: undefined, presets: [], activePreset: null },
        },
        captured,
      ),
    ).rejects.toMatchObject({ name: 'StaleWriteError', reason: 'reset' });

    const stored = await readAllAppData();
    expect(stored.dictionary).toEqual([]);
    expect(stored.kv.workspace).toBeUndefined();
  });

  it('propagates request errors without emitting unhandled tx.done rejections or advancing rev', async () => {
    const before = await readAllAppData();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(setKV('workspace', () => {})).rejects.toThrow();
      await expect(
        replaceAllAppData(
          {
            dictionary: [],
            kv: { workspace: () => {}, settings: undefined, generation: undefined, presets: [], activePreset: null },
          },
          before.meta,
        ),
      ).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect((await readSyncMeta())).toEqual(before.meta);
  });

  it('queues dictionary writes before opening DB so an immediately following clearAllData removes them cleanly', async () => {
    await readAllAppData();
    const pendingWrite = putEntry(entry('race', 'should-be-cleared'));
    const pendingClear = clearAllData();
    await Promise.all([pendingWrite, pendingClear]);

    const after = await readAllAppData();
    expect(after.dictionary).toEqual([]);
  });
});
