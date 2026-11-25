// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
import { toBackupJSON } from '../src/lib/backup';
import { getKV, listEntries, replaceAllEntries, setKV } from '../src/lib/db';
import { normalizeGeneration } from '../src/lib/generation';
import { createPreset } from '../src/lib/presets';
import { sampleDictionary } from '../src/lib/sampleDictionary';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { normalizeWorkspace } from '../src/lib/workspace';

vi.mock('../src/lib/db', () => ({
  getKV: vi.fn(),
  listEntries: vi.fn(),
  replaceAllEntries: vi.fn(),
  setKV: vi.fn(),
}));
vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  requestImages: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
const preset = createPreset('基本', normalizeWorkspace({
  base: { quality: [{ tag: 'saved-tag', enabled: true, weight: 1 }] },
}));
const added = createPreset('追加', normalizeWorkspace({
  base: { quality: [{ tag: 'backup-tag', enabled: true, weight: 1 }] },
}));

function button(text: string, scope: ParentNode = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button'))
    .find((node) => node.textContent?.trim() === text || node.getAttribute('aria-label') === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

const click = (node: HTMLElement) => act(async () => node.click());
const preview = () => container.querySelector('output.preview-text')?.textContent;
const field = (suffix: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[id$="-${suffix}"]`);
const undoButton = () => button('元に戻す');
const dictionaryCount = () => container.querySelector('.tab-dictionary .tab-count')?.childNodes[0]?.textContent?.trim();
const presetName = () => (container.querySelector('.preset-search input') as HTMLInputElement).value;

async function openEditor() {
  await click(button('編集'));
}

async function deleteExistingTag() {
  await openEditor();
  await click(button('existing を削除'));
  expect(preview()).toBe('ONのタグがありません');
  expect(undoButton().getAttribute('aria-disabled')).toBe('false');
}

async function openBackupConfirm() {
  await click(button('設定'));
  const input = container.querySelector<HTMLInputElement>('input[accept*="json"]');
  if (!input) throw new Error('バックアップの入力がありません');
  const file = new File([toBackupJSON({
    dictionary: [{
      id: 'dict-backup',
      tag: 'backup-only-tag',
      category: 'appearance',
      alias: '',
      default_weight: 1,
      sort_order: 0,
      updated_at: '2026-01-01T00:00:00.000Z',
    }],
    presets: [preset, added],
    workspace: normalizeWorkspace({ base: { quality: [{ tag: 'backup-tag' }] } }),
    settings: { ...DEFAULT_SETTINGS, characterNegativePrompt: 'from-backup' },
    generation: normalizeGeneration({ steps: 12, seed: 7, size: 'square' }),
  })], 'backup.json', { type: 'application/json' });
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const confirm = container.querySelector('dialog.app-dialog-confirm');
  if (!confirm) throw new Error('読み込み確認がありません');
  return confirm;
}

async function importBackup() {
  const confirm = await openBackupConfirm();
  await click(button('読み込む', confirm));
}

async function importBackupReplace() {
  const confirm = await openBackupConfirm();
  const replaceRadio = confirm.querySelector<HTMLInputElement>('input[type="radio"][value="replace"]');
  if (!replaceRadio) throw new Error('置き換えのラジオがありません');
  await click(replaceRadio);
  expect(confirm.textContent).toContain('・現在の辞書・プリセットをすべて削除し、バックアップの辞書 1件、プリセット 2件で置き換えます');
  expect(confirm.querySelector('.btn-danger')?.textContent).toBe('すべて置き換えて読み込む');
  await click(button('すべて置き換えて読み込む', confirm));
}

function pressUndo() {
  return act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  });
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
  await act(async () => root.render(<DialogProvider><App onResetAll={() => {}} /></DialogProvider>));
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

it('clears undo after a backup import so the workspace stays with the merged dictionary and settings', async () => {
  expect(dictionaryCount()).toBe('1');
  expect(presetName()).toBe('基本');
  await deleteExistingTag();

  await importBackup();
  expect(container.querySelector('.toast')?.textContent).toContain('バックアップを読み込みました');
  await openEditor();

  expect(preview()).toBe('backup-tag');
  expect(presetName()).toBe('');
  expect(dictionaryCount()).toBe('2');
  expect(field('steps')?.value).toBe('12');
  expect(field('seed')?.value).toBe('7');
  expect(field('size')?.value).toBe('square');
  await click(container.querySelector<HTMLButtonElement>('.editor-tab-negative')!);
  expect(field('character-text')?.value).toBe('from-backup');
  expect(undoButton().getAttribute('aria-disabled')).toBe('true');
  expect(button('やり直す').getAttribute('aria-disabled')).toBe('true');

  await pressUndo();
  await click(undoButton());
  expect(preview()).toBe('backup-tag');
  expect(presetName()).toBe('');
  expect(dictionaryCount()).toBe('2');
  expect(field('steps')?.value).toBe('12');
  await click(container.querySelector<HTMLButtonElement>('.editor-tab-negative')!);
  expect(field('character-text')?.value).toBe('from-backup');
  await click(container.querySelector<HTMLButtonElement>('.preset-search input')!);
  expect(container.textContent).toContain('追加');
  expect(container.textContent).toContain('基本');
});

it('replaces dictionary and presets with only the backup content when replace is chosen', async () => {
  expect(dictionaryCount()).toBe('1');
  expect(presetName()).toBe('基本');

  await importBackupReplace();
  expect(container.querySelector('.toast')?.textContent).toContain('バックアップの内容ですべて置き換えました');
  await openEditor();

  expect(preview()).toBe('backup-tag');
  expect(presetName()).toBe('');
  // 既存の辞書 1 件（standing）は消え、バックアップの 1 件だけが残る
  expect(dictionaryCount()).toBe('1');
  expect(undoButton().getAttribute('aria-disabled')).toBe('true');
  await pressUndo();
  expect(preview()).toBe('backup-tag');
  expect(dictionaryCount()).toBe('1');
  await click(container.querySelector<HTMLButtonElement>('.preset-search input')!);
  expect(container.textContent).toContain('追加');
  expect(container.textContent).toContain('基本');
});

it('keeps the imported workspace when Ctrl+Z arrives before the replacement renders', async () => {
  await deleteExistingTag();
  const confirm = await openBackupConfirm();
  // 読み込みの確定を act の外で進め、描画前の Ctrl+Z を再現する。
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    button('読み込む', confirm).click();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await act(async () => {});
  } finally {
    error.mockRestore();
  }
  await openEditor();
  expect(preview()).toBe('backup-tag');
  expect(dictionaryCount()).toBe('2');
  expect(field('steps')?.value).toBe('12');
  expect(undoButton().getAttribute('aria-disabled')).toBe('true');
  await pressUndo();
  expect(preview()).toBe('backup-tag');
});

it('clears undo when the first-run sample replaces the workspace and restores the dictionary', async () => {
  await openEditor();
  await click(button('キャラクターを追加'));
  expect(container.textContent).toContain('キャラ1');
  expect(undoButton().getAttribute('aria-disabled')).toBe('false');
  await click(button('設定'));
  await click(button('初回案内をもう一度表示'));
  const choose = Array.from(container.querySelectorAll('dialog')).find((dialog) => dialog.textContent?.includes('どの状態から始めますか'));
  const sample = choose && Array.from(choose.querySelectorAll('button')).find((node) =>
    node.querySelector('.app-dialog-choice-label')?.textContent === 'タグの例と辞書を読み込む');
  if (!sample) throw new Error('初回案内の選択肢がありません');
  await click(sample);
  const confirm = container.querySelector('dialog.app-dialog-confirm');
  if (!confirm) throw new Error('置き換え確認がありません');
  await click(button('タグの例で置き換える', confirm));

  expect(container.querySelector('.toast')?.textContent).toContain('タグの例と辞書を読み込みました');
  expect(container.textContent).toContain('サンプルキャラ');
  expect(preview()).toContain('1girl');
  expect(preview()).not.toContain('existing');
  expect(dictionaryCount()).toBe(String(sampleDictionary().length));
  expect(presetName()).toBe('');
  expect(undoButton().getAttribute('aria-disabled')).toBe('true');

  await pressUndo();
  await click(undoButton());
  expect(preview()).toContain('1girl');
  expect(preview()).not.toContain('existing');
  expect(dictionaryCount()).toBe(String(sampleDictionary().length));
  expect(presetName()).toBe('');
});
