// @vitest-environment jsdom
import { act, useReducer, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { Editor } from '../src/components/Editor';
import type { PromptSource } from '../src/components/PromptImportDialog';
import type { Dictionary } from '../src/hooks/useDictionary';
import type { PresetStore } from '../src/hooks/usePresets';
import { emptyWorkspace, workspaceReducer } from '../src/lib/workspace';
import type { DictEntry } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const presets: PresetStore = {
  presets: [],
  persistence: [],
  setPresets: () => {},
  activeId: null,
  setActiveId: () => {},
};

interface HarnessApi {
  setEntries: (next: DictEntry[]) => void;
  getEntries: () => DictEntry[];
  setSave: (save: Dictionary['save']) => void;
  notifications: string[];
  pngReads: string[];
}

function Harness({ onReady }: { onReady: (api: HarnessApi) => void }) {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, emptyWorkspace);
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const notifications = useRef<string[]>([]);
  const pngReads = useRef<string[]>([]);
  const saveRef = useRef<Dictionary['save']>(async (entry) => {
    setEntries((prev) => [...prev.filter((item) => item.id !== entry.id), entry]);
  });

  onReady({
    setEntries,
    getEntries: () => entries,
    setSave: (save) => {
      saveRef.current = save;
    },
    notifications: notifications.current,
    pngReads: pngReads.current,
  });

  const dictionary: Dictionary = {
    entries,
    loaded: true,
    error: null,
    save: (entry) => saveRef.current(entry),
    saveMany: async () => {},
    remove: async () => {},
    importEntries: async () => 0,
    restoreInitial: async () => 0,
    reload: async () => {},
  };

  return (
    <DialogProvider>
      <Editor
        workspace={workspace}
        dispatch={dispatch}
        loaded
        dictionary={dictionary}
        syntax="numeric"
        onCopy={() => {}}
        notify={(message) => {
          notifications.current.push(message);
        }}
        presets={presets}
        onPickPng={() => {}}
        onReadPng={(source: PromptSource) => {
          pngReads.current.push(source.name);
        }}
        characterNegative=""
        onCharacterNegativeChange={() => {}}
        shown
      />
    </DialogProvider>
  );
}

let container: HTMLDivElement;
let root: Root;
let api: HarnessApi;

const dialogPrototype = HTMLDialogElement.prototype;
const dialogMethods = ['showModal', 'close'] as const;
const originalDialog = dialogMethods.map((name) => [name, Object.getOwnPropertyDescriptor(dialogPrototype, name)] as const);

function installDialogMock() {
  Object.defineProperties(dialogPrototype, {
    showModal: {
      configurable: true,
      value: function showModal(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function close(this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
}

function restoreDialogMock() {
  for (const [name, descriptor] of originalDialog) {
    if (descriptor) Object.defineProperty(dialogPrototype, name, descriptor);
    else delete dialogPrototype[name];
  }
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function addInput(label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}にタグを追加"]`);
  if (!input) throw new Error(`入力欄が見つかりません: ${label}`);
  return input;
}

async function addTag(label: string, text: string) {
  const input = addInput(label);
  await type(input, text);
  const button = input.parentElement!.querySelector('button')!;
  await click(button);
}

async function clickTab(label: string) {
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((el) => el.textContent === label);
  if (!tab) throw new Error(`タブが見つかりません: ${label}`);
  await click(tab);
}

function registerButton(tag: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${tag} を辞書に登録"]`);
}

function dialog(): HTMLDialogElement {
  const element = document.querySelector<HTMLDialogElement>('dialog.register-tag-dialog');
  if (!element) throw new Error('登録ダイアログが開いていません');
  return element;
}

function aliasInput(): HTMLInputElement {
  const input = dialog().querySelector<HTMLInputElement>('input[placeholder^="例:"]');
  if (!input) throw new Error('日本語名の入力欄がありません');
  return input;
}

async function openRegister(tag: string) {
  const button = registerButton(tag);
  if (!button) throw new Error(`登録ボタンがありません: ${tag}`);
  await act(async () => button.focus());
  await click(button);
  return dialog();
}

async function chooseCategory(key: string) {
  const select = dialog().querySelector('select');
  if (!select) throw new Error('カテゴリがありません');
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    set?.call(select, key);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function pressEnter(target: HTMLElement, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
  });
}

beforeEach(async () => {
  installDialogMock();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  window.scrollTo = () => {};
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness onReady={(next) => { api = next; }} />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  restoreDialogMock();
  vi.unstubAllGlobals();
});

it('registers a base tag with an alias, category, and weight without leaving the editor', async () => {
  await addTag('外見', 'custom flower');
  await addTag('外見', 'other bloom');
  const opened = await openRegister('custom flower');
  expect(opened.open).toBe(true);
  expect(opened.querySelector('code')?.textContent).toBe('custom flower');
  expect(document.activeElement).toBe(aliasInput());
  expect(opened.querySelector('select')?.value).toBe('appearance');
  expect(opened.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('1');

  await type(aliasInput(), '  花 はな  ');
  await chooseCategory('background');
  await type(opened.querySelector('input[type="number"]')!, '1.4');
  await pressEnter(aliasInput());

  expect(document.querySelector('dialog.register-tag-dialog')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('custom flower を編集');
  expect(api.notifications).toEqual(['「custom flower」（花 はな）を辞書に登録しました']);
  const saved = api.getEntries().find((entry) => entry.tag === 'custom flower');
  expect(saved).toMatchObject({ category: 'background', alias: '花 はな', default_weight: 1.4, sort_order: 0 });
  expect(registerButton('custom flower')).toBeNull();
  expect(container.querySelector('.tag-name[title="花 はな"]')).not.toBeNull();

  await click(container.querySelector<HTMLButtonElement>('button[aria-label="タグ検索を開く"]')!);
  await type(container.querySelector<HTMLInputElement>('input[aria-label="タグを検索"]')!, 'はな');
  expect(container.querySelector('.tag-filter-count')?.textContent).toBe('該当 1件');
  expect(container.textContent).toContain('custom flower');
  expect(container.textContent).not.toContain('other bloom');
});

it('registers from a character row and keeps an empty alias on Enter', async () => {
  await click(container.querySelector<HTMLButtonElement>('button[aria-label="キャラクターを追加"]')!);
  await clickTab('キャラ1');
  await addTag('キャラ1 / 外見', 'silver hair');
  await openRegister('silver hair');
  expect(dialog().querySelector('select')?.value).toBe('appearance');
  await pressEnter(aliasInput());
  expect(document.querySelector('dialog.register-tag-dialog')).toBeNull();
  expect(api.notifications).toEqual(['「silver hair」を辞書に登録しました']);
  expect(api.getEntries()[0]).toMatchObject({ tag: 'silver hair', category: 'appearance', alias: '', default_weight: 1 });
  expect(registerButton('silver hair')).toBeNull();
});

it('opens from the negative pane with the negative category selected', async () => {
  await clickTab('ネガティブ');
  await addTag('ネガティブ（Undesired Content）', 'blurry');
  await openRegister('blurry');
  expect(dialog().querySelector('select')?.value).toBe('negative');
  expect(dialog().querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('1');
  await type(aliasInput(), 'ぼやけ');
  await click(dialog().querySelector('button[type="submit"]')!);
  expect(api.getEntries()[0]).toMatchObject({ tag: 'blurry', category: 'negative', alias: 'ぼやけ' });
  expect(api.notifications).toEqual(['「blurry」（ぼやけ）を辞書に登録しました']);
});

it('uses the tag weight already set on the row', async () => {
  await addTag('品質', '1.23::studio lighting::');
  await openRegister('studio lighting');
  expect(dialog().querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('1.23');
  await pressEnter(aliasInput());
  expect(api.getEntries()[0]).toMatchObject({ tag: 'studio lighting', category: 'quality', default_weight: 1.23 });
});

it('does not register on Ctrl+Enter, Cmd+Enter, or a repeated Enter', async () => {
  await addTag('エフェクト', 'sparkle');
  await openRegister('sparkle');
  await type(aliasInput(), 'きらめき');
  await pressEnter(aliasInput(), { ctrlKey: true });
  await pressEnter(aliasInput(), { metaKey: true });
  await pressEnter(aliasInput(), { repeat: true });
  expect(api.getEntries()).toEqual([]);
  expect(document.querySelector('dialog.register-tag-dialog')).not.toBeNull();
  expect(aliasInput().value).toBe('きらめき');
  await pressEnter(aliasInput());
  expect(api.getEntries()[0]).toMatchObject({ tag: 'sparkle', alias: 'きらめき' });
});

it('keeps the alias and dialog open when the tag is already registered or saving fails', async () => {
  await addTag('外見', 'smile');
  await openRegister('smile');
  await type(aliasInput(), '笑顔');
  await act(async () => {
    api.setEntries([{
      id: 'existing',
      tag: 'smile',
      category: 'appearance',
      alias: '既存',
      default_weight: 1,
      sort_order: 0,
      updated_at: '',
    }]);
  });
  const submit = dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  submit.focus();
  await click(submit);
  expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('「smile」は 外見 に登録済みです');
  expect(aliasInput().value).toBe('笑顔');
  expect(document.activeElement).toBe(submit);
  expect(api.notifications).toEqual([]);

  await chooseCategory('pose');
  api.setSave(async () => {
    throw new Error('disk full');
  });
  await click(dialog().querySelector('button[type="submit"]')!);
  expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('保存できませんでした: Error: disk full');
  expect(aliasInput().value).toBe('笑顔');
  expect(dialog().querySelector('select')?.value).toBe('pose');
  expect(api.getEntries()).toHaveLength(1);
});

it('disables the actions while saving so the registration is not sent twice', async () => {
  await addTag('画風', 'watercolor');
  await openRegister('watercolor');
  let finish: () => void = () => {};
  const calls: DictEntry[] = [];
  api.setSave((entry) => {
    calls.push(entry);
    return new Promise((resolve) => {
      finish = () => resolve();
    });
  });
  const submit = dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  await click(submit);
  expect(submit.disabled).toBe(true);
  expect(dialog().querySelector<HTMLButtonElement>('button.btn:not(.btn-primary)')?.disabled).toBe(true);
  await click(submit);
  expect(calls).toHaveLength(1);
  await act(async () => finish());
  expect(document.querySelector('dialog.register-tag-dialog')).toBeNull();
});

it('does not save while an IME composition is confirming, and Escape or cancel discards the draft', async () => {
  await addTag('ポーズ', 'waving');
  await openRegister('waving');
  await type(aliasInput(), '手を振る');
  const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
  await act(async () => aliasInput().dispatchEvent(composing));
  expect(composing.defaultPrevented).toBe(false);
  expect(api.getEntries()).toEqual([]);
  expect(aliasInput().value).toBe('手を振る');

  const imeKey = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  Object.defineProperty(imeKey, 'keyCode', { value: 229 });
  await act(async () => aliasInput().dispatchEvent(imeKey));
  expect(imeKey.defaultPrevented).toBe(false);
  expect(api.getEntries()).toEqual([]);

  const select = dialog().querySelector('select')!;
  select.focus();
  const selectEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => select.dispatchEvent(selectEnter));
  expect(selectEnter.defaultPrevented).toBe(true);
  expect(api.getEntries()).toEqual([]);
  expect(dialog().querySelector('select')?.value).toBe('pose');

  const cancel = [...dialog().querySelectorAll('button')].find((button) => button.textContent === 'キャンセル')!;
  cancel.focus();
  const cancelEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => cancel.dispatchEvent(cancelEnter));
  expect(cancelEnter.defaultPrevented).toBe(false);
  expect(document.querySelector('dialog.register-tag-dialog')).not.toBeNull();

  const submit = dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  submit.focus();
  const submitEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => submit.dispatchEvent(submitEnter));
  expect(submitEnter.defaultPrevented).toBe(false);

  const cancelEvent = new Event('cancel', { bubbles: true, cancelable: true });
  await act(async () => dialog().dispatchEvent(cancelEvent));
  expect(cancelEvent.defaultPrevented).toBe(true);
  expect(document.querySelector('dialog.register-tag-dialog')).toBeNull();
  expect(api.getEntries()).toEqual([]);
  expect(registerButton('waving')).not.toBeNull();

  await openRegister('waving');
  await type(aliasInput(), '手を振る');
  await click([...dialog().querySelectorAll('button')].find((button) => button.textContent === 'キャンセル')!);
  expect(document.querySelector('dialog.register-tag-dialog')).toBeNull();
  expect(api.notifications).toEqual([]);
  expect(api.getEntries()).toEqual([]);
});

it('ignores a PNG dropped on the open registration dialog and accepts one after it closes', async () => {
  await addTag('構図', 'close-up');
  await openRegister('close-up');
  const during = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(during, 'dataTransfer', {
    value: { types: ['Files'], files: [new File(['png'], 'during.png', { type: 'image/png' })] },
  });
  await act(async () => dialog().dispatchEvent(during));
  expect(api.pngReads).toEqual([]);
  expect(document.querySelector('dialog.register-tag-dialog')).not.toBeNull();

  await click([...dialog().querySelectorAll('button')].find((button) => button.textContent === 'キャンセル')!);
  const after = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(after, 'dataTransfer', {
    value: { types: ['Files'], files: [new File(['png'], 'after.png', { type: 'image/png' })] },
  });
  await act(async () => container.querySelector('.editor')!.dispatchEvent(after));
  expect(api.pngReads).toEqual(['after.png']);
});

it('does not offer dictionary registration for an unclassified tag', async () => {
  await addTag('未分類', 'mystery tag');
  expect(registerButton('mystery tag')).toBeNull();
});
