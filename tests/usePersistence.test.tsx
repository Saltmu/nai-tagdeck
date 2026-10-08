// @vitest-environment jsdom
import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistence, type PersistenceState } from '../src/hooks/usePersistence';
import { getKV, setKV } from '../src/lib/db';

vi.mock('../src/lib/db', () => ({ getKV: vi.fn(), setKV: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let state: PersistenceState;
let value: unknown;
let change: (value: unknown) => void;

function Harness({ storageKey = 'workspace' }: { storageKey?: string }) {
  const [stored, setStored] = useState<unknown>('initial');
  change = setStored;
  value = stored;
  state = usePersistence(storageKey, stored, setStored, 20);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getKV).mockReset();
  vi.mocked(setKV).mockReset().mockResolvedValue(undefined);
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(30); }); };

describe('persistent state', () => {
  it('does not write defaults before a delayed read, including StrictMode', async () => {
    let resolve!: (raw: unknown) => void;
    vi.mocked(getKV).mockImplementation(() => new Promise((r) => { resolve = r; }));
    await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
    await tick();
    expect(setKV).not.toHaveBeenCalled();
    await act(async () => resolve('saved'));
    await tick();
    expect(value).toBe('saved');
    expect(setKV).toHaveBeenCalledWith('workspace', 'saved');
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
});
