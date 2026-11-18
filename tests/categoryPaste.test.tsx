// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CategorySection } from '../src/components/CategorySection';
import { BASE } from '../src/lib/workspace';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement('div');
const dispatch = vi.fn();
const notify = vi.fn();

async function paste(readText: () => Promise<string>) {
  const root = createRoot(container);
  vi.stubGlobal('navigator', { clipboard: { readText } });
  try {
    await act(async () => root.render(
      <CategorySection
        target={BASE}
        category="outfit"
        tags={[]}
        dispatch={dispatch}
        entries={[]}
        syntax="numeric"
        isKnown={() => false}
        onCopy={() => {}}
        onRegister={() => {}}
        notify={notify}
      />,
    ));
    const disclosure = container.querySelector<HTMLButtonElement>('.disclosure')!;
    if (disclosure.getAttribute('aria-expanded') === 'false') {
      await act(async () => disclosure.click());
    }
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="貼り付け"]')!;
    await act(async () => button.click());
  } finally {
    await act(async () => root.unmount());
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

it('adds clipboard tags to the open category with their parsed weights', async () => {
  await paste(async () => '1.2::jacket::, shirt');
  expect(dispatch.mock.calls).toEqual([
    [{ type: 'add', target: BASE, category: 'outfit', tag: 'jacket', weight: 1.2 }],
    [{ type: 'add', target: BASE, category: 'outfit', tag: 'shirt', weight: 1 }],
  ]);
});

it('shows a manual paste fallback when the clipboard cannot be read', async () => {
  await paste(async () => { throw new Error('Clipboard access denied'); });
  expect(dispatch).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('タグ入力欄に直接貼り付け'));
});
