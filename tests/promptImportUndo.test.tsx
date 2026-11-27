// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider, useDialogs, type DialogApi } from '../src/components/Dialogs';
import { toBackupJSON } from '../src/lib/backup';
import { getKV, listEntries, replaceAllEntries, setKV } from '../src/lib/db';
import { normalizeGeneration } from '../src/lib/generation';
import { createPreset } from '../src/lib/presets';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { normalizeWorkspace } from '../src/lib/workspace';
import { caption, pngFixture } from './promptImportFixture';

vi.mock('../src/lib/db', () => ({
  getKV: vi.fn(),
  listEntries: vi.fn(),
  replaceAllEntries: vi.fn(),
  setKV: vi.fn(),
}));
vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  requestImages: vi.fn(),
  // Anlas 残高の取得はこのテストの対象外。実通信をしない。
  fetchSubscription: vi.fn().mockRejectedValue(new Error('fetchSubscription is mocked out')),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
let dialogApi: DialogApi;
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

function DialogSpy() {
  dialogApi = useDialogs();
  return null;
}

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

/** React.lazy で分離した画面・ダイアログがマウントされるまで待つ。 */
async function waitForMount(selector: string) {
  await vi.waitFor(() => {
    if (!container.querySelector(selector)) throw new Error(`waiting for ${selector}`);
  }, { timeout: 5000 });
}

const preview = () => container.querySelector('output.preview-text')?.textContent;
const field = (suffix: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[id$="-${suffix}"]`);
const checkedSizeLabel = () =>
  container.querySelector('.size-toggle [role="radio"][aria-checked="true"]')?.getAttribute('aria-label');
const openBase = () => click(container.querySelector<HTMLButtonElement>('.editor-tablist [role="tab"]')!);
const openNegative = () => click(container.querySelector<HTMLButtonElement>('.editor-tab-negative')!);
const chooseDialog = () => Array.from(container.querySelectorAll('dialog'))
  .find((dialog) => dialog.textContent?.includes('変更が反映されていません'));

async function dropImport() {
  // 画像欄のドロップゾーンは廃止されたため、タグ編集エリアへドロップする
  const target = container.querySelector('.editor')!;
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [imageFile()] } });
  await act(async () => target.dispatchEvent(event));
  await waitForMount('.prompt-import-dialog');
  // PNG の読み取りが終わって生成設定のチェックボックスが出るまで待つ
  await waitForMount('.prompt-import-dialog input[type="checkbox"]');
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
  vi.mocked(replaceAllEntries).mockResolvedValue(undefined);
  vi.mocked(listEntries).mockResolvedValue([
    { id: '1', tag: 'standing', category: 'pose', alias: '', default_weight: 1, sort_order: 0, updated_at: '' },
  ]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<DialogProvider><DialogSpy /><App onResetAll={() => {}} /></DialogProvider>));
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
  expect(checkedSizeLabel()).toBe('正方形 1024×1024');
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
  expect(checkedSizeLabel()).toBe('縦 832×1216');
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
  await act(async () => root.render(<DialogProvider><DialogSpy /><App onResetAll={() => {}} /></DialogProvider>));
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

it('cancels only the PNG confirmation when saving fails and leaves another queued dialog open', async () => {
  let otherResolved = false;
  await click(button('existing を削除'));
  const dialog = await dropImport();
  await act(async () => {
    void dialogApi.confirm('別の確認').then(() => { otherResolved = true; });
  });
  await click(button('適用', dialog));
  vi.mocked(setKV).mockRejectedValue(new Error('disk'));
  // 保存は 300ms のデバウンス後に走るため、固定 400ms の待機では負荷時に
  // エラー表示より先にアサーションが走って間欠的に失敗していた（#140）。
  // 条件が揃うまで待つことで、負荷がかかっても確定的に待てるようにする。
  await vi.waitFor(() => {
    expect(container.textContent).toContain('保存できません');
    expect(container.querySelector('.prompt-import-dialog')).toBeNull();
  }, { timeout: 5000 });
  expect(container.textContent).toContain('保存できません');
  expect(container.querySelector('.prompt-import-dialog')).toBeNull();
  expect(chooseDialog()).toBeUndefined();
  expect(otherResolved).toBe(false);
  expect(container.querySelector('dialog.app-dialog-confirm')?.textContent).toContain('別の確認');
  expect(preview()).toBe('ONのタグがありません');
  expect(field('steps')?.value).toBe('19');
});

it('aborts applying and returns to preview when a backup finishes while the confirmation is open', async () => {
  let release!: () => void;
  vi.mocked(replaceAllEntries).mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  const added = createPreset('追加', normalizeWorkspace({
    base: { quality: [{ tag: 'backup-tag', enabled: true, weight: 1 }] },
  }));
  await click(button('設定'));
  await waitForMount('input[accept*="json"]');
  const input = container.querySelector<HTMLInputElement>('input[accept*="json"]');
  if (!input) throw new Error('バックアップの入力がありません');
  const file = new File([toBackupJSON({
    dictionary: [],
    presets: [preset, added],
    workspace: normalizeWorkspace({ base: { quality: [{ tag: 'backup-tag' }] } }),
    settings: { ...DEFAULT_SETTINGS, characterNegativePrompt: 'blurry' },
    generation: normalizeGeneration({ steps: 19, seed: 11 }),
  })], 'backup.json', { type: 'application/json' });
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(button('読み込む', container.querySelector('dialog.app-dialog-confirm')!));
  if (!release) throw new Error('辞書の保存が始まっていません');

  await click(button('編集'));
  const dialog = await dropImport();
  await click(button('適用', dialog));
  expect(chooseDialog()?.textContent).toContain('プリセット「基本」');
  await act(async () => { release(); });
  expect(preview()).toBe('backup-tag');

  await click(button('変更を反映してから適用', chooseDialog()!));
  expect(container.querySelector('.toast')?.textContent).toContain('適用を中止しました');
  expect(preview()).toBe('backup-tag');
  expect((container.querySelector('.prompt-import-dialog') as HTMLDialogElement | null)?.open).toBe(true);

  await click(button('適用', container.querySelector('.prompt-import-dialog')!));
  const confirm = container.querySelector('dialog.app-dialog-confirm');
  expect(confirm?.textContent).toContain('今のタグはプリセットに保存されていません');
  await click(button('適用', confirm!));
  expect(preview()).toBe('standing');
  const search = container.querySelector<HTMLInputElement>('.preset-search input');
  if (!search) throw new Error('プリセット検索がありません');
  await act(async () => { search.focus(); });
  expect(container.textContent).toContain('追加');
});

it('aborts applying and uses the updated preview when the dictionary changes while the confirmation is open', async () => {
  let release!: () => void;
  vi.mocked(replaceAllEntries).mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  await click(button('設定'));
  await waitForMount('.settings-nav-btn');
  await click(container.querySelector<HTMLButtonElement>('.settings-nav-btn')!);
  await waitForMount('input[accept*="csv"]');
  const input = container.querySelector<HTMLInputElement>('input[accept*="csv"]');
  if (!input) throw new Error('辞書の入力がありません');
  const file = new File(['tag,category\ngirl,appearance\n'], 'dict.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => 'tag,category\ngirl,appearance\n' });
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(button('追加・上書き'));
  if (!release) throw new Error('辞書の保存が始まっていません');

  await click(button('編集'));
  const dialog = await dropImport();
  expect(dialog.textContent).toContain('キャラ1　1件（未分類 1件）');
  await click(button('適用', dialog));
  await act(async () => { release(); });
  expect(container.querySelector('.prompt-import-dialog')?.textContent).toContain('外見 1件');

  await click(button('反映せずに適用', chooseDialog()!));
  expect(container.querySelector('.toast')?.textContent).toContain('適用を中止しました');
  expect(preview()).toBe('existing');

  await click(button('適用', container.querySelector('.prompt-import-dialog')!));
  await click(button('反映せずに適用', chooseDialog()!));
  expect(preview()).toBe('standing');
  await click(container.querySelectorAll<HTMLButtonElement>('.editor-tablist [role="tab"]')[1]!);
  expect(container.querySelector('select[aria-label="girl の移動先カテゴリ"]')).toBeNull();
  expect(container.textContent).toContain('girl');
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

it('restores a metadata-less history image via fallback and undoes the import', async () => {
  const { requestImages } = await import('../src/lib/novelai');
  vi.mocked(requestImages).mockResolvedValueOnce([{ blob: new Blob([pngFixture()]) }]);
  sessionStorage.setItem('nai-tagdeck.token', 'test-token');
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<DialogProvider><DialogSpy /><App onResetAll={() => {}} /></DialogProvider>));
  await click(container.querySelector<HTMLButtonElement>('.tab-generate')!);
  await click(button('生成する'));
  expect(container.querySelector('.thumb-btn')).not.toBeNull();

  await click(button('編集'));
  await click(button('existing を削除'));
  expect(preview()).toBe('ONのタグがありません');

  await click(container.querySelector<HTMLButtonElement>('.tab-generate')!);
  await click(container.querySelector<HTMLButtonElement>('.thumb-btn')!);
  await waitForMount('.viewer');
  await click(button('プロンプトを読み込む', container.querySelector('.viewer')!));
  await waitForMount('.prompt-import-dialog');
  await vi.waitFor(() => {
    if (!container.querySelector('.prompt-import-summary, .prompt-import-dialog [role="alert"]')) {
      throw new Error('waiting for import result');
    }
  }, { timeout: 5000 });
  const dialog = container.querySelector('.prompt-import-dialog');
  if (!dialog) throw new Error('取り込みダイアログがありません');
  expect(dialog.textContent).toContain('履歴に保持していた送信情報から読み込みました');
  await click(dialog.querySelector('input[type="checkbox"]')!);
  await click(button('適用', dialog));
  await click(button('反映せずに適用', chooseDialog()!));
  expect(preview()).toBe('existing');

  await click(button('existing を削除'));
  expect(preview()).toBe('ONのタグがありません');
  await click(button('元に戻す'));
  expect(preview()).toBe('existing');
  await click(button('元に戻す'));
  expect(preview()).toBe('ONのタグがありません');
  await click(button('やり直す'));
  expect(preview()).toBe('existing');
});

it('closes the preview dialog natively before unmounting when no confirmation is needed', async () => {
  await click(button('変更を上書き'));
  const dialog = await dropImport();
  const closeSpy = vi.spyOn(dialog as HTMLDialogElement, 'close');
  await click(button('適用', dialog));
  expect(closeSpy).toHaveBeenCalledOnce();
  expect(container.querySelector('.prompt-import-dialog')).toBeNull();
  expect(preview()).toBe('standing');
});

it('imports a custom PNG size and undoes it back to the preset size', async () => {
  const customBytes = pngFixture({
    v4_prompt: caption('standing', ['girl']),
    v4_negative_prompt: caption('old negative', ['imported neg']),
    width: 896, height: 1152, seed: 42, steps: 28,
  });
  const customFile = new File([customBytes], 'custom.png', { type: 'image/png' });
  Object.defineProperty(customFile, 'arrayBuffer', { value: async () => customBytes.buffer });
  const target = container.querySelector('.editor')!;
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [customFile] } });
  await act(async () => target.dispatchEvent(event));
  const dialog = container.querySelector('.prompt-import-dialog');
  if (!dialog) throw new Error('取り込みダイアログがありません');
  expect(dialog.textContent).toContain('サイズ カスタム 896×1152');
  await click(dialog.querySelector('input[type="checkbox"]')!);
  await click(button('適用', dialog));
  await click(button('反映せずに適用', chooseDialog()!));
  expect(preview()).toBe('standing');
  expect(checkedSizeLabel()).toBe('カスタム 896×1152');
  expect(field('custom-width')?.value).toBe('896');
  expect(field('custom-height')?.value).toBe('1152');

  await click(button('元に戻す'));
  expect(preview()).toBe('existing');
  expect(checkedSizeLabel()).toBe('縦 832×1216');

  await click(button('やり直す'));
  expect(preview()).toBe('standing');
  expect(checkedSizeLabel()).toBe('カスタム 896×1152');
  expect(field('custom-width')?.value).toBe('896');
  expect(field('custom-height')?.value).toBe('1152');
});
