import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenDBCallbacks } from 'idb';

const openDBMock = vi.hoisted(() => vi.fn());
vi.mock('idb', () => ({ openDB: openDBMock }));

function createFakeDB() {
  const kv = new Map<string, unknown>();
  return {
    get: vi.fn(async (_store: string, key: string) => kv.get(key)),
    put: vi.fn(async (_store: string, value: unknown, key: string) => {
      kv.set(key, value);
    }),
    close: vi.fn(),
  };
}

describe('db connection recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    openDBMock.mockReset();
  });

  it('retries openDB after an initial open failure instead of caching the rejection', async () => {
    const db = createFakeDB();
    openDBMock.mockRejectedValueOnce(new Error('open failed')).mockResolvedValueOnce(db);

    const { getKV, setKV } = await import('../src/lib/db');
    await expect(getKV('workspace')).rejects.toThrow('open failed');

    await setKV('workspace', { ok: true });
    expect(await getKV('workspace')).toEqual({ ok: true });
    expect(openDBMock).toHaveBeenCalledTimes(2);
  });

  it('reopens the database after the terminated callback fires', async () => {
    let callbacks: OpenDBCallbacks<unknown> | undefined;
    const db1 = createFakeDB();
    const db2 = createFakeDB();
    openDBMock
      .mockImplementationOnce(async (_name: string, _ver: number, cbs?: OpenDBCallbacks<unknown>) => {
        callbacks = cbs;
        return db1;
      })
      .mockResolvedValueOnce(db2);

    const { getKV } = await import('../src/lib/db');
    await getKV('workspace');
    expect(openDBMock).toHaveBeenCalledTimes(1);

    callbacks?.terminated?.();
    await getKV('settings');
    expect(openDBMock).toHaveBeenCalledTimes(2);
    expect(db2.get).toHaveBeenCalledWith('kv', 'settings');
  });

  it('closes and reopens the database when the blocking callback fires', async () => {
    let callbacks: OpenDBCallbacks<unknown> | undefined;
    const db1 = createFakeDB();
    const db2 = createFakeDB();
    openDBMock
      .mockImplementationOnce(async (_name: string, _ver: number, cbs?: OpenDBCallbacks<unknown>) => {
        callbacks = cbs;
        return db1;
      })
      .mockResolvedValueOnce(db2);

    const { getKV } = await import('../src/lib/db');
    await getKV('workspace');
    expect(openDBMock).toHaveBeenCalledTimes(1);

    callbacks?.blocking?.(1, 2, {} as IDBVersionChangeEvent);
    expect(db1.close).toHaveBeenCalledTimes(1);

    await getKV('settings');
    expect(openDBMock).toHaveBeenCalledTimes(2);
    expect(db2.get).toHaveBeenCalledWith('kv', 'settings');
  });
});
