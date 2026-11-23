// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDictionary, type Dictionary } from '../src/hooks/useDictionary';
import type { DictEntry } from '../src/types';
import { deleteEntry, listEntries, putEntries, putEntry, replaceAllEntries } from '../src/lib/db';
import { resetAppData } from '../src/lib/reset';

vi.mock('../src/lib/db', () => ({
  clearAllData: vi.fn(),
  listEntries: vi.fn(),
  putEntry: vi.fn(),
  putEntries: vi.fn(),
  deleteEntry: vi.fn(),
  replaceAllEntries: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let dict: Dictionary;

function Harness() {
  dict = useDictionary();
  return null;
}

const entry = (id: string, tag: string): DictEntry => ({
  id,
  tag,
  category: 'quality',
  alias: '',
  default_weight: 1,
  sort_order: 0,
  updated_at: '2026-01-01T00:00:00.000Z',
});

beforeEach(() => {
  vi.mocked(listEntries).mockReset().mockResolvedValue([]);
  vi.mocked(putEntry).mockReset().mockResolvedValue(undefined);
  vi.mocked(putEntries).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteEntry).mockReset().mockResolvedValue(undefined);
  vi.mocked(replaceAllEntries).mockReset().mockResolvedValue(undefined);
  root = createRoot(document.createElement('div'));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe('useDictionary', () => {
  it('discards queued dictionary writes when app data is reset', async () => {
    let finishWrite!: () => void;
    vi.mocked(putEntry).mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    await act(async () => root.render(<Harness />));
    const first = dict.save(entry('1', 'first'));
    const queued = dict.save(entry('2', 'queued'));
    const cancelled = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));

    await resetAppData();
    finishWrite();
    await first;
    await cancelled;
    expect(putEntry).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded false and sets error when initial load fails', async () => {
    vi.mocked(listEntries).mockRejectedValueOnce(new Error('idb down'));
    await act(async () => root.render(<Harness />));
    expect(dict.loaded).toBe(false);
    expect(dict.error).toContain('idb down');
  });

  it('serializes writes and keeps latest.current updated across back-to-back importEntries calls', async () => {
    let releaseFirst!: () => void;
    const order: string[] = [];
    vi.mocked(replaceAllEntries)
      .mockImplementationOnce(async (entries) => {
        order.push(`start:1:${entries.map((e) => e.tag).join(',')}`);
        await new Promise<void>((r) => { releaseFirst = r; });
        order.push('end:1');
      })
      .mockImplementationOnce(async (entries) => {
        order.push(`start:2:${entries.map((e) => e.tag).join(',')}`);
        order.push('end:2');
      });

    await act(async () => root.render(<Harness />));
    expect(dict.loaded).toBe(true);

    let p1!: Promise<number>;
    let p2!: Promise<number>;
    await act(async () => {
      p1 = dict.importEntries([entry('1', 'alpha')], 'merge');
      p2 = dict.importEntries([entry('2', 'beta')], 'merge');
      await Promise.resolve();
    });

    // Second write must wait for the first write to finish
    expect(order).toEqual(['start:1:alpha']);

    await act(async () => {
      releaseFirst();
      const [c1, c2] = await Promise.all([p1, p2]);
      expect(c1).toBe(1);
      expect(c2).toBe(2);
    });

    expect(order).toEqual(['start:1:alpha', 'end:1', 'start:2:alpha,beta', 'end:2']);
    expect(dict.entries.map((e) => e.tag)).toEqual(['alpha', 'beta']);
  });

  it('recovers the write queue after a failed write', async () => {
    vi.mocked(putEntry).mockRejectedValueOnce(new Error('quota')).mockResolvedValueOnce(undefined);
    await act(async () => root.render(<Harness />));

    await expect(act(async () => {
      await dict.save(entry('1', 'fail-tag'));
    })).rejects.toThrow('quota');
    expect(dict.entries).toEqual([]);

    await act(async () => {
      await dict.save(entry('2', 'ok-tag'));
    });
    expect(dict.entries.map((e) => e.tag)).toEqual(['ok-tag']);
  });
});
