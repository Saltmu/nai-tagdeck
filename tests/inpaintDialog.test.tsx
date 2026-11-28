// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
import { toBackupJSON } from '../src/lib/backup';
import { getKV, listEntries, setKV } from '../src/lib/db';
import { DEFAULT_GENERATION } from '../src/lib/generation';
import { fetchSubscription, NAI_INPAINT_MODEL, requestImages, type Subscription } from '../src/lib/novelai';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { emptyWorkspace } from '../src/lib/workspace';

vi.mock('../src/lib/db', () => ({ getKV: vi.fn(), listEntries: vi.fn(), setKV: vi.fn() }));

vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  requestImages: vi.fn(),
  fetchSubscription: vi.fn(),
}));

vi.mock('../src/lib/referenceImage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/referenceImage')>(),
  prepareReferenceImageBase64: vi.fn(async () => 'RAW_REF_BASE64'),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function makePngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

const PNG_512 = makePngBytes(512, 512);
const PNG_832x1216 = makePngBytes(832, 1216);

let container: HTMLDivElement;
let root: Root;
let urlSeq = 0;
let createdUrls: string[] = [];
let revokedUrls: string[] = [];

const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
);

function dockTab(label: string): HTMLButtonElement {
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('.dock-tabs [role="tab"]')];
  const found = tabs.find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`Dock tab missing: ${label}`);
  return found;
}

function buttonByText(text: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text,
  );
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

const click = (el: HTMLElement) => act(async () => el.click());

async function renderApp() {
  await act(async () => {
    root.render(
      <DialogProvider>
        <App onResetAll={() => {}} />
      </DialogProvider>,
    );
  });
  await vi.waitFor(() => {
    expect(container.querySelector('.header-anlas')?.textContent).toContain('残高');
    expect(buttonByText('生成する').disabled).toBe(false);
  });
}

function makePointerEvent(
  type: string,
  init: { pointerId?: number; clientX: number; clientY: number; pointerType?: string; button?: number },
) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
  });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'mouse' });
  return ev;
}

async function paintStrokeOnDialog(dialog: HTMLElement, from = { x: 40, y: 40 }, to = { x: 120, y: 120 }) {
  const stage = dialog.querySelector<HTMLElement>('.inpaint-stage')!;
  const canvas = dialog.querySelector<HTMLCanvasElement>('.inpaint-mask-canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 256,
    bottom: 256,
    width: 256,
    height: 256,
    toJSON: () => ({}),
  });
  await act(async () => {
    stage.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: from.x, clientY: from.y }));
    stage.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: to.x, clientY: to.y }));
    stage.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: to.x, clientY: to.y }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  urlSeq = 0;
  createdUrls = [];
  revokedUrls = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:inpaint-mock-${++urlSeq}`;
    createdUrls.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revokedUrls.push(url);
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  sessionStorage.setItem('nai-tagdeck.token', 'pst-test-token');
  vi.mocked(getKV).mockImplementation(async (key) =>
    ({
      workspace: {
        base: { quality: [{ id: 't1', tag: 'masterpiece', enabled: true, weight: 1 }] },
        negative: [{ id: 'n1', tag: 'lowres', enabled: true, weight: 1 }],
        characters: [],
      },
      generation: { seed: 77, steps: 20 },
    })[key as 'workspace' | 'generation'] as never,
  );
  vi.mocked(setKV).mockResolvedValue(undefined);
  vi.mocked(listEntries).mockResolvedValue([
    { id: '1', tag: 'masterpiece', category: 'quality', alias: '', default_weight: 1, sort_order: 0, updated_at: '' },
  ]);
  vi.mocked(requestImages).mockResolvedValue([{ blob: new Blob([PNG_832x1216], { type: 'image/png' }), seed: 555 }]);
  vi.mocked(fetchSubscription).mockResolvedValue({
    tier: 3,
    fixedTrainingStepsLeft: 10000,
    purchasedTrainingSteps: 8000,
    totalAnlas: 18000,
    expiresAt: null,
    usage: { percent: 10, isNegative: false, timeUntilNextPercent: null },
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dialogMethods.forEach((name, i) => {
    const desc = originalDialogMethods[i];
    if (desc) Object.defineProperty(HTMLDialogElement.prototype, name, desc);
  });
});

describe('インペイント導線・マスク確定・通常生成ボタン連動・排他・非永続化', () => {
  it('ギャラリー ⋯ メニューと ImageViewer の両方からモーダルを開き、空マスクは確定無効・描画後は有効・ピンチ時は進行中ストロークを破棄する', async () => {
    await renderApp();

    // まず 1 枚生成してギャラリーに表示する
    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(container.querySelectorAll('.thumb-frame')).toHaveLength(1));

    // 1) ギャラリー ⋯ メニューから「インペイント」で開く
    await click(container.querySelector<HTMLButtonElement>('.thumb-more')!);
    await click(buttonByText('インペイント', container.querySelector('.thumb-menu')!));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());

    const dialog = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    const confirmBtn = () => buttonByText('確定', dialog);
    expect(confirmBtn().disabled).toBe(true);
    expect(dialog.textContent).toContain('描き直す部分をマスクで塗ってください');
    // 編集ボタン類は画像上のオーバーレイとして配置され、独立サイドバーは持たない
    expect(dialog.querySelector('.inpaint-overlay-top')).not.toBeNull();
    expect(dialog.querySelector('.inpaint-overlay-bottom')).not.toBeNull();
    expect(dialog.querySelector('aside.inpaint-side')).toBeNull();

    // ブラシ・消しゴム・移動は SVG ピクトグラムのラジオボタンで切り替える
    const toolButtons = [...dialog.querySelectorAll<HTMLButtonElement>('.inpaint-tool-group [role="radio"]')];
    expect(toolButtons.map((b) => b.getAttribute('aria-label'))).toEqual(['ブラシ', '消しゴム', '移動・ズーム']);
    for (const btn of toolButtons) {
      expect(btn.querySelector('svg.icon')).not.toBeNull();
      expect(btn.textContent?.trim()).toBe('');
    }
    expect(toolButtons[0]!.getAttribute('aria-checked')).toBe('true');
    await click(toolButtons[2]!);
    expect(toolButtons[2]!.getAttribute('aria-checked')).toBe('true');
    expect(dialog.querySelector('.inpaint-stage')?.classList.contains('is-pan')).toBe(true);
    await click(toolButtons[0]!);
    expect(dialog.querySelector('.inpaint-stage')?.classList.contains('is-pan')).toBe(false);

    // 2 本指ピンチが入ったときは進行中ストロークを破棄する（空マスクのまま）
    const stage = dialog.querySelector<HTMLElement>('.inpaint-stage')!;
    const canvas = dialog.querySelector<HTMLCanvasElement>('.inpaint-mask-canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 256,
      bottom: 256,
      width: 256,
      height: 256,
      toJSON: () => ({}),
    });
    await act(async () => {
      stage.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, pointerType: 'touch' }));
      stage.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 2, clientX: 100, clientY: 100, pointerType: 'touch' }));
      stage.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 50, clientY: 50, pointerType: 'touch' }));
      stage.dispatchEvent(makePointerEvent('pointerup', { pointerId: 2, clientX: 100, clientY: 100, pointerType: 'touch' }));
    });
    expect(confirmBtn().disabled).toBe(true);

    // ストローク描画中はオーバーレイが is-drawing で透過し、描画終了で元に戻る
    await act(async () => {
      stage.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 40, clientY: 40 }));
    });
    expect(dialog.querySelector('.inpaint-overlay-bottom')?.classList.contains('is-drawing')).toBe(true);
    await act(async () => {
      stage.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 120 }));
      stage.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 120 }));
    });
    expect(dialog.querySelector('.inpaint-overlay-bottom')?.classList.contains('is-drawing')).toBe(false);
    expect(confirmBtn().disabled).toBe(false);

    // Undo -> 無効、Redo -> 有効、全消去 -> 無効
    await click(buttonByText('元に戻す', dialog));
    expect(confirmBtn().disabled).toBe(true);
    await click(buttonByText('やり直す', dialog));
    expect(confirmBtn().disabled).toBe(false);
    await click(buttonByText('マスクを全消去', dialog));
    expect(confirmBtn().disabled).toBe(true);

    // 設定ポップオーバーが開いているときの Escape はポップオーバーだけ閉じる
    await click(buttonByText('インペイント設定', dialog));
    expect(dialog.querySelector('.inpaint-settings-popover')).not.toBeNull();
    await act(async () => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(dialog.querySelector('.inpaint-settings-popover')).toBeNull();
    expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull();

    // 一時保持して閉じる
    await click(buttonByText('一時保持して閉じる', dialog));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).toBeNull());

    // 2) ImageViewer の「インペイント」ボタンから開く
    await click(container.querySelector<HTMLButtonElement>('.thumb-btn')!);
    await vi.waitFor(() => expect(container.querySelector('dialog.viewer')).not.toBeNull());
    await click(buttonByText('インペイント', container.querySelector('dialog.viewer')!));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());
    expect(container.querySelector('dialog.viewer')).toBeNull();
  });

  it('ドック「参照画像」タブから任意画像で開き、確定でドックを閉じたまま通常の「生成する」ボタンから実行・インペイント中バーから編集へ戻れる', async () => {
    await renderApp();

    // ドック「参照画像」タブを開いてアップロードする
    await click(dockTab('参照画像'));
    expect(container.querySelector('.dock')?.classList.contains('is-open')).toBe(true);

    const fileInput = container.querySelector<HTMLInputElement>('.reference-panel input.inpaint-file-input')!;
    const file = new File([PNG_512], 'custom-base.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());
    // インペイント画面を開くと背後のドックも自動で閉じる
    expect(container.querySelector('.dock')?.classList.contains('is-open')).toBe(false);

    const dialog1 = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    expect(dialog1.textContent).toContain('custom-base.png');
    expect(dialog1.textContent).toContain('512×512');

    // マスクを描画し、オーバーレイ設定ポップオーバーから強さを 0.55 に変更して「確定」する
    await paintStrokeOnDialog(dialog1);
    expect(dialog1.querySelector('.inpaint-settings-popover')).toBeNull();
    await click(buttonByText('インペイント設定', dialog1));
    const popover1 = dialog1.querySelector<HTMLElement>('.inpaint-settings-popover')!;
    expect(popover1).not.toBeNull();
    const addOriginalCheckbox = popover1.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(addOriginalCheckbox.checked).toBe(true);
    const strengthSlider = popover1.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(strengthSlider, '0.55');
      strengthSlider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(popover1.querySelector('output')?.textContent).toBe('0.55');
    expect(dialog1.querySelector('.inpaint-settings-strength')?.textContent).toBe('0.55');

    await click(buttonByText('確定', dialog1));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).toBeNull());

    // ドックは閉じたまま、GenerateBar に「インペイント中」インジケーターが出る
    expect(container.querySelector('.dock')?.classList.contains('is-open')).toBe(false);
    const indicator = container.querySelector<HTMLElement>('.gen-inpaint-indicator')!;
    expect(indicator).not.toBeNull();
    expect(indicator.textContent).toContain('インペイント中（512×512 / 強さ 0.55）');
    const sessionUrl = indicator.querySelector<HTMLImageElement>('.gen-inpaint-thumb')!.getAttribute('src')!;

    // 「インペイント中」バーを押すと、そのまま同じマスク状態・強さでインペイント画面に戻れる
    await click(indicator.querySelector<HTMLButtonElement>('.gen-inpaint-summary')!);
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());
    const dialog2 = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    expect(buttonByText('確定', dialog2).disabled).toBe(false);
    expect(dialog2.querySelector('.inpaint-settings-strength')?.textContent).toBe('0.55');
    await click(buttonByText('確定', dialog2));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).toBeNull());

    // 通常の「生成する」ボタンからインペイントが実行され、結果がそのままギャラリーに出る（ドックも閉じたまま）
    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(requestImages).toHaveBeenCalledTimes(1));
    const req = vi.mocked(requestImages).mock.calls[0]![1];
    expect(req.model).toBe(NAI_INPAINT_MODEL);
    expect(req.action).toBe('infill');
    expect(req.parameters).toMatchObject({
      width: 512,
      height: 512,
      strength: 0.7,
      noise: 0,
      inpaintImg2ImgStrength: 0.55,
      add_original_image: true,
    });
    expect(typeof req.parameters.image).toBe('string');
    expect(typeof req.parameters.mask).toBe('string');
    expect(req.parameters).not.toHaveProperty('director_reference_images');

    // 設定ポップオーバーで「元画像を加える」を OFF にすると add_original_image: false が送られる
    await click(indicator.querySelector<HTMLButtonElement>('.gen-inpaint-summary')!);
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());
    const dialog3 = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    await click(buttonByText('インペイント設定', dialog3));
    const addOriginalToggle = dialog3.querySelector<HTMLInputElement>('.inpaint-settings-popover input[type="checkbox"]')!;
    expect(addOriginalToggle.checked).toBe(true);
    await click(addOriginalToggle);
    expect(addOriginalToggle.checked).toBe(false);
    await click(buttonByText('確定', dialog3));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).toBeNull());

    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(requestImages).toHaveBeenCalledTimes(2));
    const reqOff = vi.mocked(requestImages).mock.calls[1]![1];
    expect(reqOff.parameters.add_original_image).toBe(false);

    expect(container.querySelector('.dock')?.classList.contains('is-open')).toBe(false);
    expect(container.querySelectorAll('.thumb-frame')).toHaveLength(2);
    await click(container.querySelector<HTMLButtonElement>('.thumb-btn')!);
    await vi.waitFor(() => expect(container.querySelector('dialog.viewer')).not.toBeNull());
    expect(container.querySelector('dialog.viewer')?.textContent).toContain('512×512');

    // ギャラリー画像を削除してもインペイントセッションの Object URL は revoke されない
    const galleryUrl = container.querySelector<HTMLImageElement>('.thumb img')!.getAttribute('src')!;
    vi.useFakeTimers();
    try {
      await click(buttonByText('削除', container.querySelector('.viewer-toolbar')!));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      await click(container.querySelector<HTMLButtonElement>('.viewer-remove-confirm')!);
    } finally {
      vi.useRealTimers();
    }
    expect(revokedUrls).toContain(galleryUrl);
    expect(revokedUrls).not.toContain(sessionUrl);

    // GenerateBar の「一時 OFF」を押すとセッション保持のまま通常生成へ切り替わる
    await click(buttonByText('一時 OFF', container.querySelector('.gen-inpaint-indicator')!));
    expect(container.querySelector('.gen-inpaint-indicator')).toBeNull();

    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(requestImages).toHaveBeenCalledTimes(3));
    const normalReq = vi.mocked(requestImages).mock.calls[2]![1];
    expect(normalReq.action).toBe('generate');
    expect(normalReq.parameters).not.toHaveProperty('mask');

    // IndexedDB・localStorage・sessionStorage・バックアップ JSON にベース画像やマスクが含まれない
    const serializedWrites = JSON.stringify(vi.mocked(setKV).mock.calls);
    expect(serializedWrites).not.toContain('custom-base.png');
    expect(serializedWrites).not.toContain('inpaintImg2ImgStrength');
    expect(JSON.stringify(localStorage)).not.toContain('custom-base.png');
    expect(JSON.stringify(sessionStorage)).not.toContain('custom-base.png');
    const backupJson = toBackupJSON({
      dictionary: [],
      presets: [],
      workspace: emptyWorkspace(),
      settings: DEFAULT_SETTINGS,
      generation: DEFAULT_GENERATION,
    });
    expect(backupJson).not.toContain('custom-base.png');
    expect(backupJson).not.toContain('inpaint');

    // 「参照画像」タブにはセッションが残っており、「破棄」で解放・URL revoke される
    await click(dockTab('参照画像'));
    const sessionCard = container.querySelector<HTMLElement>('.inpaint-session-card')!;
    expect(sessionCard).not.toBeNull();
    expect(sessionCard.textContent).toContain('custom-base.png');
    await click(buttonByText('破棄', sessionCard));
    const confirmDialog = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm')!;
    await click(confirmDialog.querySelector<HTMLButtonElement>('button.btn-danger')!);
    await vi.waitFor(() => expect(container.querySelector('.inpaint-session-card')).toBeNull());
    expect(revokedUrls).toContain(sessionUrl);
  });

  it('精密参照 ON との相互排他（双方への切替）が動作し、アンマウント時に Object URL を解放する', async () => {
    await renderApp();

    // 精密参照を追加して ON にする
    await click(dockTab('参照画像'));
    const refInput = container.querySelector<HTMLInputElement>('.reference-panel input.reference-add-input')!;
    Object.defineProperty(refInput, 'files', {
      configurable: true,
      value: [new File([PNG_512], 'ref.png', { type: 'image/png' })],
    });
    await act(async () => {
      refInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => expect(container.querySelectorAll('.reference-card')).toHaveLength(1));
    expect(container.querySelector('.gen-ref-indicator')?.textContent).toContain('精密参照 ON');

    // インペイントを開こうとすると排他確認ダイアログが出る
    const inpaintInput = container.querySelector<HTMLInputElement>('.reference-panel input.inpaint-file-input')!;
    const targetFile = new File([PNG_512], 'inpaint-target.png', { type: 'image/png' });
    Object.defineProperty(inpaintInput, 'files', { configurable: true, value: [targetFile] });
    await act(async () => {
      inpaintInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const confirmCancel = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm')!;
    expect(confirmCancel.textContent).toContain('インペイントでは精密参照を使えません');

    // キャンセル時は精密参照 ON のままでモーダルも開かない
    await click(buttonByText('キャンセル', confirmCancel));
    expect(container.querySelector('dialog.inpaint-dialog')).toBeNull();
    expect(container.querySelector('.gen-ref-indicator')?.textContent).toContain('精密参照 ON');

    // 確定すると精密参照が一時 OFF になり、インペイント画面が開く
    Object.defineProperty(inpaintInput, 'files', { configurable: true, value: [targetFile] });
    await act(async () => {
      inpaintInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const confirmOk = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm')!;
    await click(buttonByText('一時 OFF にして開く', confirmOk));

    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());
    expect(container.querySelector('.gen-ref-indicator')).toBeNull();

    // マスクを描いて確定し、通常の「生成する」で実行すると精密参照を含めない infill になる
    const dialog = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    await paintStrokeOnDialog(dialog);
    await click(buttonByText('確定', dialog));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).toBeNull());
    expect(container.querySelector('.gen-inpaint-indicator')).not.toBeNull();

    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(requestImages).toHaveBeenCalledTimes(1));
    const req = vi.mocked(requestImages).mock.calls[0]![1];
    expect(req.action).toBe('infill');
    expect(req.parameters).not.toHaveProperty('director_reference_images');

    // 逆にインペイント中に精密参照を再度 ON にすると、インペイントが自動で一時 OFF になる
    const heldThumbUrl = container
      .querySelector<HTMLImageElement>('.gen-inpaint-thumb')!
      .getAttribute('src')!;
    await click(dockTab('参照画像'));
    const refSwitch = container.querySelector<HTMLInputElement>('.reference-card input[role="switch"]')!;
    await click(refSwitch);
    await vi.waitFor(() => {
      expect(container.querySelector('.gen-ref-indicator')).not.toBeNull();
      expect(container.querySelector('.gen-inpaint-indicator')).toBeNull();
    });

    // アンマウント時にも保持中の Object URL が revoke される
    await act(async () => root.unmount());
    expect(revokedUrls).toContain(heldThumbUrl);
  });

  it('ブラシサイズ変更時に画面中央へプレビューを表示し、等倍でも画像を画面外へはみ出して移動・リセットできる', async () => {
    await renderApp();

    // 参照画像タブから 512×512 画像でインペイントを開く
    await click(dockTab('参照画像'));
    const fileInput = container.querySelector<HTMLInputElement>('.reference-panel input.inpaint-file-input')!;
    const file = new File([PNG_512], 'pan-test.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());

    const dialog = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    const stage = dialog.querySelector<HTMLElement>('.inpaint-stage')!;
    const wrap = dialog.querySelector<HTMLElement>('.inpaint-canvas-wrap')!;

    // ステージ寸法を 400×400 とみなして等倍（100%）でも移動できることを確認する
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 400 });
    Object.defineProperty(stage, 'clientHeight', { configurable: true, value: 400 });

    // 1) ブラシサイズスライダー操作中は中央プレビューが表示され、離すと自動で消える
    expect(dialog.querySelector('.inpaint-brush-preview')).toBeNull();
    const brushSlider = dialog.querySelector<HTMLInputElement>('input[id$="-brush-size"]')!;
    vi.useFakeTimers();
    try {
      await act(async () => {
        brushSlider.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, pointerType: 'touch' }));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(brushSlider, '48');
        brushSlider.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const preview = dialog.querySelector<HTMLElement>('.inpaint-brush-preview')!;
      expect(preview).not.toBeNull();
      expect(preview.querySelector('.inpaint-brush-preview-label')?.textContent).toBe('96px');

      await act(async () => {
        // 別の指（別 pointerId）が離れてもプレビューは閉じない
        window.dispatchEvent(makePointerEvent('pointerup', { pointerId: 2, clientX: 100, clientY: 100, pointerType: 'touch' }));
        vi.advanceTimersByTime(500);
      });
      expect(dialog.querySelector('.inpaint-brush-preview')).not.toBeNull();

      await act(async () => {
        // 元のポインターがスライダー外で離れたときは自動で閉じる
        window.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 300, clientY: 10, pointerType: 'mouse' }));
        vi.advanceTimersByTime(500);
      });
      expect(dialog.querySelector('.inpaint-brush-preview')).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    // 2) 移動・ズームツールに切り替えて等倍のまま大きくドラッグすると画像が移動する（上限 200px まで）
    await click(buttonByText('移動・ズーム', dialog));
    await act(async () => {
      stage.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 200, clientY: 200, pointerType: 'touch' }));
      stage.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 350, clientY: 450, pointerType: 'touch' }));
      stage.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 350, clientY: 450, pointerType: 'touch' }));
    });
    expect(wrap.style.transform).toBe('translate(150px, 200px) scale(1)');

    // 3) 100% リセットボタンで中央に戻る
    await click(buttonByText('拡大率を 100% に戻す', dialog));
    expect(wrap.style.transform).toBe('translate(0px, 0px) scale(1)');

    // 4) 画像外の余白をタップしてもマスク履歴（Undo）には記録されない
    await click(buttonByText('ブラシ', dialog));
    const canvas = dialog.querySelector<HTMLCanvasElement>('.inpaint-mask-canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 356,
      bottom: 356,
      width: 256,
      height: 256,
      toJSON: () => ({}),
    });
    await act(async () => {
      stage.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 5, clientY: 5 }));
      stage.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 5, clientY: 5 }));
    });
    expect(buttonByText('元に戻す', dialog).disabled).toBe(true);
    expect(buttonByText('確定', dialog).disabled).toBe(true);

    // 5) 画像の左外から右外へ一気に横切るドラッグは線分が画像と交差するため保持される
    await act(async () => {
      stage.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 200 }));
      stage.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 450, clientY: 200 }));
      stage.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 450, clientY: 200 }));
    });
    expect(buttonByText('元に戻す', dialog).disabled).toBe(false);
    expect(buttonByText('確定', dialog).disabled).toBe(false);
  });
});
