// @vitest-environment jsdom
import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { Editor } from '../src/components/Editor';
import { useTagUndo } from '../src/hooks/useTagUndo';
import type { Dictionary } from '../src/hooks/useDictionary';
import type { PresetStore } from '../src/hooks/usePresets';
import { emptyWorkspace, workspaceReducer } from '../src/lib/workspace';
import type { DictEntry, Workspace } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function entry(tag: string, category: DictEntry['category'], alias = '', weight = 1): DictEntry {
  return { id: `${category}:${tag}`, tag, category, alias, default_weight: weight, sort_order: 0, updated_at: '' };
}

const dictionary = {
  entries: [
    entry('long hair', 'appearance'),
    entry('blue jacket', 'outfit'),
    entry('sunny park', 'background'),
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

let container: HTMLDivElement;
let root: Root;
let ws: Workspace;
let history: ReturnType<typeof useTagUndo>;

function Harness({ initial }: { initial: Workspace }) {
  const [workspace, dispatch] = useReducer(workspaceReducer, initial);
  ws = workspace;
  history = useTagUndo(workspace, dispatch);
  return (
    <DialogProvider>
      <Editor
        workspace={workspace}
        loaded
        dispatch={history.dispatch}
        dictionary={dictionary}
        presets={presets}
        syntax="numeric"
        onCopy={() => {}}
        notify={() => {}}
        characterNegative=""
        onCharacterNegativeChange={() => {}}
        shown
      />
    </DialogProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('undoes top-level comma-separated TagInput addition in a single step', async () => {
  await act(async () => root.render(<Harness initial={emptyWorkspace()} />));
  const input = container.querySelector<HTMLInputElement>('input[aria-label="ベースにタグを追加"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, '1.2::long hair::, blue jacket, sunny park');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const addButton = input.parentElement!.querySelector<HTMLButtonElement>('button')!;
  await act(async () => addButton.click());

  expect(ws.base.appearance.map((t) => ({ tag: t.tag, weight: t.weight }))).toEqual([{ tag: 'long hair', weight: 1.2 }]);
  expect(ws.base.outfit.map((t) => t.tag)).toEqual(['blue jacket']);
  expect(ws.base.background.map((t) => t.tag)).toEqual(['sunny park']);

  await act(async () => history.undo());
  expect(ws.base.appearance).toEqual([]);
  expect(ws.base.outfit).toEqual([]);
  expect(ws.base.background).toEqual([]);
  expect(history.canUndo).toBe(false);
});

it('undoes adding default negative tags in a single step', async () => {
  const initial = { ...emptyWorkspace(), negative: [] };
  await act(async () => root.render(<Harness initial={initial} />));
  const negativeTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((tab) => tab.textContent?.includes('ネガティブ'))!;
  await act(async () => negativeTab.click());

  const addDefaultsButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent === '既定のタグを追加')!;
  await act(async () => addDefaultsButton.click());
  expect(ws.negative.length).toBeGreaterThan(1);

  await act(async () => history.undo());
  expect(ws.negative).toEqual([]);
  expect(history.canUndo).toBe(false);

  await act(async () => history.redo());
  expect(ws.negative.length).toBeGreaterThan(1);
});

it('undoes category clipboard paste in a single step', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { readText: async () => '1.2::jacket::, shirt, boots' },
  });
  await act(async () => root.render(<Harness initial={emptyWorkspace()} />));
  const outfitDisclosure = [...container.querySelectorAll<HTMLButtonElement>('.disclosure')]
    .find((btn) => btn.textContent?.includes('衣装'))!;
  if (outfitDisclosure.getAttribute('aria-expanded') === 'false') {
    await act(async () => outfitDisclosure.click());
  }
  const pasteButton = outfitDisclosure.closest('section')!
    .querySelector<HTMLButtonElement>('button[aria-label="貼り付け"]')!;
  await act(async () => pasteButton.click());

  expect(ws.base.outfit.map((t) => t.tag)).toEqual(['jacket', 'shirt', 'boots']);

  await act(async () => history.undo());
  expect(ws.base.outfit).toEqual([]);
  expect(history.canUndo).toBe(false);
});
