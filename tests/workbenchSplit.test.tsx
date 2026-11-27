// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
import { WORKBENCH_SPLIT_STORAGE_KEY } from '../src/hooks/useWorkbenchSplit';
import { getKV, listEntries, setKV } from '../src/lib/db';
import { fetchSubscription, requestImages, type Subscription } from '../src/lib/novelai';

vi.mock('../src/lib/db', () => ({ getKV: vi.fn(), listEntries: vi.fn(), setKV: vi.fn() }));
vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  requestImages: vi.fn(),
  fetchSubscription: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const click = (node: HTMLElement) => act(async () => node.click());

function makePointerEvent(
  type: string,
  init: { pointerId?: number; clientX: number; clientY?: number; pointerType?: string; button?: number },
) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY ?? 200,
    button: init.button ?? 0,
  });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'mouse' });
  return ev;
}

async function renderApp() {
  await act(async () =>
    root.render(
      <DialogProvider>
        <App onResetAll={() => {}} />
      </DialogProvider>,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  sessionStorage.setItem('nai-tagdeck.token', 'test-token');
  vi.mocked(getKV).mockResolvedValue(undefined);
  vi.mocked(setKV).mockResolvedValue(undefined);
  vi.mocked(listEntries).mockResolvedValue([]);
  vi.mocked(requestImages).mockResolvedValue([{ blob: new Blob(['x'], { type: 'image/png' }) }]);
  vi.mocked(fetchSubscription).mockResolvedValue({
    tier: 3,
    fixedTrainingStepsLeft: 10000,
    purchasedTrainingSteps: 0,
    totalAnlas: 10000,
    expiresAt: null,
    usage: null,
  } satisfies Subscription);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
});

describe('PC 2-pane workbench splitter', () => {
  it('resizes panes via pointer drag, clamps ratio, persists to localStorage, and resets on double click', async () => {
    await renderApp();
    const workbench = container.querySelector<HTMLDivElement>('.workbench')!;
    const splitter = container.querySelector<HTMLDivElement>('.workbench-splitter')!;
    expect(splitter.getAttribute('role')).toBe('separator');
    expect(splitter.getAttribute('aria-orientation')).toBe('vertical');

    vi.spyOn(workbench, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // 右ペインを 45%（clientX = 550）へドラッグ
    await act(async () => {
      splitter.dispatchEvent(makePointerEvent('pointerdown', { clientX: 650 }));
    });
    expect(workbench.classList.contains('is-resizing')).toBe(true);

    await act(async () => {
      splitter.dispatchEvent(makePointerEvent('pointermove', { clientX: 550 }));
    });
    expect(splitter.getAttribute('aria-valuenow')).toBe('45');
    expect(workbench.style.getPropertyValue('--workbench-generate-width')).toContain('45.0%');

    // 上限 65% を超えても 65% にクランプされる
    await act(async () => {
      splitter.dispatchEvent(makePointerEvent('pointermove', { clientX: 100 }));
      splitter.dispatchEvent(makePointerEvent('pointerup', { clientX: 100 }));
    });
    expect(workbench.classList.contains('is-resizing')).toBe(false);
    expect(splitter.getAttribute('aria-valuenow')).toBe('65');
    expect(localStorage.getItem(WORKBENCH_SPLIT_STORAGE_KEY)).toBe('0.65');

    // ダブルクリックで初期幅に戻る
    await act(async () => {
      splitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(workbench.style.getPropertyValue('--workbench-generate-width')).toBe('');
    expect(localStorage.getItem(WORKBENCH_SPLIT_STORAGE_KEY)).toBeNull();
  });

  it('restores saved ratio on mount and supports keyboard resize and Enter reset', async () => {
    localStorage.setItem(WORKBENCH_SPLIT_STORAGE_KEY, '0.4');
    await renderApp();
    const workbench = container.querySelector<HTMLDivElement>('.workbench')!;
    const splitter = container.querySelector<HTMLDivElement>('.workbench-splitter')!;
    expect(splitter.getAttribute('aria-valuenow')).toBe('40');
    expect(workbench.style.getPropertyValue('--workbench-generate-width')).toContain('40.0%');

    await act(async () => {
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(splitter.getAttribute('aria-valuenow')).toBe('42');
    expect(localStorage.getItem(WORKBENCH_SPLIT_STORAGE_KEY)).toBe('0.42');

    await act(async () => {
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(splitter.getAttribute('aria-valuenow')).toBe('25');

    await act(async () => {
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(localStorage.getItem(WORKBENCH_SPLIT_STORAGE_KEY)).toBeNull();
  });
});

describe('Settings gear toggle', () => {
  it('returns to the previous workbench screen (editor or generate) when clicking the gear button again', async () => {
    await renderApp();
    const gear = () => container.querySelector<HTMLButtonElement>('.app-header .tab-settings')!;
    const workbench = () => container.querySelector<HTMLDivElement>('.workbench')!;

    // 編集 → 設定 → 編集へ復帰
    expect(workbench().getAttribute('data-tab')).toBe('editor');
    await click(gear());
    await vi.waitFor(() => expect(container.querySelector('.settings')).not.toBeNull(), { timeout: 5000 });
    expect(gear().getAttribute('title')).toBe('元の画面へ戻る');

    await click(gear());
    expect(container.querySelector('.settings')).toBeNull();
    expect(workbench().getAttribute('data-tab')).toBe('editor');

    // 画像 → 設定 → 画像へ復帰
    await click(container.querySelector<HTMLButtonElement>('.app-header .tab-generate')!);
    expect(workbench().getAttribute('data-tab')).toBe('generate');
    await click(gear());
    await vi.waitFor(() => expect(container.querySelector('.settings')).not.toBeNull(), { timeout: 5000 });

    await click(gear());
    expect(container.querySelector('.settings')).toBeNull();
    expect(workbench().getAttribute('data-tab')).toBe('generate');

    // 設定 → 辞書 → 歯車で設定へ戻り、もう一度歯車で元の画面（画像）へ復帰
    await click(gear());
    await vi.waitFor(() => expect(container.querySelector('.settings-nav-btn')).not.toBeNull(), { timeout: 5000 });
    await click(container.querySelector<HTMLButtonElement>('.settings-nav-btn')!);
    await vi.waitFor(() => expect(container.querySelector('.dictionary')).not.toBeNull(), { timeout: 5000 });

    await click(gear());
    await vi.waitFor(() => expect(container.querySelector('.settings')).not.toBeNull(), { timeout: 5000 });
    await click(gear());
    expect(workbench().getAttribute('data-tab')).toBe('generate');
  }, 15_000);
});
