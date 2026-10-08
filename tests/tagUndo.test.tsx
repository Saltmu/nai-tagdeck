// @vitest-environment jsdom
import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTagUndo } from '../src/hooks/useTagUndo';
import { BASE, emptyWorkspace, newCharacter, workspaceReducer } from '../src/lib/workspace';
import type { Workspace } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let api: ReturnType<typeof useTagUndo>;
let ws: Workspace;
const notify = vi.fn();

function Harness({ initial }: { initial: Workspace }) {
  const [workspace, dispatch] = useReducer(workspaceReducer, initial);
  ws = workspace;
  api = useTagUndo(workspace, dispatch, notify);
  return null;
}
const mount = async (initial: Workspace) => act(async () => root.render(<Harness initial={initial} />));
const run = async (fn: () => void) => act(async () => fn());
const names = () => ws.base.appearance.map((t) => t.tag);
const idOf = (tag: string) => ws.base.appearance.find((t) => t.tag === tag)!.id;
const removeTag = (tag: string) =>
  run(() => api.dispatch({ type: 'remove', target: BASE, category: 'appearance', id: idOf(tag), undo: true }));

beforeEach(async () => {
  notify.mockClear();
  root = createRoot(document.createElement('div'));
  let w = emptyWorkspace();
  for (const [tag, weight] of [['a', 1.2], ['b', 1], ['c', 1], ['d', 1]] as const) {
    w = workspaceReducer(w, { type: 'add', target: BASE, category: 'appearance', tag, weight });
  }
  w = workspaceReducer(w, { type: 'toggle', target: BASE, category: 'appearance', id: w.base.appearance[0]!.id });
  await mount(w);
});
afterEach(async () => { await act(async () => root.unmount()); });

it('restores a removed tag with its weight, state and position', async () => {
  await removeTag('a');
  expect(names()).toEqual(['b', 'c', 'd']);
  await run(() => api.undo());
  expect(ws.base.appearance[0]).toMatchObject({ tag: 'a', weight: 1.2, enabled: false });
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
  expect(api.removed).toEqual([]);
});

it('groups consecutive removals and restores all of them in order', async () => {
  await removeTag('b');
  await removeTag('a');
  await removeTag('d');
  expect(api.removed).toHaveLength(3);
  await run(() => api.undo());
  expect(names()).toEqual(['a', 'b', 'c', 'd']);
});

it('prefers the current tag when the same tag was added again', async () => {
  await removeTag('b');
  await run(() => api.dispatch({ type: 'add', target: BASE, category: 'appearance', tag: 'b', weight: 2 }));
  await run(() => api.undo());
  expect(names()).toEqual(['a', 'c', 'd', 'b']);
  expect(ws.base.appearance.at(-1)?.weight).toBe(2);
});

it('discards pending removals when the workspace is replaced', async () => {
  await removeTag('a');
  await run(() => api.dispatch({ type: 'replace', workspace: emptyWorkspace() }));
  expect(api.removed).toEqual([]);
});

it('drops removals of a deleted character and keeps the others', async () => {
  const character = newCharacter(0);
  await run(() => api.dispatch({ type: 'replace', workspace: { ...emptyWorkspace(), characters: [character] } }));
  await run(() => api.dispatch({ type: 'add', target: character.id, category: 'pose', tag: 'sit' }));
  const id = ws.characters[0]!.tags.pose[0]!.id;
  await run(() => api.dispatch({ type: 'remove', target: character.id, category: 'pose', id, undo: true }));
  await run(() => api.dispatch({ type: 'add', target: BASE, category: 'appearance', tag: 'x' }));
  await removeTag('x');
  expect(api.removed).toHaveLength(2);
  await run(() => api.dispatch({ type: 'removeCharacter', id: character.id }));
  expect(api.removed.map((r) => r.tag.tag)).toEqual(['x']);
});

it('does not track removals without the undo flag', async () => {
  await run(() => api.dispatch({ type: 'remove', target: BASE, category: 'appearance', id: idOf('a') }));
  expect(api.removed).toEqual([]);
});
