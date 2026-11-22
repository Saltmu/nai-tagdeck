// @vitest-environment jsdom
import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HistoryControls } from '../src/components/HistoryControls';
import { useTagUndo, type UndoExtras, type UndoExtrasSync } from '../src/hooks/useTagUndo';
import { DEFAULT_GENERATION, type GenerationSettings } from '../src/lib/generation';
import { BASE, emptyWorkspace, newCharacter, workspaceReducer, type WorkspaceAction } from '../src/lib/workspace';
import type { Workspace } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof useTagUndo>;
let rawDispatch: (action: WorkspaceAction) => void;
let ws: Workspace;

function Harness({ initial }: { initial: Workspace }) {
  const [workspace, dispatch] = useReducer(workspaceReducer, initial);
  ws = workspace;
  rawDispatch = dispatch;
  api = useTagUndo(workspace, dispatch);
  return <HistoryControls {...api} />;
}
const mount = async (initial: Workspace) => act(async () => root.render(<Harness initial={initial} />));
const run = async (fn: () => void) => act(async () => fn());
const names = () => ws.base.appearance.map((t) => t.tag);
const historyButton = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const idOf = (tag: string) => ws.base.appearance.find((t) => t.tag === tag)!.id;
const removeTag = (tag: string) =>
  run(() => api.dispatch({ type: 'remove', target: BASE, category: 'appearance', id: idOf(tag), undo: true }));
const focusField = () => {
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  return input;
};
const weightOf = (tag: string) => ws.base.appearance.find((t) => t.tag === tag)?.weight;
const key = (init: KeyboardEventInit, target?: EventTarget) =>
  run(() => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    (target ?? window).dispatchEvent(event);
  });

beforeEach(async () => {
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
  let w = emptyWorkspace();
  for (const [tag, weight] of [['a', 1.2], ['b', 1], ['c', 1], ['d', 1]] as const) {
    w = workspaceReducer(w, { type: 'add', target: BASE, category: 'appearance', tag, weight });
  }
  w = workspaceReducer(w, { type: 'toggle', target: BASE, category: 'appearance', id: w.base.appearance[0]!.id });
  await mount(w);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.textContent = '';
});

it('undoes an edit on a duplicated character without changing the source', async () => {
  await run(() => api.dispatch({ type: 'addCharacter' }));
  const sourceId = ws.characters[0]!.id;
  await run(() => api.dispatch({ type: 'add', target: sourceId, category: 'appearance', tag: 'long hair', weight: 1.4 }));
  await run(() => api.dispatch({ type: 'duplicateCharacter', id: sourceId }));
  const copy = ws.characters[1]!;
  expect(copy.name).toBe('キャラ1（コピー）');
  expect(copy.tags.appearance[0]!.id).not.toBe(ws.characters[0]!.tags.appearance[0]!.id);
  await run(() => api.dispatch({
    type: 'setTag',
    target: copy.id,
    category: 'appearance',
    id: copy.tags.appearance[0]!.id,
    tag: 'short hair',
  }));
  expect(ws.characters[0]!.tags.appearance[0]!.tag).toBe('long hair');
  expect(ws.characters[1]!.tags.appearance[0]!.tag).toBe('short hair');
  await run(() => historyButton('元に戻す').click());
  expect(ws.characters[1]!.tags.appearance[0]!.tag).toBe('long hair');
  expect(ws.characters[0]!.tags.appearance[0]!.id).not.toBe(ws.characters[1]!.tags.appearance[0]!.id);
  await run(() => historyButton('元に戻す').click());
  expect(ws.characters.map((c) => c.id)).toEqual([sourceId]);
});

it('keeps both icon buttons visible and restores a removed tag with its weight, state and position', async () => {
  const undo = historyButton('元に戻す');
  const redo = historyButton('やり直す');
  expect(undo.querySelector('svg')).not.toBeNull();
  expect(redo.querySelector('svg')).not.toBeNull();
  expect(undo.getAttribute('aria-disabled')).toBe('true');
  expect(redo.getAttribute('aria-disabled')).toBe('true');
  await removeTag('a');
  expect(names()).toEqual(['b', 'c', 'd']);
  expect(undo.getAttribute('aria-disabled')).toBe('false');
  undo.focus();
  await run(() => undo.click());
  expect(ws.base.appearance[0]).toMatchObject({ tag: 'a', weight: 1.2, enabled: false });
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
  expect(undo.getAttribute('aria-disabled')).toBe('true');
  expect(document.activeElement).toBe(undo);
  expect(redo.getAttribute('aria-disabled')).toBe('false');
  expect(container.querySelector('[role="status"]')?.textContent).toContain('元に戻しました');
  await run(() => redo.click());
  expect(names()).toEqual(['b', 'c', 'd']);
  expect(redo.getAttribute('aria-disabled')).toBe('true');
});

it('undoes one removal at a time and redoes it', async () => {
  await removeTag('b');
  await removeTag('a');
  await removeTag('d');
  await run(() => api.undo());
  expect(names()).toEqual(['c', 'd']);
  await run(() => api.redo());
  expect(names()).toEqual(['c']);
  expect(api.status).toContain('やり直しました');
  await run(() => api.undo());
  await run(() => api.undo());
  expect(names()).toEqual(['a', 'c', 'd']);
});

it('drops the redo stack when a new action is recorded', async () => {
  await removeTag('b');
  await run(() => api.undo());
  await run(() => api.dispatch({ type: 'add', target: BASE, category: 'appearance', tag: 'e' }));
  expect(api.canRedo).toBe(false);
  await run(() => api.redo());
  expect(names()).toEqual(['a', 'b', 'c', 'd', 'e']);
  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
});

it('undoes weight changes, reordering, bulk toggle, quick picks, moves and replacement', async () => {
  focusField();
  await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.4 }));
  await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.6 }));
  expect(weightOf('b')).toBe(1.6);
  await run(() => api.undo());
  expect(weightOf('b')).toBe(1);

  await run(() => api.dispatch({ type: 'move', target: BASE, category: 'appearance', id: idOf('c'), delta: -1 }));
  expect(names()).toEqual(['a', 'c', 'b', 'd']);
  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);

  await run(() => api.dispatch({ type: 'setAll', target: BASE, category: 'appearance', enabled: false }));
  expect(ws.base.appearance.every((t) => !t.enabled)).toBe(true);
  await run(() => api.undo());
  expect(ws.base.appearance[0]!.enabled).toBe(false);
  expect(ws.base.appearance[1]!.enabled).toBe(true);

  await run(() => api.dispatch({
    type: 'pickOne', target: BASE, category: 'appearance', group: ['a', 'b'], tag: null,
  }));
  expect(names()).toEqual(['c', 'd']);
  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);

  await run(() => api.dispatch({ type: 'add', target: BASE, category: 'unclassified', tag: 'loose' }));
  const loose = ws.base.unclassified[0]!.id;
  await run(() => api.dispatch({ type: 'moveFromUnclassified', target: BASE, id: loose, to: 'outfit' }));
  expect(ws.base.outfit.map((t) => t.tag)).toEqual(['loose']);
  await run(() => api.undo());
  expect(ws.base.unclassified.map((t) => t.tag)).toEqual(['loose']);

  const replaced = emptyWorkspace();
  await run(() => api.dispatch({ type: 'replace', workspace: replaced }));
  expect(ws.base.appearance).toEqual([]);
  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
});

it('treats a drag of the same tag as one step', async () => {
  await run(() => api.dispatch({ type: 'moveTo', target: BASE, category: 'appearance', id: idOf('a'), index: 2 }));
  await run(() => api.dispatch({ type: 'moveTo', target: BASE, category: 'appearance', id: idOf('a'), index: 3 }));
  expect(names()).toEqual(['b', 'c', 'd', 'a']);
  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
  expect(api.canUndo).toBe(false);
});

it('collapses consecutive character renames into one step', async () => {
  await run(() => api.dispatch({ type: 'addCharacter' }));
  focusField();
  const id = ws.characters[0]!.id;
  focusField();
  await run(() => api.dispatch({ type: 'renameCharacter', id, name: 'あ' }));
  await run(() => api.dispatch({ type: 'renameCharacter', id, name: 'あい' }));
  expect(ws.characters[0]!.name).toBe('あい');
  await run(() => api.undo());
  expect(ws.characters[0]!.name).toBe('キャラ1');
  await run(() => api.undo());
  expect(ws.characters).toEqual([]);
});

it('keeps a later weight edit when the previous one went idle', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  try {
    focusField();
    await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.2 }));
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.3 }));
    await run(() => api.undo());
    expect(weightOf('b')).toBe(1.2);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps a later rename when the name field was left', async () => {
  await run(() => api.dispatch({ type: 'addCharacter' }));
  const id = ws.characters[0]!.id;
  const field = focusField();
  await run(() => api.dispatch({ type: 'renameCharacter', id, name: 'あ' }));
  await run(() => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  field.focus();
  await run(() => api.dispatch({ type: 'renameCharacter', id, name: 'あい' }));
  await run(() => api.undo());
  expect(ws.characters[0]!.name).toBe('あ');
});

it('tracks removals that do not pass the legacy undo flag', async () => {
  await run(() => api.dispatch({ type: 'remove', target: BASE, category: 'appearance', id: idOf('a') }));
  expect(api.canUndo).toBe(true);
  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
});

it('restores a removed character as its own step', async () => {
  const character = newCharacter(0);
  await run(() => api.dispatch({ type: 'replace', workspace: { ...ws, characters: [character] } }));
  await run(() => api.dispatch({ type: 'removeCharacter', id: character.id }));
  expect(ws.characters).toEqual([]);
  await run(() => api.undo());
  expect(ws.characters.map((c) => c.id)).toEqual([character.id]);
});

it('discards history when the workspace is replaced outside the tracked dispatch', async () => {
  await removeTag('a');
  expect(api.canUndo).toBe(true);
  await run(() => rawDispatch({ type: 'replace', workspace: emptyWorkspace() }));
  expect(api.canUndo).toBe(false);
  expect(api.canRedo).toBe(false);
  expect(ws.base.appearance).toEqual([]);
});

it('undoes and redoes from Ctrl, Cmd, Shift and Y shortcuts', async () => {
  await removeTag('c');
  await key({ key: 'z', ctrlKey: true });
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
  await key({ key: 'Z', ctrlKey: true, shiftKey: true });
  expect(names()).toEqual(['a', 'b', 'd']);
  await key({ key: 'z', metaKey: true });
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
  await key({ key: 'y', ctrlKey: true });
  expect(names()).toEqual(['a', 'b', 'd']);
});

it('leaves text entry, composition and open dialogs to the browser', async () => {
  await removeTag('c');
  const input = document.createElement('input');
  document.body.append(input);
  await key({ key: 'z', ctrlKey: true }, input);
  expect(names()).toEqual(['a', 'b', 'd']);

  await key({ key: 'z', ctrlKey: true, isComposing: true });
  expect(names()).toEqual(['a', 'b', 'd']);

  const dialog = document.createElement('dialog');
  dialog.open = true;
  document.body.append(dialog);
  await key({ key: 'z', metaKey: true });
  expect(names()).toEqual(['a', 'b', 'd']);
});

it('does not merge weight changes after leaving the field, waiting, or from button clicks', async () => {
  const input = focusField();
  await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.2 }));
  await run(() => input.blur());
  input.focus();
  await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.5 }));
  expect(weightOf('b')).toBe(1.5);
  await run(() => api.undo());
  expect(weightOf('b')).toBe(1.2);
  await run(() => api.undo());
  expect(weightOf('b')).toBe(1);

  vi.useFakeTimers();
  try {
    input.focus();
    await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.2 }));
    vi.advanceTimersByTime(60_000);
    await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.5 }));
    await run(() => api.undo());
    expect(weightOf('b')).toBe(1.2);
    await run(() => api.undo());
    expect(weightOf('b')).toBe(1);
  } finally {
    vi.useRealTimers();
  }

  input.blur();
  await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.2 }));
  await run(() => api.dispatch({ type: 'setWeight', target: BASE, category: 'appearance', id: idOf('b'), weight: 1.5 }));
  await run(() => api.undo());
  expect(weightOf('b')).toBe(1.2);
});

it('restores and redoes activePresetId alongside workspace replacement', async () => {
  let activeId: string | null = 'preset-a';
  const setActiveId = vi.fn((next: string | null) => {
    activeId = next;
  });
  function PresetHarness({ initial }: { initial: Workspace }) {
    const [workspace, dispatch] = useReducer(workspaceReducer, initial);
    ws = workspace;
    api = useTagUndo(workspace, dispatch, { activeId, setActiveId });
    return null;
  }
  await act(async () => root.render(<PresetHarness initial={ws} />));
  const presetB = emptyWorkspace();
  await run(() => {
    api.dispatch({ type: 'replace', workspace: presetB });
    activeId = 'preset-b';
  });
  await act(async () => root.render(<PresetHarness initial={ws} />));
  expect(ws.base.appearance).toEqual([]);
  expect(activeId).toBe('preset-b');

  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
  expect(setActiveId).toHaveBeenLastCalledWith('preset-a');
  expect(activeId).toBe('preset-a');

  await run(() => api.redo());
  expect(ws.base.appearance).toEqual([]);
  expect(setActiveId).toHaveBeenLastCalledWith('preset-b');
  expect(activeId).toBe('preset-b');
});

it('restores character negative and generation only on the import step', async () => {
  let generation: GenerationSettings = { ...DEFAULT_GENERATION, steps: 19, seed: 11 };
  let characterNegativePrompt = 'blurry';
  const sync: UndoExtrasSync = {
    capture: () => ({ characterNegativePrompt, generation: { ...generation } }),
    restore: (extras: UndoExtras) => {
      if (extras.characterNegativePrompt !== undefined) characterNegativePrompt = extras.characterNegativePrompt;
      if (extras.generation) generation = { ...generation, ...extras.generation };
    },
  };
  function ExtrasHarness({ initial }: { initial: Workspace }) {
    const [workspace, dispatch] = useReducer(workspaceReducer, initial);
    ws = workspace;
    api = useTagUndo(workspace, dispatch, undefined, sync);
    return null;
  }
  await act(async () => root.render(<ExtrasHarness initial={ws} />));
  await run(() => api.dispatch(
    { type: 'replace', workspace: emptyWorkspace() },
    { characterNegativePrompt: 'lowres', generation: { steps: 28 } },
  ));
  expect(ws.base.appearance).toEqual([]);
  expect(characterNegativePrompt).toBe('lowres');
  expect(generation).toMatchObject({ steps: 28, seed: 11 });

  await run(() => api.dispatch({ type: 'add', target: BASE, category: 'appearance', tag: 'hat', weight: 1 }));
  // 適用で触っていない項目（seed）への手入力は Undo でも残る。
  generation = { ...generation, seed: 99 };
  await run(() => api.undo());
  expect(ws.base.appearance.map((tag) => tag.tag)).toEqual([]);
  expect(generation).toMatchObject({ steps: 28, seed: 99 });
  expect(characterNegativePrompt).toBe('lowres');

  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
  expect(generation).toMatchObject({ steps: 19, seed: 99 });
  expect(characterNegativePrompt).toBe('blurry');

  await run(() => api.redo());
  expect(ws.base.appearance).toEqual([]);
  expect(generation).toMatchObject({ steps: 28, seed: 99 });
  expect(characterNegativePrompt).toBe('lowres');
});

it('does not record an action that changes nothing', async () => {
  await run(() => api.dispatch({ type: 'move', target: BASE, category: 'appearance', id: idOf('d'), delta: 1 }));
  expect(api.canUndo).toBe(false);
});

it('undoes and redoes addMany across categories in a single step', async () => {
  await run(() => api.dispatch({
    type: 'addMany',
    items: [
      { target: BASE, category: 'appearance', tag: 'long hair', weight: 1.2 },
      { target: BASE, category: 'outfit', tag: 'jacket', weight: 1 },
      { target: BASE, category: 'background', tag: 'sunset', weight: 1.1 },
    ],
  }));
  expect(names()).toEqual(['a', 'b', 'c', 'd', 'long hair']);
  expect(ws.base.outfit.map((t) => t.tag)).toEqual(['jacket']);
  expect(ws.base.background.map((t) => t.tag)).toEqual(['sunset']);

  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
  expect(ws.base.outfit).toEqual([]);
  expect(ws.base.background).toEqual([]);

  await run(() => api.redo());
  expect(names()).toEqual(['a', 'b', 'c', 'd', 'long hair']);
  expect(ws.base.outfit.map((t) => t.tag)).toEqual(['jacket']);
  expect(ws.base.background.map((t) => t.tag)).toEqual(['sunset']);
});
