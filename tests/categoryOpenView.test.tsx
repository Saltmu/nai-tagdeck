// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { CategorySection } from '../src/components/CategorySection';
import { saveCategoriesOpen } from '../src/lib/categoryOpen';
import { BASE } from '../src/lib/workspace';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const container = document.createElement('div');
let root: Root;
let restoreStorage = () => {};

function replaceStorage(storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } | null) {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      if (!storage) throw new Error('denied');
      return storage;
    },
  });
  restoreStorage = () => {
    if (original) Object.defineProperty(window, 'localStorage', original);
    else Reflect.deleteProperty(window, 'localStorage');
  };
}

async function render() {
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <CategorySection
      target={BASE}
      category="outfit"
      tags={[]}
      dispatch={() => {}}
      entries={[]}
      syntax="numeric"
      isKnown={() => false}
      onCopy={() => {}}
      onRegister={() => {}}
      notify={() => {}}
    />,
  ));
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  restoreStorage();
  restoreStorage = () => {};
  localStorage.clear();
});

const disclosure = () => container.querySelector<HTMLButtonElement>('.disclosure')!;

it('localStorage を読めないときも、カテゴリの開閉ボタンで表示を変える', async () => {
  replaceStorage(null);
  await render();
  expect(disclosure().getAttribute('aria-expanded')).toBe('true');
  await act(async () => disclosure().click());
  expect(disclosure().getAttribute('aria-expanded')).toBe('false');
});

it('保存に失敗しても、一括開閉は画面に反映する', async () => {
  replaceStorage({
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
  });
  await render();
  expect(disclosure().getAttribute('aria-expanded')).toBe('true');
  await act(async () => saveCategoriesOpen(BASE, ['outfit'], false));
  expect(disclosure().getAttribute('aria-expanded')).toBe('false');
});
