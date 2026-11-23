// @vitest-environment jsdom
import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistence, type PersistenceState } from '../src/hooks/usePersistence';
import { clearAllData, getKV, setKV, StaleWriteError, type KVKey } from '../src/lib/db';
import { resetAppData } from '../src/lib/reset';
import { clearTabSyncConflict, getTabSyncConflict, receiveTabSyncMessage, scopesToSave } from '../src/lib/tabSync';

vi.mock('../src/lib/db', () => {
  class StaleWriteError extends Error {
    readonly name = 'StaleWriteError';
    constructor(readonly scope: string) { super(`stale ${scope}`); }
  }
  return { clearAllData: vi.fn(), getKV: vi.fn(), setKV: vi.fn(), StaleWriteError };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let state: PersistenceState;
let value: unknown;
let change: (value: unknown) => void;
let renders = 0;

function Harness({ storageKey = 'workspace', onLoad, reloadRevision = 0 }: { storageKey?: KVKey; onLoad?: (raw: unknown, apply: (v: unknown) => void) => Promise<void> | void; reloadRevision?: number }) {
  renders += 1;
  const [stored, setStored] = useState<unknown>('initial');
  change = setStored;
  value = stored;
  state = usePersistence(storageKey, stored, (raw) => (onLoad ? onLoad(raw, setStored) : setStored(raw)), 20, reloadRevision);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getKV).mockReset();
  vi.mocked(setKV).mockReset().mockResolvedValue(undefined);
  renders = 0;
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  await act(async () => root.unmount());
  clearTabSyncConflict();
  vi.useRealTimers();
});
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(30); }); };

describe('persistent state', () => {
  it('does not write defaults before a delayed read and skips initial write-back, including StrictMode', async () => {
    let resolve!: (raw: unknown) => void;
    vi.mocked(getKV).mockImplementation(() => new Promise((r) => { resolve = r; }));
    await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
    await tick();
    expect(setKV).not.toHaveBeenCalled();
    await act(async () => resolve('saved'));
    await tick();
    expect(value).toBe('saved');
    expect(state.loaded).toBe(true);
    expect(setKV).not.toHaveBeenCalled();
    await act(async () => change('edited'));
    await tick();
    expect(setKV).toHaveBeenCalledTimes(1);
    expect(setKV).toHaveBeenCalledWith('workspace', 'edited');
  });

  it('blocks all writes after a read failure', async () => {
    vi.mocked(getKV).mockRejectedValue(new Error('read failed'));
    await act(async () => root.render(<Harness />));
    await act(async () => change('edited'));
    await tick();
    expect(state.loaded).toBe(false);
    expect(state.error).toContain('read failed');
    expect(setKV).not.toHaveBeenCalled();
  });

  it('reports save failures and recovers on the next edit', async () => {
    vi.mocked(getKV).mockResolvedValue(undefined);
    vi.mocked(setKV).mockRejectedValueOnce(new Error('quota'));
    await act(async () => root.render(<Harness />));
    await tick();
    expect(setKV).not.toHaveBeenCalled();
    await act(async () => change('first-edit'));
    await tick();
    expect(state.status).toBe('error');
    expect(state.error).toContain('quota');
    await act(async () => change('retry'));
    await tick();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });

  it('ignores late reads after unmount', async () => {
    let resolve!: (raw: unknown) => void;
    vi.mocked(getKV).mockImplementation(() => new Promise((r) => { resolve = r; }));
    await act(async () => root.render(<Harness />));
    await act(async () => root.unmount());
    await act(async () => resolve('late'));
    await tick();
    expect(setKV).not.toHaveBeenCalled();
  });

  it('does not save the previous value while a new key loads', async () => {
    vi.mocked(getKV).mockResolvedValueOnce('old').mockRejectedValueOnce(new Error('new key failed'));
    await act(async () => root.render(<Harness />));
    await act(async () => root.render(<Harness storageKey="settings" />));
    await tick();
    expect(state.loaded).toBe(false);
    expect(setKV).not.toHaveBeenCalled();
  });

  it('waits for an async onLoad promise before marking loaded', async () => {
    let finishMigration!: () => void;
    vi.mocked(getKV).mockResolvedValue('legacy');
    const onLoad = vi.fn(async (raw: unknown, apply: (v: unknown) => void) => {
      await new Promise<void>((r) => { finishMigration = r; });
      apply(`${String(raw)}-migrated`);
    });
    await act(async () => root.render(<Harness onLoad={onLoad} />));
    expect(state.loaded).toBe(false);
    await tick();
    expect(setKV).not.toHaveBeenCalled();
    await act(async () => finishMigration());
    expect(state.loaded).toBe(true);
    expect(value).toBe('legacy-migrated');
    await tick();
    expect(setKV).not.toHaveBeenCalled();
  });

  it('does not cause extra re-renders during a normal debounced save', async () => {
    vi.mocked(getKV).mockResolvedValue('saved');
    await act(async () => root.render(<Harness />));
    const rendersAfterLoad = renders;
    await act(async () => change('edited'));
    const rendersAfterEdit = renders;
    expect(rendersAfterEdit).toBe(rendersAfterLoad + 1);
    await tick();
    expect(setKV).toHaveBeenCalledWith('workspace', 'edited');
    expect(renders).toBe(rendersAfterEdit);
  });

  it('flushes pending writes immediately on visibilitychange (hidden) and pagehide without duplicating', async () => {
    vi.mocked(getKV).mockResolvedValue('saved');
    await act(async () => root.render(<Harness />));
    await act(async () => change('unsaved'));
    expect(setKV).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(setKV).toHaveBeenCalledTimes(1);
    expect(setKV).toHaveBeenCalledWith('workspace', 'unsaved');

    // Subsequent pagehide and debounce timer should not duplicate the already-flushed write
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await tick();
    expect(setKV).toHaveBeenCalledTimes(1);
  });

  it('flushes pending writes on pagehide even if unmounted immediately afterward', async () => {
    vi.mocked(getKV).mockResolvedValue('saved');
    await act(async () => root.render(<Harness />));
    await act(async () => change('closing'));
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      root.unmount();
    });
    expect(setKV).toHaveBeenCalledTimes(1);
    expect(setKV).toHaveBeenCalledWith('workspace', 'closing');
  });

  it('persists reverting back to the original value while an intermediate save is in flight', async () => {
    let finishB!: () => void;
    vi.mocked(getKV).mockResolvedValue('A');
    vi.mocked(setKV)
      .mockImplementationOnce(() => new Promise<void>((r) => { finishB = r; }))
      .mockResolvedValueOnce(undefined);

    await act(async () => root.render(<Harness />));
    await act(async () => change('B'));
    await tick();
    expect(setKV).toHaveBeenCalledTimes(1);
    expect(setKV).toHaveBeenLastCalledWith('workspace', 'B');

    // Revert to A while B is still writing
    await act(async () => change('A'));
    await act(async () => finishB());
    await tick();

    expect(setKV).toHaveBeenCalledTimes(2);
    expect(setKV).toHaveBeenNthCalledWith(1, 'workspace', 'B');
    expect(setKV).toHaveBeenNthCalledWith(2, 'workspace', 'A');
  });

  it('discards a queued visibility flush when app data is reset', async () => {
    let finishWrite!: () => void;
    vi.mocked(getKV).mockResolvedValue('saved');
    vi.mocked(setKV).mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }));

    await act(async () => root.render(<Harness />));
    await act(async () => change('first edit'));
    await tick();
    await act(async () => change('queued edit'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));
    await resetAppData();
    expect(clearAllData).toHaveBeenCalledOnce();
    await act(async () => finishWrite());

    expect(setKV).toHaveBeenCalledExactlyOnceWith('workspace', 'first edit');
    await act(async () => root.render(<Harness />));
    await act(async () => change('new edit'));
    await tick();
    expect(setKV).toHaveBeenLastCalledWith('workspace', 'new edit');
  });

  it('stops debounced writes, visibility flushes, and pagehide while another tab is newer', async () => {
    vi.mocked(getKV).mockResolvedValue('saved');
    await act(async () => root.render(<Harness />));
    await act(async () => change('dirty'));
    receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'workspace', seq: 1, at: 1 });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await tick();
    expect(setKV).not.toHaveBeenCalled();

    clearTabSyncConflict();
    await act(async () => change('after unlock'));
    await tick();
    expect(setKV).toHaveBeenCalledExactlyOnceWith('workspace', 'after unlock');
  });

  it('locks and keeps the unsaved edit when the stored revision moved ahead', async () => {
    vi.mocked(getKV).mockResolvedValue('saved');
    vi.mocked(setKV).mockRejectedValueOnce(new StaleWriteError('workspace'));
    await act(async () => root.render(<Harness />));
    await act(async () => change('edited'));
    await tick();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
    const conflict = getTabSyncConflict();
    expect(conflict?.scopes).toContain('workspace');
    expect(scopesToSave(conflict!)).toContain('workspace');
    await tick();
    expect(setKV).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer edit dirty when an older save finishes after the lock', async () => {
    let finishWrite!: () => void;
    vi.mocked(getKV).mockResolvedValue('saved');
    vi.mocked(setKV).mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    await act(async () => root.render(<Harness />));
    await act(async () => change('A'));
    await tick();
    await act(async () => change('B'));
    receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'settings', seq: 4, at: 4 });
    await act(async () => finishWrite());
    await tick();
    expect(setKV).toHaveBeenCalledExactlyOnceWith('workspace', 'A');
    expect(scopesToSave(getTabSyncConflict()!)).toContain('workspace');
  });

  it('drops a queued write when another tab updates before it runs', async () => {
    let finishWrite!: () => void;
    vi.mocked(getKV).mockResolvedValue('saved');
    vi.mocked(setKV).mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    await act(async () => root.render(<Harness />));
    await act(async () => change('first edit'));
    await tick();
    await act(async () => change('queued edit'));
    receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'settings', seq: 2, at: 2 });
    await act(async () => finishWrite());
    await tick();
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(setKV).toHaveBeenCalledExactlyOnceWith('workspace', 'first edit');
  });

  it('applies a newer stored value on reload without writing it back', async () => {
    vi.mocked(getKV).mockResolvedValueOnce('saved').mockResolvedValueOnce('remote');
    await act(async () => root.render(<Harness />));
    expect(value).toBe('saved');
    expect(state.revision).toBe(0);
    await act(async () => root.render(<Harness reloadRevision={1} />));
    expect(value).toBe('remote');
    expect(state.revision).toBe(1);
    expect(state.loaded).toBe(true);
    await tick();
    expect(setKV).not.toHaveBeenCalled();
  });

  it('resets to the onLoad value when a reload finds the key deleted', async () => {
    vi.mocked(getKV).mockResolvedValueOnce('saved').mockResolvedValueOnce(undefined);
    await act(async () => root.render(<Harness />));
    await act(async () => root.render(<Harness reloadRevision={1} />));
    expect(value).toBeUndefined();
    await tick();
    expect(setKV).not.toHaveBeenCalled();
  });
});
