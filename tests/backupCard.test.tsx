// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackupCard } from '../src/components/BackupCard';
import { DialogProvider } from '../src/components/Dialogs';
import { backupImportMessage, type Backup } from '../src/lib/backup';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));

let container: HTMLDivElement;
let root: Root;
const empty = {} as Backup;

function message(): string {
  return container.querySelector('.app-dialog-message')?.textContent ?? '';
}

function details(): string | null {
  return container.querySelector('.app-dialog-details')?.textContent ?? null;
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.trim() === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

async function chooseFile(text: string, name: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  dialogMethods.forEach((name, index) => {
    const descriptor = originalDialogMethods[index];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

async function mount(onImport = vi.fn(async () => {}), notify = vi.fn(), reloadCount = 0) {
  await act(async () => {
    root.render(
      <DialogProvider>
        <BackupCard getData={() => empty} onImport={onImport} notify={notify} reloadCount={reloadCount} />
      </DialogProvider>,
    );
  });
  return { onImport, notify };
}

function radio(value: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!found) throw new Error(`Radio missing: ${value}`);
  return found;
}

it('欠けたセクションは補完内容を示し、辞書のスキップ件数には数えない', async () => {
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  const { onImport, notify } = await mount();
  await chooseFile(JSON.stringify({
    kind: 'backup',
    dictionary: [{ tag: 'smile', category: 'appearance' }],
    presets: [],
    workspace: {},
    settings: {},
  }), 'partial.json');
  expect(message()).toContain('・version がないため、version 1 として読み込みます');
  expect(message()).toContain('・generation がないため、初期の生成設定で補います');
  expect(message()).toContain('・辞書 1件、プリセット 0件を追加・上書きします');
  expect(message()).not.toContain('辞書のうち');
  expect(details()).toBeNull();
  expect(container.querySelector('dialog')?.className).toContain('app-dialog-confirm');
  expect(container.querySelector('.app-dialog-scroll')?.getAttribute('tabindex')).toBeNull();
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  focus.mockRestore();
  await act(async () => button('読み込む').click());
  expect(onImport).toHaveBeenCalledTimes(1);
  expect(onImport.mock.calls[0]?.[1]).toBe('merge');
  expect(notify).toHaveBeenCalledWith('バックアップを読み込みました');
  expect(container.querySelector('.form-error')).toBeNull();
});

it('辞書の不正な行だけをスキップ件数にし、キャンセルでは読み込まない', async () => {
  const { onImport } = await mount();
  await chooseFile(JSON.stringify({
    kind: 'backup',
    version: 1,
    dictionary: [{ tag: '', category: 'quality' }, { tag: 'smile', category: 'appearance' }],
    presets: [],
    workspace: {},
    settings: {},
    generation: {},
  }), 'dict.json');
  expect(message()).toContain('・辞書のうち 1件は読めなかったためスキップします');
  expect(message()).not.toContain('1件目: tag が空です');
  expect(details()).toBe('・1件目: tag が空です');
  expect(container.querySelector('.app-dialog-details')).not.toBeNull();
  expect(message()).not.toContain('version がないため');
  await act(async () => button('キャンセル').click());
  expect(onImport).not.toHaveBeenCalled();
});

it('溢れた確認文はキーボードでスクロールできる', async () => {
  const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() { return (this as HTMLElement).classList.contains('app-dialog-scroll') ? 800 : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() { return (this as HTMLElement).classList.contains('app-dialog-scroll') ? 120 : 0; },
  });
  try {
    await mount();
    await chooseFile(JSON.stringify({
      kind: 'backup',
      dictionary: [{ tag: 'smile', category: 'appearance' }],
      presets: [],
      workspace: {},
      settings: {},
    }), 'partial.json');
    expect(container.querySelector('.app-dialog-scroll')?.getAttribute('tabindex')).toBe('0');
  } finally {
    if (scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeight);
    if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
  }
});

it('バックアップでないファイルは確認を出さずエラーを出す', async () => {
  await mount();
  await chooseFile('{"kind":"dictionary"}', 'dict-only.json');
  expect(container.querySelector('dialog')).toBeNull();
  expect(container.querySelector('.form-error')?.textContent).toContain('バックアップファイルではありません');
});

it('replace モードでは文言とボタンが切り替わり、置き換えで読み込む', async () => {
  const { onImport, notify } = await mount();
  await chooseFile(JSON.stringify({
    kind: 'backup',
    version: 1,
    dictionary: [{ tag: 'smile', category: 'appearance' }],
    presets: [],
    workspace: {},
    settings: {},
    generation: {},
  }), 'backup.json');
  expect(message()).toContain('・辞書 1件、プリセット 0件を追加・上書きします');
  expect(radio('merge').checked).toBe(true);
  expect(container.querySelector('[role="note"]')).toBeNull();
  await act(async () => radio('replace').click());
  expect(message()).toContain('・現在の辞書・プリセットをすべて削除し、バックアップの辞書 1件、プリセット 0件で置き換えます');
  expect(message()).toContain('・バックアップのプリセットは 0件のため、プリセットは空になります');
  expect(container.querySelector('[role="note"]')).not.toBeNull();
  expect(container.querySelector('.btn-danger')?.textContent).toBe('すべて置き換えて読み込む');
  await act(async () => button('すべて置き換えて読み込む').click());
  expect(onImport).toHaveBeenCalledTimes(1);
  expect(onImport.mock.calls[0]?.[1]).toBe('replace');
  expect(notify).toHaveBeenCalledWith('バックアップの内容ですべて置き換えました');
  expect(container.querySelector('.form-error')).toBeNull();
});

it('replace の確認文言は既存件数と空の辞書を示す', () => {
  const { summary } = backupImportMessage('backup.json', { dictionary: [], presets: [] }, [], [], 'replace', {
    dictionary: 3,
    presets: 2,
  });
  expect(summary).toContain('・現在の辞書・プリセットをすべて削除し、バックアップの辞書 0件、プリセット 0件で置き換えます');
  expect(summary).toContain('・現在保存されている辞書 3件、プリセット 2件のうち、バックアップにない項目は消去され、元に戻せません');
  expect(summary).toContain('・バックアップの辞書は 0件のため、辞書は空になります');
  expect(summary).toContain('・バックアップのプリセットは 0件のため、プリセットは空になります');
});

it('確認中に他タブから再読み込みされたらダイアログを閉じて中止する', async () => {
  const { onImport } = await mount(vi.fn(async () => {}), vi.fn(), 0);
  await chooseFile(JSON.stringify({
    kind: 'backup',
    version: 1,
    dictionary: [{ tag: 'smile', category: 'appearance' }],
    presets: [],
    workspace: {},
    settings: {},
    generation: {},
  }), 'backup.json');
  expect(container.querySelector('dialog')).not.toBeNull();
  await act(async () => {
    root.render(
      <DialogProvider>
        <BackupCard getData={() => empty} onImport={onImport} notify={vi.fn()} reloadCount={1} />
      </DialogProvider>,
    );
  });
  expect(container.querySelector('dialog')).toBeNull();
  expect(container.querySelector('.form-error')?.textContent).toContain('別のタブから最新データを読み込んだため');
  expect(onImport).not.toHaveBeenCalled();
});
