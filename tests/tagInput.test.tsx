// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TagInput } from '../src/components/TagInput';
import type { DictEntry } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const entries: DictEntry[] = ['hug', 'holding hands', 'target#hug'].map((tag, i) => ({
  id: String(i), tag, category: 'pose', alias: '', default_weight: 1, sort_order: i, updated_at: '',
}));
let container: HTMLDivElement;
let root: Root;
let input: HTMLInputElement;
const onAdd = vi.fn();
beforeEach(async () => {
  vi.useFakeTimers();
  onAdd.mockClear();
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<TagInput category="pose" label="ポーズ" entries={entries} onAdd={onAdd} interactions />));
  input = container.querySelector('input')!;
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  container.remove();
  vi.unstubAllGlobals();
});
const focus = async () => { await act(async () => input.focus()); };
const key = async (key: string) => { await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))); };

it('opens category suggestions and selects with arrow keys and Enter', async () => {
  await focus();
  expect(input.getAttribute('aria-expanded')).toBe('true');
  await key('ArrowDown');
  await key('Enter');
  expect(onAdd).toHaveBeenCalledWith('holding hands', 1);
  expect(input.getAttribute('aria-expanded')).toBe('false');
});
it('closes with Escape and can reopen', async () => {
  await focus();
  await key('Escape');
  expect(input.getAttribute('aria-expanded')).toBe('false');
  await key('ArrowDown');
  expect(input.getAttribute('aria-expanded')).toBe('true');
});
it('closes on an outside pointer and swallows the following click', async () => {
  await focus();
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(input.getAttribute('aria-expanded')).toBe('false');
  document.body.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
});
it('deduplicates prefixed suggestions and applies the selected interaction', async () => {
  await focus();
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('target#'))!;
  await act(async () => button.click());
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
  await key('Enter');
  expect(onAdd).toHaveBeenCalledWith('target#hug', 1);
});
it('ignores IME confirmation Enter', async () => {
  await focus();
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })));
  expect(onAdd).not.toHaveBeenCalled();
});
