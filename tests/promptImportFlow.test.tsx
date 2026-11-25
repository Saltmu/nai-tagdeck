// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
import { getKV, listEntries, setKV } from '../src/lib/db';
import { requestImages } from '../src/lib/novelai';
import { caption, pngFixture } from './promptImportFixture';

vi.mock('../src/lib/db', () => ({ getKV: vi.fn(), listEntries: vi.fn(), setKV: vi.fn() }));
vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  requestImages: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
const writeText = vi.fn().mockResolvedValue(undefined);
const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
const imageBytes = pngFixture({
  v4_prompt: caption('blazer, 1.2::custom tag::, standing'),
  width: 1024, height: 1024, seed: 42, steps: 50,
});

function imageFile(bytes = imageBytes, name = 'image.png'): File {
  const file = new File([bytes], name, { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  return file;
}

function button(text: string, scope: ParentNode = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button'))
    .find((node) => node.textContent?.trim() === text || node.getAttribute('aria-label') === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

const click = (node: HTMLElement) => act(async () => node.click());
/** 作業中のタグがあるときは、適用のあと未保存の確認も進める。 */
async function acceptImport(scope: ParentNode) {
  await click(button('適用', scope));
  const confirm = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm');
  if (!confirm?.open) throw new Error('未保存の確認が出ていません');
  await click(button('適用', confirm));
}
const preview = () => container.querySelector('output.preview-text')?.textContent;

async function pick(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

async function drop(file: File, target: Element = container.querySelector('.png-drop-zone')!) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
  await act(async () => target.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:mock';
    static revokeObjectURL = () => {};
  });
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  sessionStorage.setItem('nai-tagdeck.token', 'test-token');
  vi.mocked(getKV).mockImplementation(async (key) => ({
    workspace: { base: { quality: [{ tag: 'existing' }] }, negative: [{ tag: 'old negative' }] },
    generation: { seed: 11, steps: 19 },
  })[key as 'workspace' | 'generation'] as never);
  vi.mocked(setKV).mockResolvedValue(undefined);
  vi.mocked(listEntries).mockResolvedValue([
    { id: '1', tag: 'blazer', category: 'outfit', alias: '', default_weight: 1, sort_order: 0, updated_at: '' },
    { id: '2', tag: 'standing', category: 'pose', alias: '', default_weight: 1, sort_order: 1, updated_at: '' },
  ]);
  vi.mocked(requestImages).mockResolvedValue([{ blob: imageFile() }]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<DialogProvider><App onResetAll={() => {}} /></DialogProvider>));
  await click(button('生成'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dialogMethods.forEach((name, i) => {
    const descriptor = originalDialogMethods[i];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

it('retains the workspace on cancel or error, then applies a drop and only the supported checked settings', async () => {
  const picker = vi.spyOn(container.querySelector<HTMLInputElement>('input[type="file"]')!, 'click');
  await click(button('PNGから読み込む', container.querySelector('.gallery')!));
  expect(picker).toHaveBeenCalledOnce();
  await pick(imageFile());
  expect(container.querySelector('dialog')?.textContent).toContain('ベース　3件（未分類 1件）');
  expect(container.querySelector('.prompt-import-categories')?.textContent).toBe('衣装 1件、ポーズ 1件');
  expect(preview()).toBe('existing');
  await click(button('キャンセル', container.querySelector('dialog')!));
  await drop(imageFile(pngFixture(), 'missing.png'));
  expect(container.querySelector('dialog [role="alert"]')?.textContent).toContain('生成情報');
  expect(preview()).toBe('existing');
  await click(button('閉じる', container.querySelector('dialog')!));

  await drop(imageFile());
  const dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('ステップ');
  expect(dialog.textContent).toContain('キャラクター一覧は空になります');
  await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await acceptImport(dialog);
  expect(container.querySelector('.tab-editor')?.getAttribute('aria-current')).toBe('page');
  expect(requestImages).not.toHaveBeenCalled();
  expect(preview()).toBe('blazer, standing, 1.2::custom tag::');

  const move = container.querySelector<HTMLSelectElement>('select[aria-label="custom tag の移動先カテゴリ"]')!;
  await act(async () => {
    move.value = 'quality';
    move.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const expected = '1.2::custom tag::, blazer, standing';
  expect(preview()).toBe(expected);
  await click(container.querySelector<HTMLButtonElement>('.preview-item button')!);
  expect(writeText).toHaveBeenCalledWith(expected);
  await click(button('生成する（Ctrl+Enter）'));
  expect(requestImages).toHaveBeenCalledWith('test-token', expect.objectContaining({
    input: expected,
    parameters: expect.objectContaining({ steps: 19, width: 1024, height: 1024, seed: 42, negative_prompt: 'old negative' }),
  }), expect.anything());
});

it('opens the shared PNG picker from preset actions and imports into the workspace', async () => {
  await click(button('編集'));
  const picker = vi.spyOn(container.querySelector<HTMLInputElement>('input[type="file"]')!, 'click');
  const menu = container.querySelector<HTMLDetailsElement>('.preset-bar details')!;
  const trigger = menu.querySelector<HTMLElement>('summary')!;
  expect(menu.open).toBe(false);
  await act(async () => trigger.click());
  expect(menu.open).toBe(true);
  await click(button('PNGから読み込む', menu));
  expect(menu.open).toBe(false);
  expect(picker).toHaveBeenCalledOnce();
  await pick(imageFile(pngFixture({ v4_prompt: caption('standing', ['blazer', 'other tag']) }), 'characters.png'));
  const dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('characters.png');
  expect(dialog.textContent).toContain('キャラ1　1件（未分類 0件）衣装 1件');
  expect(dialog.textContent).toContain('キャラ2　1件（未分類 1件）');
  expect(preview()).toBe('existing');
  await acceptImport(dialog);
  expect(container.querySelector('.tab-editor')?.getAttribute('aria-current')).toBe('page');
  expect([...container.querySelectorAll('.preview-item:not(.preview-negative) output')].map((output) => output.textContent))
    .toEqual(['standing', 'blazer', 'other tag']);
  expect(requestImages).not.toHaveBeenCalled();
});

it('reads the viewer PNG and leaves generation settings alone when the option is unchecked', async () => {
  await click(button('生成する（Ctrl+Enter）'));
  await click(container.querySelector<HTMLButtonElement>('.thumb-btn')!);
  await click(button('プロンプトを読み込む', container.querySelector('.viewer')!));
  expect(container.querySelector('dialog')?.textContent).toContain('ベース　3件（未分類 1件）');
  await acceptImport(container.querySelector('dialog')!);
  await click(button('生成する（Ctrl+Enter）'));
  expect(requestImages).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
    input: 'blazer, standing, 1.2::custom tag::',
    parameters: expect.objectContaining({ seed: 11, width: 832, height: 1216, steps: 19 }),
  }), expect.anything());
});

it('ignores an older read that completes after cancellation and a new selection', async () => {
  const stale = new File([imageBytes], 'stale.png', { type: 'image/png' });
  let finish!: (value: ArrayBuffer) => void;
  Object.defineProperty(stale, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>((resolve) => { finish = resolve; }) });
  await pick(stale);
  expect(container.querySelector('dialog')?.textContent).toContain('読み込んでいます');
  await click(button('キャンセル', container.querySelector('dialog')!));
  await pick(imageFile(pngFixture({ prompt: 'fresh tag' }), 'fresh.png'));
  await act(async () => finish(imageBytes.buffer));
  await acceptImport(container.querySelector('dialog')!);
  expect(preview()).toBe('fresh tag');
});

it('accepts a PNG dropped anywhere on the editor and toggles dragging state', async () => {
  await click(button('編集'));
  const editor = container.querySelector('.editor')!;
  const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true });
  Object.defineProperty(dragEnter, 'dataTransfer', { value: { types: ['Files'] } });
  await act(async () => editor.dispatchEvent(dragEnter));
  expect(editor.classList.contains('is-dragging')).toBe(true);

  await drop(imageFile(pngFixture({ prompt: 'editor dropped tag' }), 'editor.png'), editor);
  expect(editor.classList.contains('is-dragging')).toBe(false);
  expect(container.querySelector('dialog')?.textContent).toContain('editor.png');
  await acceptImport(container.querySelector('dialog')!);
  expect(preview()).toBe('editor dropped tag');
});

it('preserves fur dataset at the start even with classified tags when generation settings are not applied in anime mode', async () => {
  const furryBytes = pngFixture({ v4_prompt: caption('fur dataset, blazer, wolf') });
  await drop(imageFile(furryBytes, 'furry.png'));
  await acceptImport(container.querySelector('dialog')!);
  expect(preview()).toBe('fur dataset, blazer, wolf');
  await click(button('生成する（Ctrl+Enter）'));
  expect(requestImages).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
    input: 'fur dataset, blazer, wolf',
  }), expect.anything());

  await drop(imageFile(furryBytes, 'furry.png'));
  const dialog = container.querySelector('dialog')!;
  await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await acceptImport(dialog);
  expect(preview()).toBe('fur dataset, blazer, wolf');
  await click(container.querySelector<HTMLButtonElement>('.preview-item button')!);
  expect(writeText).toHaveBeenCalledWith('fur dataset, blazer, wolf');
  await click(button('生成する（Ctrl+Enter）'));
  expect(requestImages).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
    input: 'fur dataset, blazer, wolf',
  }), expect.anything());
});

it('allows generating after importing a fur-dataset-only base with character tags and applying furry mode', async () => {
  const charOnlyFurryBytes = pngFixture({ v4_prompt: caption('fur dataset', ['wolf']) });
  await drop(imageFile(charOnlyFurryBytes, 'char-furry.png'));
  const dialog = container.querySelector('dialog')!;
  await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await acceptImport(dialog);
  expect(preview()).toBe('fur dataset');
  const characterNegative = [...container.querySelectorAll('.preview-item')].find((node) => node.querySelector('dt')?.textContent?.includes('キャラ1のネガティブ'));
  expect(characterNegative?.querySelector('output')?.textContent).toBe('lowres, aliasing, ');
  await click(button('生成する（Ctrl+Enter）'));
  expect(requestImages).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
    input: 'fur dataset',
    parameters: expect.objectContaining({
      characterPrompts: [expect.objectContaining({ prompt: 'wolf', uc: 'lowres, aliasing, ' })],
    }),
  }), expect.anything());
});

it('imports and generates a fur-dataset-only PNG without character tags without duplicating fur dataset', async () => {
  const furOnlyBytes = pngFixture({ v4_prompt: caption('fur dataset') });
  await drop(imageFile(furOnlyBytes, 'fur-only.png'));
  const dialog = container.querySelector('dialog')!;
  await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await acceptImport(dialog);
  expect(preview()).toBe('fur dataset');
  await click(button('生成する（Ctrl+Enter）'));
  expect(requestImages).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
    input: 'fur dataset',
  }), expect.anything());
});

it('falls back to stored history when a viewer image has no PNG metadata', async () => {
  vi.mocked(requestImages).mockResolvedValueOnce([{ blob: new Blob([pngFixture()]) }]);
  await click(button('生成する（Ctrl+Enter）'));
  expect(container.querySelector('.thumb-btn')).not.toBeNull();

  // 履歴のプロンプトと現在の作業状態を変えて、フォールバック復元が分かるようにする
  await click(button('編集'));
  await click(button('existing を削除'));
  expect(preview()).toBe('ONのタグがありません');

  await click(button('生成'));
  await click(container.querySelector<HTMLButtonElement>('.thumb-btn')!);
  await click(button('プロンプトを読み込む', container.querySelector('.viewer')!));
  const dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('ベース　1件（未分類 1件）');
  expect(dialog.textContent).toContain('履歴に保持していた送信情報から読み込みました');
  expect(dialog.textContent).not.toContain('生成情報が見つかりません');
  await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await click(button('適用', dialog));
  const confirm = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm');
  if (confirm?.open) await click(button('適用', confirm));
  expect(preview()).toBe('existing');
  await click(button('生成する（Ctrl+Enter）'));
  expect(requestImages).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
    input: 'existing',
    parameters: expect.objectContaining({ seed: 11, width: 832, height: 1216, steps: 19, negative_prompt: 'old negative' }),
  }), expect.anything());
});
