// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChunkErrorBoundary } from '../src/components/ChunkErrorBoundary';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSync(children: React.ReactNode) {
  // 同期 act で描画する（非同期 act では React がエラーを回復レンダリングしてしまい、
  // 一度だけ投げる子がフォールバックを表示する前に復旧してしまうため）。
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    act(() => {
      root.render(<ChunkErrorBoundary>{children}</ChunkErrorBoundary>);
    });
  } finally {
    errorSpy.mockRestore();
  }
}

function findButton(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label);
  if (!found) throw new Error(`${label}ボタンがありません`);
  return found as HTMLButtonElement;
}

it('renders children normally when nothing throws', async () => {
  renderSync(<p>画面の中身</p>);
  expect(container.textContent).toContain('画面の中身');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('shows retry and reload guidance instead of crashing when a child throws', async () => {
  let fail = true;
  function Flaky() {
    if (fail) throw new Error('chunk load failed');
    return <p>再試行で表示</p>;
  }
  renderSync(<Flaky />);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('画面の読み込みに失敗しました');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('ページを再読み込み');
  expect(container.textContent).not.toContain('再試行で表示');
  fail = false;
  await act(async () => { findButton('再試行').click(); });
  expect(container.textContent).toContain('再試行で表示');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('shows the reload button when a child keeps throwing', async () => {
  function Broken(): React.JSX.Element {
    throw new Error('chunk load failed');
  }
  renderSync(<Broken />);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(findButton('ページを再読み込み')).not.toBeNull();
});
