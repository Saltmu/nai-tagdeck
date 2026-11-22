// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
import { getKV, listEntries, setKV } from '../src/lib/db';
import { createPreset } from '../src/lib/presets';
import { normalizeWorkspace } from '../src/lib/workspace';
import { caption, pngFixture } from './promptImportFixture';

vi.mock('../src/lib/db', () => ({ getKV: vi.fn(), listEntries: vi.fn(), setKV: vi.fn() }));
vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  requestImages: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
const imageBytes = pngFixture({
  v4_prompt: caption('standing', ['girl']),
  v4_negative_prompt: caption('old negative', ['imported neg']),
  width: 1024, height: 1024, seed: 42, steps: 28,
});
const preset = createPreset('基本', normalizeWorkspace({
  base: { quality: [{ tag: 'saved-tag', enabled: true, weight: 1 }] },
  negative: [{ tag: 'old negative', enabled: true, weight: 1 }],
}));

function imageFile(): File {
  const file = new File([imageBytes], 'image.png', { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => imageBytes.buffer });
  return file;
}

function button(text: string, scope: ParentNode = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button'))
    .find((node) => node.textContent?.trim() === text || node.getAttribute('aria-label') === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

const click = (node: HTMLElement) => act(async () => node.click());
const preview = () => container.querySelector('output.preview-text')?.textContent;
const field = (suffix: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[id$="-${suffix}"]`);
const openBase = () => click(container.querySelector<HTMLButtonElement>('.editor-tablist [role="tab"]')!);
const openNegative = () => click(container.querySelector<HTMLButtonElement>('.editor-tab-negative')!);
const chooseDialog = () => Array.from(container.querySelectorAll('dialog'))
  .find((dialog) => dialog.textContent?.includes('変更が反映されていません'));

async function dropImport() {
  const target = container.querySelector('.png-drop-zone')!;
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [imageFile()] } });
  await act(async () => target.dispatchEvent(event));
  const dialog = container.querySelector('.prompt-import-dialog');
  if (!dialog) throw new Error('取り込みダイアログがありません');
  await click(dialog.querySelector('input[type="checkbox"]')!);
  return dialog;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  vi.mocked(getKV).mockImplementation(async (key) => ({
    workspace: { base: { quality: [{ tag: 'existing' }] }, negative: [{ tag: 'old negative' }] },
    generation: { seed: 11, steps: 19 },
    settings: { characterNegativePrompt: 'blurry' },
    presets: [preset],
    activePreset: preset.id,
  })[key as 'workspace'] as never);
  vi.mocked(setKV).mockResolvedValue(undefined);
  vi.mocked(listEntries).mockResolvedValue([
    { id: '1', tag: 'standing', category: 'pose', alias: '', default_weight: 1, sort_order: 0, updated_at: '' },
  ]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<DialogProvider><App onResetAll={() => {}} /></DialogProvider>));
  await click(button('編集'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dialogMethods.forEach((name, index) => {
    const descriptor = originalDialogMethods[index];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

it('asks before replacing unsaved preset edits and undoes the imported settings with the prompt', async () => {
  expect(container.textContent).toContain('変更あり');
  expect(field('steps')?.value).toBe('19');
  await openNegative();
  expect(field('character-text')?.value).toBe('blurry');
  await openBase();

  const dialog = await dropImport();
  await click(button('適用', dialog));
  const confirm = chooseDialog();
  expect(confirm?.textContent).toContain('プリセット「基本」に変更が反映されていません');
  expect(confirm?.textContent).toContain('共通のキャラ用ネガティブと生成設定も更新します');
  await click(button('キャンセル', confirm!));
  expect(preview()).toBe('existing');
  expect(document.activeElement).toBe(button('適用', container.querySelector('.prompt-import-dialog')!));
  expect((container.querySelector('.prompt-import-dialog') as HTMLDialogElement | null)?.open).toBe(true);

  await click(button('適用', container.querySelector('.prompt-import-dialog')!));
  await click(button('反映せずに適用', chooseDialog()!));
  expect(preview()).toBe('standing');
  expect((container.querySelector('.preset-search input') as HTMLInputElement).value).toBe('');
  expect(field('steps')?.value).toBe('28');
  expect(field('seed')?.value).toBe('42');
  expect(field('size')?.value).toBe('square');
  await openNegative();
  expect(field('character-text')?.value).toBe('imported neg');
  await openBase();

  await click(button('standing を削除'));
  expect(preview()).toBe('ONのタグがありません');
  await click(button('元に戻す'));
  expect(preview()).toBe('standing');
  expect(field('steps')?.value).toBe('28');
  await openNegative();
  expect(field('character-text')?.value).toBe('imported neg');
  await openBase();

  await click(button('元に戻す'));
  expect(preview()).toBe('existing');
  expect(field('steps')?.value).toBe('19');
  expect(field('seed')?.value).toBe('11');
  expect(field('size')?.value).toBe('portrait');
  await openNegative();
  expect(field('character-text')?.value).toBe('blurry');
  await openBase();
  expect((container.querySelector('.preset-search input') as HTMLInputElement).value).toBe('基本');
  expect(container.textContent).toContain('変更あり');

  await click(button('やり直す'));
  expect(preview()).toBe('standing');
  expect(field('steps')?.value).toBe('28');
  await openNegative();
  expect(field('character-text')?.value).toBe('imported neg');
  expect((container.querySelector('.preset-search input') as HTMLInputElement).value).toBe('');
});

it('confirms when a PNG would replace an edited negative that the active preset does not store', async () => {
  await act(async () => root.unmount());
  const legacy = createPreset('旧', normalizeWorkspace({
    base: { quality: [{ tag: 'existing', enabled: true, weight: 1 }] },
    negative: [],
  }));
  delete legacy.workspace.negative;
  vi.mocked(getKV).mockImplementation(async (key) => ({
    workspace: {
      base: { quality: [{ tag: 'existing' }] },
      negative: [{ tag: 'custom neg', enabled: true, weight: 1 }],
    },
    generation: { seed: 11, steps: 19 },
    settings: { characterNegativePrompt: 'blurry' },
    presets: [legacy],
    activePreset: legacy.id,
  })[key as 'workspace'] as never);
  root = createRoot(container);
  await act(async () => root.render(<DialogProvider><App onResetAll={() => {}} /></DialogProvider>));
  await click(button('編集'));
  expect(container.textContent).not.toContain('変更あり');

  const dialog = await dropImport();
  await click(button('適用', dialog));
  const confirm = chooseDialog();
  expect(confirm?.textContent).toContain('プリセット「旧」に変更が反映されていません');
  expect(confirm?.textContent).toContain('全体ネガティブ');
  await click(button('キャンセル', confirm!));
  await openNegative();
  expect(container.textContent).toContain('custom neg');
});

it('does not apply a PNG after saving fails while the confirmation is open', async () => {
  await click(button('existing を削除'));
  const dialog = await dropImport();
  await click(button('適用', dialog));
  expect(chooseDialog()?.textContent).toContain('変更が反映されていません');
  vi.mocked(setKV).mockRejectedValue(new Error('disk'));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  expect(container.textContent).toContain('保存できません');
  expect(container.querySelector('.prompt-import-dialog')).toBeNull();
  await click(button('反映せずに適用'));
  expect(preview()).toBe('ONのタグがありません');
  expect(field('steps')?.value).toBe('19');
});

it('saves the current preset before applying the image prompt', async () => {
  const dialog = await dropImport();
  await click(button('適用', dialog));
  await click(button('変更を反映してから適用', chooseDialog()!));
  expect(container.querySelector('.toast')?.textContent).toContain('プリセット「基本」に変更を上書きし、画像のプロンプトを読み込みました');
  expect(preview()).toBe('standing');

  const input = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { input.focus(); });
  await click(container.querySelector('[role="option"]')!);
  const confirm = container.querySelector('dialog.app-dialog-confirm');
  if (!confirm) throw new Error('読み込み確認がありません');
  await click(button('読み込む', confirm));
  expect(preview()).toBe('existing');
});
