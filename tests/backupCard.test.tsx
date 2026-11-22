// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackupCard } from '../src/components/BackupCard';
import { DialogProvider } from '../src/components/Dialogs';
import type { Backup } from '../src/lib/backup';

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

async function mount(onImport = vi.fn(async () => {}), notify = vi.fn()) {
  await act(async () => {
    root.render(
      <DialogProvider>
        <BackupCard getData={() => empty} onImport={onImport} notify={notify} />
      </DialogProvider>,
    );
  });
  return { onImport, notify };
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
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  focus.mockRestore();
  await act(async () => button('読み込む').click());
  expect(onImport).toHaveBeenCalledTimes(1);
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

it('バックアップでないファイルは確認を出さずエラーを出す', async () => {
  await mount();
  await chooseFile('{"kind":"dictionary"}', 'dict-only.json');
  expect(container.querySelector('dialog')).toBeNull();
  expect(container.querySelector('.form-error')?.textContent).toContain('バックアップファイルではありません');
});
