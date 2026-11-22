// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGenerationControls } from '../src/hooks/useGenerationControls';
import { useLatestImageNotice } from '../src/hooks/useLatestImageNotice';
import { useBackupTransfer } from '../src/hooks/useBackupTransfer';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { DEFAULT_GENERATION } from '../src/lib/generation';
import { emptyWorkspace } from '../src/lib/workspace';
import { createPreset } from '../src/lib/presets';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let controls: ReturnType<typeof useGenerationControls>;
let notice: ReturnType<typeof useLatestImageNotice>;
let transfer: ReturnType<typeof useBackupTransfer>;
let args: Parameters<typeof useGenerationControls>[0];
let backupArgs: Parameters<typeof useBackupTransfer>[0];
function Harness({ latestId, viewing = false }: { latestId?: string; viewing?: boolean }) {
  controls = useGenerationControls(args);
  notice = useLatestImageNotice(latestId, viewing);
  transfer = useBackupTransfer(backupArgs);
  return null;
}
const render = async (latestId?: string, viewing = false) => {
  await act(async () => root.render(<StrictMode><Harness latestId={latestId} viewing={viewing} /></StrictMode>));
};
beforeEach(() => {
  root = createRoot(document.createElement('div'));
  args = {
    generator: { generating: false, error: null, generate: vi.fn().mockResolvedValue(undefined), cancel: vi.fn(), dismissError: vi.fn() },
    token: 'test-token', basePrompt: '1girl', characterPrompts: [], negativePrompt: 'lowres', settings: DEFAULT_SETTINGS,
    generation: DEFAULT_GENERATION, show: vi.fn(), onOpenSettings: vi.fn(),
  };
  backupArgs = {
    dictionary: { entries: [], loaded: true, error: null, save: vi.fn(), saveMany: vi.fn(), remove: vi.fn(), importEntries: vi.fn().mockResolvedValue(0), restoreInitial: vi.fn() },
    presets: { presets: [], setPresets: vi.fn(), commitPresets: vi.fn(async () => false), activeId: null, setActiveId: vi.fn(), persistence: [] },
    workspace: emptyWorkspace(), dispatch: vi.fn(), settings: DEFAULT_SETTINGS, updateSettings: vi.fn(),
    generation: DEFAULT_GENERATION, updateGeneration: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); });

it('opens settings without sending a request when the token is missing', async () => {
  args.token = null;
  await render();
  controls.startGenerate();
  expect(controls.blocker).toBe('トークンが未設定です');
  expect(args.onOpenSettings).toHaveBeenCalledOnce();
  expect(args.generator.generate).not.toHaveBeenCalled();
});
it('blocks an empty base prompt and an already running generation', async () => {
  args.basePrompt = '';
  await render();
  controls.startGenerate();
  expect(controls.blocker).toBe('ベースに ON のタグがありません');
  args.basePrompt = '1girl';
  args.generator.generating = true;
  await render();
  controls.startGenerate();
  expect(args.generator.generate).not.toHaveBeenCalled();
});
it('uses the current arguments for Ctrl/Meta+Enter and ignores IME', async () => {
  await render();
  args = { ...args, basePrompt: '2girls' };
  await render();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true }));
  expect(args.generator.generate).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
  expect(args.generator.generate).toHaveBeenCalledTimes(2);
  expect(args.generator.generate).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: '2girls', token: 'test-token', settings: DEFAULT_GENERATION }));
  await act(async () => root.unmount());
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
  expect(args.generator.generate).toHaveBeenCalledTimes(2);
});
it('surfaces generation errors', async () => {
  await render();
  args.generator.error = 'network failed';
  await render();
  expect(args.show).toHaveBeenCalledWith('network failed', 6000);
});
it('does not generate via a shortcut while a modal is open', async () => {
  await render();
  const dialog = document.createElement('dialog');
  dialog.open = true;
  document.body.append(dialog);
  try {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    expect(args.generator.generate).not.toHaveBeenCalled();
  } finally { dialog.remove(); }
});
it('dismisses a notification until a new image arrives', async () => {
  await render('a');
  expect(notice.unseenId).toBe('a');
  await act(async () => notice.dismiss());
  await render('a');
  expect(notice.unseenId).toBeNull();
  await render('b');
  expect(notice.unseenId).toBe('b');
  await render(undefined);
  expect(notice.unseenId).toBeNull();
});
it('does not announce images already viewed in the gallery', async () => {
  await render('a', true);
  expect(notice.unseenId).toBeNull();
  await render('b', true);
  await render('b', false);
  expect(notice.unseenId).toBeNull();
});
it('exports current backup values without credentials', async () => {
  await render();
  expect(transfer.getBackup()).toEqual({ dictionary: [], presets: [], workspace: backupArgs.workspace, settings: DEFAULT_SETTINGS, generation: DEFAULT_GENERATION });
  expect(transfer.getBackup()).not.toHaveProperty('token');
});
it('merges presets and applies restored workspace and settings after dictionary import', async () => {
  const old = createPreset('old', emptyWorkspace());
  const incoming = createPreset('incoming', emptyWorkspace());
  backupArgs.presets.presets = [old];
  await render();
  const data = { ...transfer.getBackup(), presets: [incoming] };
  await transfer.importBackup(data);
  expect(backupArgs.dictionary.importEntries).toHaveBeenCalledWith([], 'merge');
  expect(backupArgs.presets.setPresets).toHaveBeenCalledWith([incoming, old]);
  expect(backupArgs.presets.setActiveId).toHaveBeenCalledWith(null);
  expect(backupArgs.dispatch).toHaveBeenCalledWith({ type: 'replace', workspace: data.workspace });
  expect(backupArgs.updateSettings).toHaveBeenCalledWith(data.settings);
  expect(backupArgs.updateGeneration).toHaveBeenCalledWith(data.generation);
});
it('does not apply other backup values if dictionary import fails', async () => {
  vi.mocked(backupArgs.dictionary.importEntries).mockRejectedValue(new Error('database failed'));
  await render();
  await expect(transfer.importBackup(transfer.getBackup())).rejects.toThrow('database failed');
  expect(backupArgs.presets.setPresets).not.toHaveBeenCalled();
  expect(backupArgs.dispatch).not.toHaveBeenCalled();
});
