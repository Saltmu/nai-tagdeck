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

/** ヘッダーの画面切り替えボタンを押す（ドックのタブと名前が同じなので .app-header に絞る）。 */
async function switchTab(tabClass: string) {
  await click(container.querySelector<HTMLButtonElement>(`.app-header .${tabClass}`)!);
}

/** ドックのタブを押す。 */
async function switchDockTab(label: string) {
  const tabs = container.querySelector('.dock-tabs')!;
  await click(button(label, tabs));
}

/** 生成パネルのサイズ指定ボタン（フッターのピクトグラムとは別）。 */
function panelSizeButton(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('.size-groups [role="radio"]')]
    .find((b) => b.getAttribute('aria-label') === label);
  if (!found) throw new Error(`パネルのサイズボタンが見つかりません: ${label}`);
  return found;
}

function panelSizeChecked(): string | null {
  return container.querySelector('.size-groups [role="radio"][aria-checked="true"]')?.getAttribute('aria-label') ?? null;
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

it('keeps the panel size buttons and the footer pictograms in sync', async () => {
  await switchDockTab('生成');
  // パネルにサイズのセレクトボックスはない（ボタン式になった）
  expect(container.querySelector('.size-groups select')).toBeNull();
  expect(panelSizeChecked()).toBe('縦 832×1216');

  await click(panelSizeButton('カスタム 832×1216'));
  expect(panelSizeChecked()).toBe('カスタム 832×1216');
  expect(sizeRadios().map((r) => r.getAttribute('aria-label'))).toEqual([
    '縦 832×1216',
    '横 1216×832',
    '正方形 1024×1024',
    'カスタム 832×1216',
  ]);
  expect(sizeRadios()[3]!.getAttribute('aria-checked')).toBe('true');
  // カスタムの数値入力がパネルに出る（ボタンの後に置く）
  expect(container.querySelector('.custom-size')).not.toBeNull();

  const landscape = sizeRadios().find((r) => r.getAttribute('aria-label') === '横 1216×832')!;
  await click(landscape);
  expect(panelSizeChecked()).toBe('横 1216×832');
  expect(sizeRadios()).toHaveLength(3);
});

it('starts generation from the editor tab', async () => {
  await click(generateButtons()[0]!);
  await vi.waitFor(() => {
    expect(requestImages).toHaveBeenCalled();
  });
});

it('shows the Anlas balance in the header, overlays the cost badge on the generate button, and refreshes balance after a generation', async () => {
  await vi.waitFor(() => {
    expect(container.querySelector('.app-header .header-anlas')?.textContent).toContain('残高 18,000');
  });
  expect(container.querySelector('.dock-bar .header-anlas')).toBeNull();
  expect(container.querySelector('.app-header .tab-dictionary')).toBeNull();
  expect(container.querySelector('.app-header .tab-settings')?.textContent?.trim()).toBe('');
  expect(container.querySelector('.app-header .tab-settings')?.getAttribute('aria-label')).toBe('設定');

  const submitWrap = container.querySelector('.gen-submit-wrap');
  const genBtn = generateButtons()[0]!;
  const costBadge = submitWrap?.querySelector('.gen-cost-badge');
  expect(costBadge?.textContent?.trim()).toBe('0');
  expect(genBtn.getAttribute('aria-describedby')).toBe(costBadge?.id);

  vi.mocked(fetchSubscription).mockResolvedValueOnce({
    tier: 3,
    fixedTrainingStepsLeft: 9995,
    purchasedTrainingSteps: 8000,
    totalAnlas: 17995,
    expiresAt: null,
    usage: null,
  });
  await click(genBtn);
  await vi.waitFor(() => {
    expect(fetchSubscription).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.app-header .header-anlas')?.textContent).toContain('残高 17,995');
    expect(container.querySelector('.gen-cost-badge')?.textContent?.trim()).toBe('0');
  });
});

it('shows unknown estimate badge when subscription refresh fails after generation', async () => {
  await vi.waitFor(() => {
    expect(container.querySelector('.app-header .header-anlas')?.textContent).toContain('残高 18,000');
    expect(container.querySelector('.gen-cost-badge')?.textContent?.trim()).toBe('0');
  });
  vi.mocked(fetchSubscription).mockRejectedValueOnce(new Error('network error'));
  await click(generateButtons()[0]!);
  await vi.waitFor(() => {
    expect(fetchSubscription).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.app-header .header-anlas')?.textContent).toContain('残高 取得失敗');
    expect(container.querySelector('.gen-cost-badge')?.textContent?.trim()).toBe('—');
  });
});

it('navigates from settings to dictionary and back to settings', async () => {
  await switchTab('tab-settings');
  await vi.waitFor(() => {
    expect(container.querySelector('.settings-nav-btn')).not.toBeNull();
  });
  await click(container.querySelector<HTMLButtonElement>('.settings-nav-btn')!);
  await vi.waitFor(() => {
    expect(container.querySelector('.dictionary')).not.toBeNull();
  });
  await click(button('設定へ戻る'));
  await vi.waitFor(() => {
    expect(container.querySelector('.settings')).not.toBeNull();
  });
});

it('keeps the dock available on the editor tab and allows opening dock panels without leaving editor', async () => {
  expect(container.querySelector('.workbench')?.getAttribute('data-tab')).toBe('editor');
  const dock = container.querySelector('.dock');
  expect(dock).not.toBeNull();
  expect(dock?.classList.contains('is-open')).toBe(false);

  await switchDockTab('プロンプト');
  expect(dock?.classList.contains('is-open')).toBe(true);
  expect(container.querySelector('.workbench')?.getAttribute('data-tab')).toBe('editor');

  // 生成バー内のタップではドックは閉じない
  await act(async () => {
    container.querySelector('.generate-bar')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
  expect(dock?.classList.contains('is-open')).toBe(true);

  // ドック外の画面上部（編集ペインなど）をタップするとドックが閉じる
  await act(async () => {
    container.querySelector('.pane-editor')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
  expect(dock?.classList.contains('is-open')).toBe(false);
});

it('shows the plan and the granted/purchased breakdown in the token settings', async () => {
  await vi.waitFor(() => {
    expect(container.querySelector('.app-header .header-anlas')?.textContent).toContain('残高 18,000');
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
