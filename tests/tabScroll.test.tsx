// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
import { getKV, listEntries, setKV } from '../src/lib/db';

vi.mock('../src/lib/db', () => ({ getKV: vi.fn(), listEntries: vi.fn(), setKV: vi.fn() }));
vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  requestImages: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
);
// jsdom では window.scrollY が 0 のままなので、テスト側で差し替える
let fakeScrollY = 0;

beforeEach(() => {
  fakeScrollY = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => fakeScrollY });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  for (const name of dialogMethods) {
    Object.defineProperty(HTMLDialogElement.prototype, name, { configurable: true, value: vi.fn() });
  }
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  vi.mocked(getKV).mockResolvedValue(undefined);
  vi.mocked(setKV).mockResolvedValue(undefined);
  vi.mocked(listEntries).mockResolvedValue([]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'scrollY');
  dialogMethods.forEach((name, i) => {
    const desc = originalDialogMethods[i];
    if (desc) Object.defineProperty(HTMLDialogElement.prototype, name, desc);
  });
});

const click = (node: HTMLElement) => act(async () => node.click());
const scroll = async (y: number) => {
  fakeScrollY = y;
  await act(async () => {
    window.dispatchEvent(new Event('scroll'));
  });
};

it('keeps the scroll position per view when switching views', async () => {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  await act(async () => {
    root.render(
      <DialogProvider>
        <App onResetAll={() => {}} />
      </DialogProvider>,
    );
  });
  // 初回マウント時のスクロールは無視する
  scrollTo.mockClear();

  // 編集タブで 1200 までスクロールしてから辞書へ。未訪問の辞書は先頭から開く
  await scroll(1200);
  await click(container.querySelector<HTMLButtonElement>('.tab-dictionary')!);
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
  await vi.waitFor(() => {
    if (!container.querySelector('.dictionary')) throw new Error('waiting for dictionary');
  }, { timeout: 5000 });

  // 辞書で 300 までスクロールしてから編集へ戻る。編集は 1200 に戻る
  await scroll(300);
  scrollTo.mockClear();
  await click(container.querySelector<HTMLButtonElement>('.tab-editor')!);
  expect(scrollTo).toHaveBeenCalledWith(0, 1200);

  // 再び辞書へ。辞書は 300 に戻る
  scrollTo.mockClear();
  await click(container.querySelector<HTMLButtonElement>('.tab-dictionary')!);
  expect(scrollTo).toHaveBeenCalledWith(0, 300);
});
