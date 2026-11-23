// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSettings, useWorkspace } from '../src/hooks/useWorkspace';
import { clearAllData, getKV, setKV, StaleWriteError } from '../src/lib/db';
import { resetAppData } from '../src/lib/reset';
import { clearTabSyncConflict, getTabSyncConflict, receiveTabSyncMessage } from '../src/lib/tabSync';

vi.mock('../src/lib/db', () => {
  class StaleWriteError extends Error {
    readonly name = 'StaleWriteError';
    constructor(readonly scope: string) { super(`stale ${scope}`); }
  }
  return { clearAllData: vi.fn(), getKV: vi.fn(), setKV: vi.fn(), StaleWriteError };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let current: ReturnType<typeof useWorkspace>;
function Harness() {
  current = useWorkspace();
  return null;
}
const stored = (data: Record<string, unknown>) =>
  vi.mocked(getKV).mockImplementation(async (key: string) => data[key] as never);

beforeEach(() => {
  vi.mocked(getKV).mockReset();
  vi.mocked(setKV).mockReset().mockResolvedValue(undefined);
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  clearTabSyncConflict();
});
const render = async () => {
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

it('moves the negative prompt saved in settings into the workspace', async () => {
  stored({ workspace: { base: { quality: [{ tag: 'masterpiece' }] } }, settings: { negativePrompt: 'lowres, {bad hands}' } });
  await render();
  expect(current.loaded).toBe(true);
  expect(current.workspace.base.quality.map((t) => t.tag)).toEqual(['masterpiece']);
  expect(current.workspace.negative.map((t) => [t.tag, t.weight])).toEqual([['lowres', 1], ['bad hands', 1.05]]);
  expect(setKV).toHaveBeenCalledWith('workspace', expect.objectContaining({
    negative: expect.arrayContaining([expect.objectContaining({ tag: 'lowres' })]),
  }));
});

it('keeps loaded false until async legacy negative migration completes', async () => {
  let resolveSettings!: (value: unknown) => void;
  vi.mocked(getKV).mockImplementation((key: string) => {
    if (key === 'workspace') return Promise.resolve({ base: { quality: [{ tag: 'masterpiece' }] } } as never);
    return new Promise((r) => { resolveSettings = r; }) as never;
  });
  await act(async () => root.render(<Harness />));
  expect(current.loaded).toBe(false);
  await act(async () => resolveSettings({ negativePrompt: 'lowres' }));
  expect(current.loaded).toBe(true);
  expect(current.workspace.negative.map((t) => t.tag)).toEqual(['lowres']);
});

it('keeps a negative already saved in the workspace without reading settings', async () => {
  stored({ workspace: { base: {}, negative: [{ tag: 'blurry' }] }, settings: { negativePrompt: 'lowres' } });
  await render();
  expect(current.loaded).toBe(true);
  expect(current.workspace.negative.map((t) => t.tag)).toEqual(['blurry']);
  expect(getKV).not.toHaveBeenCalledWith('settings');
  expect(setKV).not.toHaveBeenCalled();
});

it('does not write a migrated workspace after resetting during the legacy settings read', async () => {
  let finishSettingsRead!: (value: unknown) => void;
  vi.mocked(getKV).mockImplementation((key) => {
    if (key === 'workspace') return Promise.resolve({ base: { quality: [{ tag: 'old tag' }] } } as never);
    return new Promise((resolve) => { finishSettingsRead = resolve; }) as never;
  });
  await render();
  expect(current.loaded).toBe(false);

  await act(async () => root.unmount());
  root = createRoot(document.createElement('div'));
  await resetAppData();
  expect(clearAllData).toHaveBeenCalledOnce();
  await act(async () => finishSettingsRead({ negativePrompt: 'old negative' }));

  expect(setKV).not.toHaveBeenCalled();
});

it('keeps a legacy migration in memory when another tab is newer', async () => {
  receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'settings', seq: 1, at: 1 });
  stored({ workspace: { base: { quality: [{ tag: 'masterpiece' }] } }, settings: { negativePrompt: 'lowres' } });
  await render();
  expect(current.loaded).toBe(true);
  expect(current.workspace.negative.map((tag) => tag.tag)).toEqual(['lowres']);
  expect(setKV).not.toHaveBeenCalled();
});

it('locks instead of failing when the migrated workspace write is already stale', async () => {
  stored({ workspace: { base: { quality: [{ tag: 'masterpiece' }] } }, settings: { negativePrompt: 'lowres' } });
  vi.mocked(setKV).mockRejectedValueOnce(new StaleWriteError('workspace'));
  await render();
  expect(current.loaded).toBe(true);
  expect(current.persistence.status).toBe('idle');
  expect(current.workspace.negative.map((tag) => tag.tag)).toEqual(['lowres']);
  expect(getTabSyncConflict()?.scopes).toContain('workspace');
});

it('surfaces migration save failure and preserves legacy negativePrompt in settings until migration succeeds', async () => {
  vi.useFakeTimers();
  try {
    stored({
      workspace: { base: { quality: [{ tag: 'masterpiece' }] } },
      settings: { weightSyntax: 'numeric', negativePrompt: 'lowres, bad hands' },
    });
    vi.mocked(setKV).mockImplementation(async (key: string) => {
      if (key === 'workspace') throw new Error('quota exceeded');
    });

    let updateSettings!: ReturnType<typeof useSettings>[1];
    function CombinedHarness() {
      current = useWorkspace();
      const [, update] = useSettings(current.loaded);
      updateSettings = update;
      return null;
    }

    await act(async () => root.render(<CombinedHarness />));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });

    expect(current.loaded).toBe(false);
    expect(current.persistence.status).toBe('error');
    expect(current.persistence.error).toContain('quota exceeded');

    await act(async () => updateSettings({ weightSyntax: 'brace' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    expect(setKV).toHaveBeenCalledWith('settings', expect.objectContaining({
      weightSyntax: 'brace',
      negativePrompt: 'lowres, bad hands',
    }));
  } finally {
    vi.useRealTimers();
  }
});
