// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useEditorSelection } from '../src/hooks/useEditorSelection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let selection: ReturnType<typeof useEditorSelection>;
function Harness({ ids, loaded }: { ids: string[]; loaded: boolean }) {
  selection = useEditorSelection(ids, loaded);
  return null;
}
const render = async (ids: string[], loaded = true) => {
  await act(async () => root.render(<StrictMode><Harness ids={ids} loaded={loaded} /></StrictMode>));
};
beforeEach(() => { localStorage.clear(); root = createRoot(document.createElement('div')); });
afterEach(async () => { await act(async () => root.unmount()); });

it('restores the saved selection after asynchronous loading', async () => {
  localStorage.setItem('nai-tagdeck:editor-tab', 'a');
  await render([], false);
  await render(['a', 'b']);
  expect(selection.selected).toBe('a');
});
it('selects a newly added character and persists it', async () => {
  await render(['a']);
  await render(['a', 'b']);
  expect(selection.selected).toBe('b');
  expect(localStorage.getItem('nai-tagdeck:editor-tab')).toBe('b');
});
it('returns to the nearest surviving left tab after multiple deletions', async () => {
  await render(['a', 'b', 'c']);
  await act(async () => selection.select('c'));
  await render(['a']);
  expect(selection.selected).toBe('a');
  await render([]);
  expect(selection.selected).toBe('base');
});
it('corrects selection when a preset replaces characters with the same count', async () => {
  await render(['a', 'b']);
  await act(async () => selection.select('b'));
  await render(['x', 'y']);
  expect(selection.selected).toBe('base');
  expect(localStorage.getItem('nai-tagdeck:editor-tab')).toBe('base');
});
it('keeps the selected character when reordered or updated', async () => {
  await render(['a', 'b']);
  await act(async () => selection.select('a'));
  await render(['b', 'a']);
  expect(selection.selected).toBe('a');
});
it('corrects an invalid saved character even when the workspace is empty', async () => {
  localStorage.setItem('nai-tagdeck:editor-tab', 'deleted');
  await render([]);
  expect(selection.selected).toBe('base');
});
