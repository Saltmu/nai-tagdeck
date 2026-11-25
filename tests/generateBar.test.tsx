// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
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
const writeText = vi.fn().mockResolvedValue(undefined);
const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));

function button(text: string, scope: ParentNode = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button'))
    .find((node) => node.textContent?.trim() === text || node.getAttribute('aria-label') === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

const click = (node: HTMLElement) => act(async () => node.click());

/** ヘッダーの画面切り替えタブを押す（ドックのタブと名前が同じなので .tabbar に絞る）。 */
async function switchTab(tabClass: string) {
  await click(container.querySelector<HTMLButtonElement>(`.tabbar .${tabClass}`)!);
}

/** ドックのタブを押す。 */
async function switchDockTab(label: string) {
  const tabs = container.querySelector('.dock-tabs')!;
  await click(button(label, tabs));
}

function sizeSelect(): HTMLSelectElement {
  const label = [...container.querySelectorAll('label')].find((el) => el.textContent?.includes('サイズ'));
  const select = label?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) throw new Error('サイズの選択肢が見つかりません');
  return select;
}

async function chooseSize(value: string) {
  const select = sizeSelect();
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function sizeRadios(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.size-toggle [role="radio"]')];
}

function generateButtons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '生成する');
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:mock';
    static revokeObjectURL = () => {};
  });
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  sessionStorage.setItem('nai-tagdeck.token', 'test-token');
  vi.mocked(getKV).mockImplementation(async (key) => ({
    workspace: {
      base: { quality: [{ id: 't1', tag: 'masterpiece', enabled: true, weight: 1 }] },
      negative: [],
      characters: [],
    },
    generation: { seed: 11, steps: 19 },
  })[key as 'workspace' | 'generation'] as never);
  vi.mocked(setKV).mockResolvedValue(undefined);
  vi.mocked(listEntries).mockResolvedValue([
    { id: '1', tag: 'masterpiece', category: 'quality', alias: '', default_weight: 1, sort_order: 0, updated_at: '' },
  ]);
  vi.mocked(requestImages).mockResolvedValue([{ blob: new Blob(['x'], { type: 'image/png' }) }]);
  vi.mocked(fetchSubscription).mockResolvedValue({
    tier: 3,
    fixedTrainingStepsLeft: 10000,
    purchasedTrainingSteps: 8000,
    totalAnlas: 18000,
    expiresAt: null,
    usage: null,
  } satisfies Subscription);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<DialogProvider><App onResetAll={() => {}} /></DialogProvider>));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  dialogMethods.forEach((name, i) => {
    const desc = originalDialogMethods[i];
    if (desc) Object.defineProperty(HTMLDialogElement.prototype, name, desc);
  });
});

it('shows the generate button and three size pictograms on the editor tab', async () => {
  expect(container.querySelector('.generate-bar')).not.toBeNull();
  expect(generateButtons()).toHaveLength(1);
  expect(sizeRadios().map((r) => r.getAttribute('aria-label'))).toEqual([
    '縦 832×1216',
    '横 1216×832',
    '正方形 1024×1024',
  ]);
  expect(sizeRadios()[0]!.getAttribute('aria-checked')).toBe('true');
});

it('keeps the same generate button on the generate tab', async () => {
  await switchTab('tab-generate');
  expect(container.querySelector('.generate-bar')).not.toBeNull();
  expect(generateButtons()).toHaveLength(1);
  expect(sizeRadios()).toHaveLength(3);
});

it('keeps the panel size select and the footer pictograms in sync', async () => {
  await switchDockTab('生成');
  expect(sizeSelect().value).toBe('portrait');

  await chooseSize('custom');
  expect(sizeSelect().value).toBe('custom');
  expect(sizeRadios().map((r) => r.getAttribute('aria-label'))).toEqual([
    '縦 832×1216',
    '横 1216×832',
    '正方形 1024×1024',
    'カスタム 832×1216',
  ]);
  expect(sizeRadios()[3]!.getAttribute('aria-checked')).toBe('true');
  // カスタムの数値入力がパネルに出る（ピクトグラムを押さずにたどり着ける）
  expect(container.querySelector('.custom-size')).not.toBeNull();

  const landscape = sizeRadios().find((r) => r.getAttribute('aria-label') === '横 1216×832')!;
  await click(landscape);
  expect(sizeSelect().value).toBe('landscape');
  expect(sizeRadios()).toHaveLength(3);
});

it('starts generation from the editor tab', async () => {
  await click(generateButtons()[0]!);
  await vi.waitFor(() => {
    expect(requestImages).toHaveBeenCalled();
  });
});

it('shows the Anlas balance above the generate button, and the consumed amount after a generation', async () => {
  await vi.waitFor(() => {
    expect(container.querySelector('.anlas-line')?.textContent).toContain('消費 — / 残高 18,000');
  });
  // 生成後の取得では残高が 5 減る（精密参照 1 枚分）
  vi.mocked(fetchSubscription).mockResolvedValueOnce({
    tier: 3,
    fixedTrainingStepsLeft: 9995,
    purchasedTrainingSteps: 8000,
    totalAnlas: 17995,
    expiresAt: null,
    usage: null,
  });
  await click(generateButtons()[0]!);
  await vi.waitFor(() => {
    expect(container.querySelector('.anlas-line')?.textContent).toContain('消費 5 / 残高 17,995');
  });
});

it('shows the plan and the granted/purchased breakdown in the token settings', async () => {
  await vi.waitFor(() => {
    expect(container.querySelector('.anlas-line')?.textContent).toContain('残高 18,000');
  });
  await switchTab('tab-settings');
  await vi.waitFor(() => {
    expect(container.querySelector('.anlas-details')).not.toBeNull();
  });
  const details = container.querySelector('.anlas-details');
  expect(details?.textContent).toContain('Opus');
  expect(details?.textContent).toContain('18,000 Anlas（付与分 10,000／購入分 8,000）');
  expect(details?.textContent).toContain('付与分の Anlas は期間の終了時にリセットされます');
});
