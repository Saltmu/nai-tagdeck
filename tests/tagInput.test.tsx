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
it('closes on an outside pointer and swallows the rest of that press', async () => {
  await focus();
  const other = document.createElement('input');
  document.body.append(other);
  const reached = vi.fn();
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) other.addEventListener(type, reached);
  const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
  await act(async () => other.dispatchEvent(down));
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).not.toBe(input);
  expect(down.defaultPrevented).toBe(true);
  // タッチで指を離したあとの当たり判定が下の入力欄に当たらないよう、透明な板で覆っている
  expect(document.querySelector('.gesture-shield')).not.toBeNull();
  // mousedown を止めるので、下にある別の入力欄へフォーカスが移らない
  const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  other.dispatchEvent(mousedown);
  other.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  other.dispatchEvent(click);
  expect(mousedown.defaultPrevented).toBe(true);
  expect(click.defaultPrevented).toBe(true);
  expect(reached).not.toHaveBeenCalled();
  await act(async () => { vi.runOnlyPendingTimers(); });
  expect(document.querySelector('.gesture-shield')).toBeNull();
  // 次の押下は普通に届く
  other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  other.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(reached).toHaveBeenCalledTimes(2);
  other.remove();
});
it('keeps presses inside the suggestion area working', async () => {
  await focus();
  const option = container.querySelector('[role="option"]')!;
  await act(async () => {
    option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  expect(onAdd).toHaveBeenCalled();
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
it('does not reopen suggestions when focus returns with the window', async () => {
  await focus();
  await key('Escape');
  // 別アプリへ切り替え → 戻る（入力欄のフォーカスが復帰する）
  await act(async () => {
    window.dispatchEvent(new FocusEvent('blur'));
    input.blur();
  });
  await act(async () => {
    window.dispatchEvent(new FocusEvent('focus'));
    input.focus();
  });
  expect(input.getAttribute('aria-expanded')).toBe('false');
  await act(async () => { vi.runOnlyPendingTimers(); });
  // 押せば普通に開く
  await act(async () => input.click());
  expect(input.getAttribute('aria-expanded')).toBe('true');
  // 印は残らないので、次のフォーカスでは開く
  await act(async () => input.blur());
  await focus();
  expect(input.getAttribute('aria-expanded')).toBe('true');
});
