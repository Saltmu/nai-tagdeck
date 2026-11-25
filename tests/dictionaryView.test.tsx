// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DictionaryView } from '../src/components/DictionaryView';
import { DialogProvider } from '../src/components/Dialogs';
import type { Dictionary } from '../src/hooks/useDictionary';
import type { CategoryKey, DictEntry } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PAGE_SIZE = 300;

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: ReturnType<typeof vi.spyOn>;
const dialogPrototype = HTMLDialogElement.prototype;
const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(dialogPrototype, name));

function entry(tag: string, category: CategoryKey = 'quality'): DictEntry {
  return { id: tag, tag, category, alias: '', default_weight: 1, sort_order: 0, updated_at: '' };
}

function numbered(prefix: string, count: number, category: CategoryKey = 'quality'): DictEntry[] {
  return Array.from({ length: count }, (_, index) => entry(`${prefix}${String(index).padStart(4, '0')}`, category));
}

function dictionary(entries: DictEntry[]): Dictionary {
  return {
    entries,
    loaded: true,
    error: null,
    save: async () => {},
    saveMany: async () => {},
    remove: async () => {},
    importEntries: async () => entries.length,
    restoreInitial: async () => entries.length,
  };
}

function tags() {
  return [...container.querySelectorAll('.dict-tag')].map((node) => node.textContent);
}

function button(label: string) {
  return [...container.querySelectorAll('button')].find(
    (node) => node.textContent === label || node.getAttribute('aria-label') === label,
  ) as HTMLButtonElement | undefined;
}

async function render(entries: DictEntry[]) {
  await act(async () => {
    root.render(
      <DialogProvider>
        <DictionaryView dictionary={dictionary(entries)} notify={() => {}} />
      </DialogProvider>,
    );
  });
}

async function setSearch(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="辞書を絞り込む"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function setCategory(value: string) {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="カテゴリで絞り込む"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`${label} がありません`);
  await act(async () => target.click());
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: () => {},
  });
  scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperties(dialogPrototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  scrollIntoView?.mockRestore();
  for (const [name, descriptor] of originalDialogMethods.entries()) {
    const method = dialogMethods[name]!;
    if (descriptor) Object.defineProperty(dialogPrototype, method, descriptor);
    else Reflect.deleteProperty(dialogPrototype, method);
  }
});

it('shows the next page without rendering more than one page, and reaches the last entry', async () => {
  const entries = numbered('tag', PAGE_SIZE * 2 + 1);
  await render(entries);

  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()[0]).toBe('tag0000');
  expect(tags()).not.toContain('tag0300');
  expect(tags()).not.toContain('tag0600');
  expect(container.querySelector('.dict-count')?.textContent).toBe(`601件 / 全601件（1〜${PAGE_SIZE}件目）`);
  expect(button('前のページへ')?.disabled).toBe(true);
  expect(button('次のページへ')?.disabled).toBe(false);

  await click('次のページへ');
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  expect(document.activeElement).toBe(container.querySelector('.dict-list-card'));
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()[0]).toBe('tag0300');
  expect(tags().at(-1)).toBe('tag0599');
  expect(button('前のページへ')?.disabled).toBe(false);
  expect(button('次のページへ')?.disabled).toBe(false);

  await click('次のページへ');
  expect(tags()).toEqual(['tag0600']);
  expect(container.querySelector('.dict-count')?.textContent).toBe('601件 / 全601件（601〜601件目）');
  expect(button('次のページへ')?.disabled).toBe(true);

  await click('前のページへ');
  expect(tags()[0]).toBe('tag0300');
  expect(tags()).toHaveLength(PAGE_SIZE);
});

it('hides paging when the filtered list fits in one page', async () => {
  await render(numbered('tag', PAGE_SIZE));
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(button('次のページへ')).toBeUndefined();
  expect(button('前のページへ')).toBeUndefined();
  expect(container.querySelector('.dict-count')?.textContent).toBe('300件 / 全300件');
});

it('returns to the first page when the search query changes', async () => {
  await render([...numbered('red', 400), ...numbered('blue', 400)]);
  await click('次のページへ');
  expect(tags()[0]).toBe('red0300');

  await setSearch('red');
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()[0]).toBe('red0000');
  expect(tags()).not.toContain('red0300');
  expect(button('前のページへ')?.disabled).toBe(true);
  expect(button('次のページへ')?.disabled).toBe(false);
  expect(container.querySelector('.dict-count')?.textContent).toBe(`400件 / 全800件（1〜${PAGE_SIZE}件目）`);

  await setSearch('red0300');
  expect(tags()).toEqual(['red0300']);
  expect(button('次のページへ')).toBeUndefined();
});

it('returns to the first page when the category filter changes', async () => {
  await render([...numbered('q', 400, 'quality'), ...numbered('a', 400, 'appearance')]);
  await click('次のページへ');
  expect(tags()[0]).toBe('q0300');

  await setCategory('appearance');
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()[0]).toBe('a0000');
  expect(tags()).not.toContain('a0300');
  expect(button('前のページへ')?.disabled).toBe(true);
  expect(button('次のページへ')?.disabled).toBe(false);
  expect(container.querySelector('.dict-count')?.textContent).toBe(`400件 / 全800件（1〜${PAGE_SIZE}件目）`);
});

it('scrolls to the list and asks before discarding an open edit when the page changes', async () => {
  await render(numbered('tag', PAGE_SIZE + 1));
  const edit = container.querySelector<HTMLButtonElement>('.dict-item button')!;
  await act(async () => edit.click());
  const tagInput = container.querySelector<HTMLInputElement>('.entry-form input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(tagInput, 'changed');
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await click('次のページへ');
  const dialog = container.querySelector('dialog.app-dialog-confirm')!;
  expect(dialog.textContent).toContain('編集中の内容を破棄してページを移動しますか？');
  await act(async () => dialog.querySelector<HTMLButtonElement>('button.btn:not(.btn-danger)')!.click());
  expect(container.querySelector<HTMLInputElement>('.entry-form input')!.value).toBe('changed');
  expect(container.querySelector('.dict-item.is-editing')).not.toBeNull();
  expect(container.querySelector('.dict-count')?.textContent).toContain('1〜300');
  expect(scrollIntoView).not.toHaveBeenCalled();

  await click('次のページへ');
  const confirm = container.querySelector('dialog.app-dialog-confirm')!;
  await act(async () => confirm.querySelector<HTMLButtonElement>('button.btn-danger')!.click());
  expect(container.querySelector('.entry-form')).toBeNull();
  expect(tags()).toEqual(['tag0300']);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });

  await click('前のページへ');
  expect(tags()[0]).toBe('tag0000');
  expect(container.querySelector('.entry-form')).toBeNull();
});

it('keeps the clamped page after the last page disappears and an entry is added again', async () => {
  const initial = numbered('tag', PAGE_SIZE + 1);
  function Harness() {
    const [entries, setEntries] = useState(initial);
    return (
      <>
        <button type="button" onClick={() => setEntries((list) => list.slice(0, -1))}>1件減らす</button>
        <button type="button" onClick={() => setEntries((list) => [...list, entry('added')])}>1件増やす</button>
        <DictionaryView dictionary={dictionary(entries)} notify={() => {}} />
      </>
    );
  }
  await act(async () => {
    root.render(
      <DialogProvider>
        <Harness />
      </DialogProvider>,
    );
  });

  await click('次のページへ');
  expect(tags()).toEqual(['tag0300']);

  await click('1件減らす');
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()[0]).toBe('tag0000');
  expect(button('次のページへ')).toBeUndefined();

  await click('1件増やす');
  expect(tags()[0]).toBe('tag0000');
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()).not.toContain('added');
  expect(button('次のページへ')?.disabled).toBe(false);
});

it('places a single pager after the rows with first/prev/numbers/next/last', async () => {
  await render(numbered('tag', PAGE_SIZE * 2 + 1));
  const pagers = [...container.querySelectorAll('nav.dict-pager')];
  expect(pagers).toHaveLength(1);
  expect(pagers[0]!.getAttribute('aria-label')).toBe('ページ');
  const list = container.querySelector('.dict-list')!;
  expect(pagers[0]!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  expect([...pagers[0]!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
    '|<<', '<', '1', '2', '3', '>', '>>|',
  ]);
  expect(button('最初のページへ')?.disabled).toBe(true);
  expect(button('前のページへ')?.disabled).toBe(true);
  expect(button('次のページへ')?.disabled).toBe(false);
  expect(button('最後のページへ')?.disabled).toBe(false);
  expect(button('1')?.getAttribute('aria-current')).toBe('page');

  await click('3');
  expect(tags()).toEqual(['tag0600']);
  expect(button('3')?.getAttribute('aria-current')).toBe('page');
  expect(button('次のページへ')?.disabled).toBe(true);
  expect(button('最後のページへ')?.disabled).toBe(true);

  await click('|<<');
  expect(tags()[0]).toBe('tag0000');
  expect(button('1')?.getAttribute('aria-current')).toBe('page');
});

it('asks before a filter change hides the open editor and keeps the draft on cancel', async () => {
  await render(numbered('tag', PAGE_SIZE + 1));
  await click('次のページへ');
  const edit = container.querySelector<HTMLButtonElement>('.dict-item button')!;
  await act(async () => edit.click());
  const tagInput = container.querySelector<HTMLInputElement>('.entry-form input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(tagInput, 'changed');
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await setSearch('tag ');
  const dialog = container.querySelector('dialog.app-dialog-confirm')!;
  expect(dialog.textContent).toContain('編集中の内容を破棄して絞り込みを変えますか？');
  await act(async () => dialog.querySelector<HTMLButtonElement>('button.btn:not(.btn-danger)')!.click());
  expect(container.querySelector<HTMLInputElement>('input[aria-label="辞書を絞り込む"]')!.value).toBe('');
  expect(container.querySelector<HTMLInputElement>('.entry-form input')!.value).toBe('changed');
  expect(container.querySelector('.dict-count')?.textContent).toContain('301〜');

  await setSearch('tag ');
  const confirm = container.querySelector('dialog.app-dialog-confirm')!;
  await act(async () => confirm.querySelector<HTMLButtonElement>('button.btn-danger')!.click());
  expect(container.querySelector('.entry-form')).toBeNull();
  expect(tags()[0]).toBe('tag0000');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="辞書を絞り込む"]')!.value).toBe('tag ');
});

it('applies a filter without asking when the open editor stays on the first page', async () => {
  await render(numbered('tag', PAGE_SIZE + 1));
  const edit = container.querySelector<HTMLButtonElement>('.dict-item button')!;
  await act(async () => edit.click());
  await setSearch('tag0000');
  expect(container.querySelector('dialog.app-dialog-confirm')).toBeNull();
  expect(container.querySelector('.entry-form')).not.toBeNull();
  expect(container.querySelector('.dict-count')?.textContent).toBe('1件 / 全301件');
});

it('keeps an in-progress search composition and asks only after it ends', async () => {
  await render(numbered('tag', PAGE_SIZE + 1));
  await click('次のページへ');
  const edit = container.querySelector<HTMLButtonElement>('.dict-item button')!;
  await act(async () => edit.click());
  const tagInput = container.querySelector<HTMLInputElement>('.entry-form input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(tagInput, 'changed');
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const search = container.querySelector<HTMLInputElement>('input[aria-label="辞書を絞り込む"]')!;
  await act(async () => {
    search.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  });
  await setSearch('あ');
  expect(container.querySelector('dialog.app-dialog-confirm')).toBeNull();
  expect(search.value).toBe('あ');
  expect(container.querySelector<HTMLInputElement>('.entry-form input')!.value).toBe('changed');
  expect(container.querySelector('.dict-count')?.textContent).toContain('301〜');

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'tag ');
    search.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  const dialog = container.querySelector('dialog.app-dialog-confirm')!;
  expect(dialog.textContent).toContain('編集中の内容を破棄して絞り込みを変えますか？');
  await act(async () => dialog.querySelector<HTMLButtonElement>('button.btn:not(.btn-danger)')!.click());
  expect(search.value).toBe('');
  expect(container.querySelector<HTMLInputElement>('.entry-form input')!.value).toBe('changed');
});

it('follows an edited row onto its new page when dictionary order changes', async () => {
  const initial = numbered('tag', PAGE_SIZE * 2);
  function Harness() {
    const [entries, setEntries] = useState(initial);
    return (
      <>
        <button type="button" onClick={() => setEntries((list) => [entry('aaa'), ...list])}>先頭に追加</button>
        <DictionaryView dictionary={dictionary(entries)} notify={() => {}} />
      </>
    );
  }
  await act(async () => {
    root.render(
      <DialogProvider>
        <Harness />
      </DialogProvider>,
    );
  });

  await click('次のページへ');
  const edit = [...container.querySelectorAll<HTMLButtonElement>('.dict-item button')].at(-2)!;
  expect(edit.textContent).toBe('編集');
  await act(async () => edit.click());
  const tagInput = container.querySelector<HTMLInputElement>('.entry-form input')!;
  expect(tagInput.value).toBe('tag0599');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(tagInput, 'changed');
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await click('先頭に追加');
  expect(container.querySelector<HTMLInputElement>('.entry-form input')!.value).toBe('changed');
  expect(container.querySelector('.dict-count')?.textContent).toContain('601〜601');
  expect(tags()).not.toContain('aaa');
});

it('does not discard an edit when IME composition ends on the same search text', async () => {
  await render(numbered('tag', PAGE_SIZE + 1));
  await click('次のページへ');
  const edit = container.querySelector<HTMLButtonElement>('.dict-item button')!;
  await act(async () => edit.click());
  const tagInput = container.querySelector<HTMLInputElement>('.entry-form input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(tagInput, 'changed');
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const search = container.querySelector<HTMLInputElement>('input[aria-label="辞書を絞り込む"]')!;
  await act(async () => {
    search.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  });
  await setSearch('あ');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '');
    search.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  expect(container.querySelector('dialog.app-dialog-confirm')).toBeNull();
  expect(search.value).toBe('');
  expect(container.querySelector<HTMLInputElement>('.entry-form input')!.value).toBe('changed');
  expect(container.querySelector('.dict-count')?.textContent).toContain('301〜');
});

it('does not offer to discard a row while its save is still running', async () => {
  let releaseSave: () => void = () => {};
  const save = vi.fn(() => new Promise<void>((resolve) => {
    releaseSave = resolve;
  }));
  const entries = numbered('tag', PAGE_SIZE * 2 + 1);
  await act(async () => {
    root.render(
      <DialogProvider>
        <DictionaryView dictionary={{ ...dictionary(entries), save }} notify={() => {}} />
      </DialogProvider>,
    );
  });
  await click('次のページへ');
  expect(button('次のページへ')?.disabled).toBe(false);
  const edit = container.querySelector<HTMLButtonElement>('.dict-item button')!;
  await act(async () => edit.click());
  await click('保存');
  expect(save).toHaveBeenCalledOnce();
  expect(button('次のページへ')?.disabled).toBe(true);
  expect(container.querySelector('dialog.app-dialog-confirm')).toBeNull();
  expect(container.querySelector('.entry-form')).not.toBeNull();

  await act(async () => releaseSave());
  expect(container.querySelector('.entry-form')).toBeNull();
  expect(button('次のページへ')?.disabled).toBe(false);
});
