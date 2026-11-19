// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspace } from '../src/hooks/useWorkspace';
import { getKV, setKV } from '../src/lib/db';

vi.mock('../src/lib/db', () => ({ getKV: vi.fn(), setKV: vi.fn() }));
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
afterEach(async () => { await act(async () => root.unmount()); });
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
