// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { Editor } from '../src/components/Editor';
import type { Dictionary } from '../src/hooks/useDictionary';
import type { PresetStore } from '../src/hooks/usePresets';
import { PROMPT_CATEGORY_KEYS } from '../src/lib/categories';
import { loadCategoryOpen } from '../src/lib/categoryOpen';
import { emptyGroups, emptyWorkspace } from '../src/lib/workspace';
import type { WorkTag, Workspace } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const dictionary = {
  entries: [],
  loaded: true,
  error: null,
  save: async () => {},
  saveMany: async () => {},
  remove: async () => {},
  importEntries: async () => 0,
  restoreInitial: async () => 0,
} satisfies Dictionary;

const presets = {
  presets: [],
  persistence: [],
  setPresets: () => {},
  activeId: null,
  setActiveId: () => {},
} satisfies PresetStore;

function workTag(id: string, name: string, enabled = true): WorkTag {
  return { id, tag: name, enabled, weight: 1 };
}

function sampleWorkspace(): Workspace {
  const workspace = emptyWorkspace();
  workspace.base.appearance = [workTag('long', 'long hair'), workTag('short', 'short hair', false)];
  const left = { id: 'c0', name: '左', enabled: true, tags: emptyGroups() };
  const middle = { id: 'c1', name: '中', enabled: true, tags: emptyGroups() };
  const right = { id: 'c2', name: '右', enabled: true, tags: emptyGroups() };
  middle.tags.outfit = [workTag('uni', 'school uniform')];
  middle.tags.appearance = [workTag('hat', 'hat', false)];
  workspace.characters = [left, middle, right];
  return workspace;
}

let container: HTMLDivElement;
let root: Root;
const dispatch = vi.fn();

const textOf = (selector: string) => container.querySelector(selector)?.textContent ?? '';
const categoryButtons = () => [...container.querySelectorAll<HTMLButtonElement>('.category .disclosure')];
const button = (label: string) => {
  const found = [...container.querySelectorAll('button')].find((el) => el.textContent === label);
  if (!found) throw new Error(`ボタンがありません: ${label}`);
  return found;
};

async function click(label: string) {
  await act(async () => button(label).click());
}

async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="タグを検索"]');
  if (!input) throw new Error('検索欄がありません');
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  window.scrollTo = () => {};
  localStorage.clear();
  dispatch.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <DialogProvider>
      <Editor
        workspace={sampleWorkspace()}
        dispatch={dispatch}
        loaded
        dictionary={dictionary}
        syntax="numeric"
        onCopy={() => {}}
        notify={() => {}}
        presets={presets}
        characterNegative=""
        onCharacterNegativeChange={() => {}}
        shown
      />
    </DialogProvider>,
  ));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('searches the open pane, keeps ON tags, and highlights matches', async () => {
  expect(textOf('.tag-filter-count')).toBe('');
  await click('ONのみ');
  expect(button('ONのみ').getAttribute('aria-pressed')).toBe('true');
  expect(container.textContent).toContain('long hair');
  expect(container.textContent).not.toContain('short hair');
  expect(textOf('.tag-filter-count')).toBe('該当 1件');

  await click('ONのみ');
  await search('HAIR');
  expect(textOf('.tag-filter-count')).toBe('該当 2件');
  expect([...container.querySelectorAll('.tag-name mark')].map((mark) => mark.textContent)).toEqual(['hair', 'hair']);
  expect(container.textContent).not.toContain('lowres');

  await search('uniform');
  expect(textOf('.tag-filter-count')).toBe('該当 0件');
  await click('中');
  expect(textOf('.tag-filter-count')).toBe('該当 1件');
  expect(container.querySelector('.tag-name mark')?.textContent).toBe('uniform');
  expect(container.textContent).not.toContain('hat');
  const input = container.querySelector<HTMLInputElement>('input[aria-label="タグを検索"]')!;
  expect(input.value).toBe('uniform');
});

it('opens and closes every category in the current pane and restores that state', async () => {
  await click('すべて閉じる');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'false')).toBe(true);
  for (const key of PROMPT_CATEGORY_KEYS) expect(loadCategoryOpen('base', key)).toBe(false);
  expect(categoryButtons().find((item) => item.textContent?.includes('外見'))?.textContent).toContain('1件ON');

  await search('hair');
  expect(categoryButtons().find((item) => item.textContent?.includes('外見'))?.textContent).toContain('該当 2件');
  expect(categoryButtons().find((item) => item.textContent?.includes('未分類'))?.textContent).toContain('該当 0件');

  await click('すべて開く');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'true')).toBe(true);
  expect(categoryButtons().find((item) => item.textContent?.includes('外見'))?.textContent).toContain('1/2 · 該当 2件');

  await search('');
  await click('中');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'true')).toBe(true);
  await click('すべて閉じる');
  expect(loadCategoryOpen('c1', 'outfit')).toBe(false);
  expect(loadCategoryOpen('base', 'outfit')).toBe(true);

  await click('ベース');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'true')).toBe(true);
  await click('すべて閉じる');
  await click('中');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'false')).toBe(true);
  await click('ベース');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'false')).toBe(true);

  const appearance = categoryButtons().find((item) => item.textContent?.includes('外見'));
  await act(async () => appearance?.click());
  expect(loadCategoryOpen('base', 'appearance')).toBe(true);
  expect(loadCategoryOpen('base', 'outfit')).toBe(false);
});

it('moves a character left and right along the tab row', async () => {
  await click('中');
  const moveLeft = container.querySelector<HTMLButtonElement>('button[aria-label="中 を左へ"]')!;
  const moveRight = container.querySelector<HTMLButtonElement>('button[aria-label="中 を右へ"]')!;
  expect(moveLeft.textContent).toBe('←');
  expect(moveRight.textContent).toBe('→');
  expect(moveLeft.disabled).toBe(false);
  expect(moveRight.disabled).toBe(false);
  await act(async () => moveLeft.click());
  expect(dispatch).toHaveBeenCalledWith({ type: 'moveCharacter', id: 'c1', delta: -1 });

  await click('左');
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="左 を左へ"]')!.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="左 を右へ"]')!.disabled).toBe(false);
  await click('右');
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="右 を右へ"]')!.disabled).toBe(true);
});
