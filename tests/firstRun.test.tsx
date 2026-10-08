// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFirstRun } from '../src/hooks/useFirstRun';
import { emptyWorkspace } from '../src/lib/workspace';
import { createSampleWorkspace } from '../src/lib/sampleWorkspace';
import { buildPrompt, buildCharacterPrompts } from '../src/lib/prompt';

const dialogs = vi.hoisted(() => ({ choose: vi.fn(), confirm: vi.fn() }));
vi.mock('../src/components/Dialogs', () => ({ useDialogs: () => dialogs }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let args: Parameters<typeof useFirstRun>[0];
let guide: ReturnType<typeof useFirstRun>;
function Harness() { guide = useFirstRun(args); return null; }
const render = async () => { await act(async () => root.render(<StrictMode><Harness /></StrictMode>)); };
const open = async () => { await act(async () => { await guide.showGuide(); }); };
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  dialogs.choose.mockResolvedValue(null);
  dialogs.confirm.mockResolvedValue(true);
  root = createRoot(document.createElement('div'));
  args = {
    ready: true, hasExistingData: false, workspace: emptyWorkspace(), dispatch: vi.fn(),
    dictionary: { loaded: true, entries: [], error: null, save: vi.fn(), saveMany: vi.fn(), remove: vi.fn(), importEntries: vi.fn(), restoreInitial: vi.fn().mockResolvedValue(10) },
    presets: { presets: [], persistence: [], activeId: null, setActiveId: vi.fn(), setPresets: vi.fn() },
    notify: vi.fn(), onOpenEditor: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); });

it('waits for saved data before opening, and opens once under StrictMode', async () => {
  args.ready = false;
  await render();
  expect(dialogs.choose).not.toHaveBeenCalled();
  args = { ...args, ready: true };
  await render();
  await render();
  expect(dialogs.choose).toHaveBeenCalledOnce();
});
it('does not offer automatic setup when existing data is loaded', async () => {
  args.ready = false;
  await render();
  args = { ...args, ready: true, hasExistingData: true };
  await render();
  expect(dialogs.choose).not.toHaveBeenCalled();
  expect(localStorage.getItem('nai-tagdeck:first-run-complete')).toBe('true');
});
it('does not reopen a completed introduction on mount', async () => {
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  await render();
  expect(dialogs.choose).not.toHaveBeenCalled();
  await open();
  expect(dialogs.choose).toHaveBeenCalledOnce();
});
it.each([null, 'empty'])('dismissal or choosing empty (%s) preserves all data and is remembered', async (choice) => {
  dialogs.choose.mockResolvedValue(choice);
  await render();
  expect(args.dictionary.restoreInitial).not.toHaveBeenCalled();
  expect(args.dispatch).not.toHaveBeenCalled();
  expect(args.presets.setActiveId).not.toHaveBeenCalled();
  expect(localStorage.getItem('nai-tagdeck:first-run-complete')).toBe('true');
  expect(dialogs.choose.mock.calls[0]![2]).toEqual({ dismissOnBackdrop: true });
});
it('dictionary-only loading preserves the workspace and active preset', async () => {
  args.hasExistingData = true;
  args.workspace = createSampleWorkspace();
  await render();
  dialogs.choose.mockResolvedValue('dictionary');
  await open();
  expect(args.dictionary.restoreInitial).toHaveBeenCalledOnce();
  expect(args.dispatch).not.toHaveBeenCalled();
  expect(args.presets.setActiveId).not.toHaveBeenCalled();
});
it('loads a sample with distinct base and character prompts', async () => {
  dialogs.choose.mockResolvedValue('sample');
  await render();
  expect(args.dictionary.restoreInitial).toHaveBeenCalledOnce();
  const action = vi.mocked(args.dispatch).mock.calls[0]![0];
  expect(action.type).toBe('replace');
  if (action.type !== 'replace') throw new Error('expected replacement');
  expect(buildPrompt(action.workspace.base, 'numeric')).toContain('1girl');
  expect(buildPrompt(action.workspace.base, 'numeric')).not.toContain('long hair');
  const characters = buildCharacterPrompts(action.workspace.characters, 'numeric');
  expect(characters).toHaveLength(1);
  expect(characters[0]!.prompt).toContain('girl');
  expect(characters[0]!.prompt).toContain('long hair');
  expect(characters[0]!.prompt).not.toContain('1girl');
  expect(args.presets.setActiveId).toHaveBeenCalledWith(null);
});
it.each([true, false])('requires confirmation before replacing work (%s)', async (confirmed) => {
  args.hasExistingData = true;
  args.workspace = createSampleWorkspace();
  await render();
  dialogs.choose.mockResolvedValue('sample');
  dialogs.confirm.mockResolvedValue(confirmed);
  await open();
  expect(dialogs.confirm).toHaveBeenCalledOnce();
  expect(args.dispatch).toHaveBeenCalledTimes(confirmed ? 1 : 0);
  expect(args.dictionary.restoreInitial).toHaveBeenCalledTimes(confirmed ? 1 : 0);
  expect(args.presets.setPresets).not.toHaveBeenCalled();
});
it('does not replace work or complete setup if dictionary loading fails, and allows retry', async () => {
  dialogs.choose.mockResolvedValue('sample');
  vi.mocked(args.dictionary.restoreInitial).mockRejectedValueOnce(new Error('disk failure'));
  await render();
  expect(args.dispatch).not.toHaveBeenCalled();
  expect(localStorage.getItem('nai-tagdeck:first-run-complete')).toBeNull();
  expect(args.notify).toHaveBeenCalledWith(expect.stringContaining('読み込めませんでした'));
  await open();
  expect(args.dispatch).toHaveBeenCalledOnce();
  expect(localStorage.getItem('nai-tagdeck:first-run-complete')).toBe('true');
});
