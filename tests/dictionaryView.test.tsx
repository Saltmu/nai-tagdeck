// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DictionaryView } from '../src/components/DictionaryView';
import { DialogProvider } from '../src/components/Dialogs';
import type { Dictionary } from '../src/hooks/useDictionary';
import type { CategoryKey, DictEntry } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PAGE_SIZE = 300;

let container: HTMLDivElement;
let root: Root;

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
  return [...container.querySelectorAll('button')].find((node) => node.textContent === label) as HTMLButtonElement | undefined;
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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('shows the next page without rendering more than one page, and reaches the last entry', async () => {
  const entries = numbered('tag', PAGE_SIZE * 2 + 1);
  await render(entries);

  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()[0]).toBe('tag0000');
  expect(tags()).not.toContain('tag0300');
  expect(tags()).not.toContain('tag0600');
  expect(container.querySelector('.dict-count')?.textContent).toBe(`601件 / 全601件（1〜${PAGE_SIZE}件目）`);
  expect(button('前を表示')?.disabled).toBe(true);
  expect(button('さらに表示')?.disabled).toBe(false);

  await click('さらに表示');
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()[0]).toBe('tag0300');
  expect(tags().at(-1)).toBe('tag0599');
  expect(button('前を表示')?.disabled).toBe(false);
  expect(button('さらに表示')?.disabled).toBe(false);

  await click('さらに表示');
  expect(tags()).toEqual(['tag0600']);
  expect(container.querySelector('.dict-count')?.textContent).toBe('601件 / 全601件（601〜601件目）');
  expect(button('さらに表示')?.disabled).toBe(true);

  await click('前を表示');
  expect(tags()[0]).toBe('tag0300');
  expect(tags()).toHaveLength(PAGE_SIZE);
});

it('hides paging when the filtered list fits in one page', async () => {
  await render(numbered('tag', PAGE_SIZE));
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(button('さらに表示')).toBeUndefined();
  expect(button('前を表示')).toBeUndefined();
  expect(container.querySelector('.dict-count')?.textContent).toBe('300件 / 全300件');
});

it('returns to the first page when the search query changes', async () => {
  await render([...numbered('red', 400), ...numbered('blue', 400)]);
  await click('さらに表示');
  expect(tags()[0]).toBe('red0300');

  await setSearch('red');
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()[0]).toBe('red0000');
  expect(tags()).not.toContain('red0300');
  expect(button('前を表示')?.disabled).toBe(true);
  expect(button('さらに表示')?.disabled).toBe(false);
  expect(container.querySelector('.dict-count')?.textContent).toBe(`400件 / 全800件（1〜${PAGE_SIZE}件目）`);

  await setSearch('red0300');
  expect(tags()).toEqual(['red0300']);
  expect(button('さらに表示')).toBeUndefined();
});

it('returns to the first page when the category filter changes', async () => {
  await render([...numbered('q', 400, 'quality'), ...numbered('a', 400, 'appearance')]);
  await click('さらに表示');
  expect(tags()[0]).toBe('q0300');

  await setCategory('appearance');
  expect(tags()).toHaveLength(PAGE_SIZE);
  expect(tags()[0]).toBe('a0000');
  expect(tags()).not.toContain('a0300');
  expect(button('前を表示')?.disabled).toBe(true);
  expect(button('さらに表示')?.disabled).toBe(false);
  expect(container.querySelector('.dict-count')?.textContent).toBe(`400件 / 全800件（1〜${PAGE_SIZE}件目）`);
});
