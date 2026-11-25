import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDBPDatabase, OpenDBCallbacks } from 'idb';

const openDBMock = vi.hoisted(() => vi.fn());
vi.mock('idb', () => ({ openDB: openDBMock }));

function createFakeDB() {
  const kv = new Map<string, unknown>();
  return {
    get: vi.fn(async (_store: string, key: string) => kv.get(key)),
    getAll: vi.fn(async (_store: string) => []),
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

  it('notifies blocked subscribers while upgrade is waiting and clears once open resolves', async () => {
    let resolveOpen!: (db: ReturnType<typeof createFakeDB>) => void;
    let callbacks: OpenDBCallbacks<unknown> | undefined;
    openDBMock.mockImplementationOnce((_name: string, _ver: number, cbs?: OpenDBCallbacks<unknown>) => {
      callbacks = cbs;
      return new Promise((resolve) => { resolveOpen = resolve; });
    });

    const { getKV, subscribeDbBlocked } = await import('../src/lib/db');
    const states: boolean[] = [];
    const unsubscribe = subscribeDbBlocked((blocked) => states.push(blocked));

    const pending = getKV('workspace');
    callbacks?.blocked?.(1, 2, {} as IDBVersionChangeEvent);
    expect(states).toEqual([false, true]);

    resolveOpen(createFakeDB());
    await pending;
    expect(states).toEqual([false, true, false]);
    unsubscribe();
  });

  it('repairs a version 2 database missing the meta store on upgrade to version 3', async () => {
    // スマホで起きた状態: DB は版 2 なのに meta ストアが無い。
    // 旧 upgrade は oldVersion < 2 のときだけ meta を作るため、この状態では
    // 再読み込みでも meta が作られず、起動時の readAllAppData が
    // NotFoundError で毎回コケていた。
    const createdStores: string[] = [];
    const storeNames = new Set(['dictionary', 'kv']);
    const upgradeDb = {
      objectStoreNames: { contains: (name: string) => storeNames.has(name) },
      createObjectStore: vi.fn((name: string) => {
        createdStores.push(name);
        storeNames.add(name);
        return undefined as unknown as IDBObjectStore;
      }),
    } as unknown as IDBPDatabase<unknown>;
    const db = createFakeDB();
    openDBMock.mockImplementationOnce(
      async (_name: string, _ver: number, cbs?: OpenDBCallbacks<unknown>) => {
        cbs?.upgrade?.(upgradeDb, 2, 3, undefined as never, {} as IDBVersionChangeEvent);
        return db;
      },
    );

    const { DB_VERSION, readAllAppData } = await import('../src/lib/db');
    expect(DB_VERSION).toBe(3);

    const snapshot = await readAllAppData();
    expect(openDBMock).toHaveBeenCalledWith('nai-tagdeck', 3, expect.any(Object));
    expect(createdStores).toContain('meta');
    expect(storeNames.has('meta')).toBe(true);
    expect(snapshot).toEqual({
      dictionary: [],
      kv: {
        workspace: undefined,
        settings: undefined,
        generation: undefined,
        presets: undefined,
        activePreset: undefined,
      },
      meta: { rev: 0, epoch: 0 },
    });
  });

  it('creates all stores for a fresh database', async () => {
    const createdStores: string[] = [];
    const storeNames = new Set<string>();
    const upgradeDb = {
      objectStoreNames: { contains: (name: string) => storeNames.has(name) },
      createObjectStore: vi.fn((name: string) => {
        createdStores.push(name);
        storeNames.add(name);
        return undefined as unknown as IDBObjectStore;
      }),
    } as unknown as IDBPDatabase<unknown>;
    const db = createFakeDB();
    openDBMock.mockImplementationOnce(
      async (_name: string, _ver: number, cbs?: OpenDBCallbacks<unknown>) => {
        cbs?.upgrade?.(upgradeDb, 0, 3, undefined as never, {} as IDBVersionChangeEvent);
        return db;
      },
    );

    const { readAllAppData } = await import('../src/lib/db');
    await readAllAppData();
    expect(createdStores).toEqual(['dictionary', 'kv', 'meta']);
  });
});
