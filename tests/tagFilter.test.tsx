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
import type { DictEntry, WorkTag, Workspace } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function entry(tag: string, category: DictEntry['category'], alias = '', weight = 1): DictEntry {
  return { id: `${category}:${tag}`, tag, category, alias, default_weight: weight, sort_order: 0, updated_at: '' };
}

const dictionary = {
  entries: [
    entry('blonde hair', 'appearance', '金髪', 1.2),
    entry('blue jacket', 'outfit'),
    entry('sunny park', 'background'),
    entry('ambiguous', 'appearance'),
    entry('ambiguous', 'outfit'),
  ],
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
const searchInput = () => container.querySelector<HTMLInputElement>('input[aria-label="タグを検索"]');
const searchToggle = () => container.querySelector<HTMLButtonElement>('button[aria-label^="タグ検索を"]')!;
const button = (label: string) => {
  const found = [...container.querySelectorAll('button')].find((el) => el.textContent === label);
  if (!found) throw new Error(`ボタンがありません: ${label}`);
  return found;
};

async function click(label: string) {
  await act(async () => button(label).click());
}

async function chooseDisplayAction(label: string) {
  const menu = container.querySelector<HTMLDetailsElement>('.tag-list-actions details')!;
  const trigger = menu.querySelector<HTMLElement>('summary')!;
  expect(menu.open).toBe(false);
  await act(async () => trigger.click());
  expect(menu.open).toBe(true);
  await click(label);
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function search(value: string) {
  if (!searchInput()) await act(async () => searchToggle().click());
  await type(searchInput()!, value);
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
  const displayMenu = container.querySelector<HTMLDetailsElement>('.tag-list-actions details')!;
  const displayTrigger = displayMenu.querySelector<HTMLElement>('summary')!;
  await act(async () => displayTrigger.click());
  await act(async () => displayTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(displayMenu.open).toBe(false);
  expect(document.activeElement).toBe(displayTrigger);
  await act(async () => displayTrigger.click());
  await act(async () => searchToggle().dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(displayMenu.open).toBe(false);

  expect(searchInput()).toBeNull();
  expect(searchToggle().getAttribute('aria-expanded')).toBe('false');
  expect(textOf('.tag-filter-count')).toBe('');
  await chooseDisplayAction('ONのみ');
  expect(button('ONのみ').getAttribute('aria-pressed')).toBe('true');
  expect(textOf('.tag-list-actions summary')).toBe('表示（ONのみ）');
  expect(container.textContent).toContain('long hair');
  expect(container.textContent).not.toContain('short hair');
  expect(textOf('.tag-filter-count')).toBe('該当 1件');

  await chooseDisplayAction('ONのみ');
  await search('HAIR');
  expect(document.activeElement).toBe(searchInput());
  expect(searchToggle().getAttribute('aria-expanded')).toBe('true');
  expect(textOf('.tag-filter-count')).toBe('該当 2件');
  expect([...container.querySelectorAll('.tag-name mark')].map((mark) => mark.textContent)).toEqual(['hair', 'hair']);
  expect(container.textContent).not.toContain('lowres');

  await search('uniform');
  expect(textOf('.tag-filter-count')).toBe('該当 0件');
  await click('中');
  expect(textOf('.tag-filter-count')).toBe('該当 1件');
  expect(container.querySelector('.tag-name mark')?.textContent).toBe('uniform');
  expect(container.textContent).not.toContain('hat');
  expect(searchInput()?.value).toBe('uniform');

  await act(async () => searchInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(searchInput()).toBeNull();
  expect(document.activeElement).toBe(searchToggle());
  expect(container.textContent).toContain('hat');
  await act(async () => searchToggle().click());
  expect(searchInput()?.value).toBe('');
  await act(async () => searchToggle().click());
  expect(searchInput()).toBeNull();
});

it('adds tags across the selected pane using dictionary categories and keeps unclassified input', async () => {
  const baseInput = container.querySelector<HTMLInputElement>('input[aria-label="ベースにタグを追加"]')!;
  await type(baseInput, '金髪');
  const candidate = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.includes('blonde hair'))!;
  expect(candidate.textContent).toContain('外見');
  await act(async () => candidate.click());
  expect(dispatch).toHaveBeenLastCalledWith({ type: 'add', target: 'base', category: 'appearance', tag: 'blonde hair', weight: 1.2 });

  await click('中');
  const characterInput = container.querySelector<HTMLInputElement>('input[aria-label="中にタグを追加"]')!;
  await type(characterInput, '1.4::BLUE_JACKET::, sunny park, ambiguous, custom tag');
  await act(async () => characterInput.parentElement!.querySelector<HTMLButtonElement>('button')!.click());
  expect(dispatch.mock.calls.slice(1)).toEqual([
    [{
      type: 'addMany',
      items: [
        { target: 'c1', category: 'outfit', tag: 'BLUE_JACKET', weight: 1.4 },
        { target: 'c1', category: 'unclassified', tag: 'sunny park', weight: 1 },
        { target: 'c1', category: 'unclassified', tag: 'ambiguous', weight: 1 },
        { target: 'c1', category: 'unclassified', tag: 'custom tag', weight: 1 },
      ],
    }],
  ]);
});

it('opens and closes every category in the current pane from the display menu and restores that state', async () => {
  await chooseDisplayAction('すべて閉じる');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'false')).toBe(true);
  for (const key of PROMPT_CATEGORY_KEYS) expect(loadCategoryOpen('base', key)).toBe(false);
  expect(categoryButtons().find((item) => item.textContent?.includes('外見'))?.textContent).toContain('1件ON');

  await search('hair');
  expect(categoryButtons().find((item) => item.textContent?.includes('外見'))?.textContent).toContain('該当 2件');
  expect(categoryButtons().find((item) => item.textContent?.includes('未分類'))?.textContent).toContain('該当 0件');

  await chooseDisplayAction('すべて開く');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'true')).toBe(true);
  expect(categoryButtons().find((item) => item.textContent?.includes('外見'))?.textContent).toContain('1/2 · 該当 2件');

  await search('');
  await click('中');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'true')).toBe(true);
  await chooseDisplayAction('すべて閉じる');
  expect(loadCategoryOpen('c1', 'outfit')).toBe(false);
  expect(loadCategoryOpen('base', 'outfit')).toBe(true);

  await click('ベース');
  expect(categoryButtons().every((item) => item.getAttribute('aria-expanded') === 'true')).toBe(true);
  await chooseDisplayAction('すべて閉じる');
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

it('keeps a single top tag-add input without duplicating when switching tabs', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const addInputs = () =>
    container.querySelectorAll<HTMLInputElement>('input[placeholder="タグを追加（英語・日本語名・よみ）"]');

  try {
    expect(addInputs()).toHaveLength(1);
    for (const [tabLabel, expectedCount] of [
      ['左', 1],
      ['中', 1],
      ['ネガティブ', 0],
      ['ベース', 1],
      ['中', 1],
      ['右', 1],
      ['ベース', 1],
    ] as const) {
      await click(tabLabel);
      expect(addInputs()).toHaveLength(expectedCount);
    }
    const keyWarnings = errorSpy.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('Encountered two children with the same key')),
    );
    expect(keyWarnings).toEqual([]);
  } finally {
    errorSpy.mockRestore();
  }
});

it('matches dictionary aliases in editor search and displays inline alias hint', async () => {
  const ws = emptyWorkspace();
  ws.base.appearance = [workTag('blonde', 'blonde hair'), workTag('long', 'long hair')];
  await act(async () => root.render(
    <DialogProvider>
      <Editor
        workspace={ws}
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

  await search('金髪');
  expect(textOf('.tag-filter-count')).toBe('該当 1件');
  const rows = [...container.querySelectorAll('.tag-row')];
  expect(rows).toHaveLength(1);
  expect(rows[0]!.querySelector('.tag-name')?.textContent).toBe('blonde hair');
  expect(rows[0]!.querySelector('.tag-alias')?.textContent).toBe('金髪');
  expect(rows[0]!.querySelector('.tag-alias mark')?.textContent).toBe('金髪');
});
