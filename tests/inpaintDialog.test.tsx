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
    expect(container.querySelector('.anlas-line')?.textContent).toContain('残高');
    expect(buttonByText('生成する').disabled).toBe(false);
  });
}

function makePointerEvent(type: string, init: { pointerId?: number; clientX: number; clientY: number; pointerType?: string; button?: number }) {
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

describe('インペイント導線・マスク編集・一時保持・排他・非永続化', () => {
  it('ギャラリー ⋯ メニューと ImageViewer の両方からモーダルを開き、空マスクは無効・描画後は有効・ピンチ時は進行中ストロークを破棄する', async () => {
    await renderApp();

    // まず 1 枚生成してギャラリーに表示する
    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(container.querySelectorAll('.thumb-frame')).toHaveLength(1));

    // 1) ギャラリー ⋯ メニューから「インペイント」で開く
    await click(container.querySelector<HTMLButtonElement>('.thumb-more')!);
    await click(buttonByText('インペイント', container.querySelector('.thumb-menu')!));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());

    const dialog = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    const runBtn = () => buttonByText('インペイントを実行', dialog);
    expect(runBtn().disabled).toBe(true);
    expect(dialog.textContent).toContain('描き直す部分をマスクで塗ってください');

    // 2 本指ピンチが入ったときは進行中ストロークを破棄する（空マスクのまま）
    const stage = dialog.querySelector<HTMLElement>('.inpaint-stage')!;
    const canvas = dialog.querySelector<HTMLCanvasElement>('.inpaint-mask-canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 256, bottom: 256, width: 256, height: 256, toJSON: () => ({}),
    });
    await act(async () => {
      stage.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, pointerType: 'touch' }));
      stage.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 2, clientX: 100, clientY: 100, pointerType: 'touch' }));
      stage.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 50, clientY: 50, pointerType: 'touch' }));
      stage.dispatchEvent(makePointerEvent('pointerup', { pointerId: 2, clientX: 100, clientY: 100, pointerType: 'touch' }));
    });
    expect(runBtn().disabled).toBe(true);

    // 1 本指／マウスで描くと実行ボタンが有効になる
    await paintStrokeOnDialog(dialog);
    expect(runBtn().disabled).toBe(false);

    // Undo -> 無効、Redo -> 有効、全消去 -> 無効
    await click(buttonByText('元に戻す', dialog));
    expect(runBtn().disabled).toBe(true);
    await click(buttonByText('やり直す', dialog));
    expect(runBtn().disabled).toBe(false);
    await click(buttonByText('マスクを全消去', dialog));
    expect(runBtn().disabled).toBe(true);

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

  it('ドック「参照画像」タブから任意画像で開き、閉じて一時保持→再開→実行・破棄と URL 寿命・非永続化が正しく動作する', async () => {
    await renderApp();

    await click(dockTab('参照画像'));
    const fileInput = container.querySelector<HTMLInputElement>('.reference-panel input.inpaint-file-input')!;
    const file = new File([PNG_512], 'custom-base.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());
    const dialog1 = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    expect(dialog1.textContent).toContain('custom-base.png');
    expect(dialog1.textContent).toContain('512×512');

    // マスクを描画し、強さを 0.55 に変更
    await paintStrokeOnDialog(dialog1);
    const strengthSlider = dialog1.querySelector<HTMLInputElement>('aside.inpaint-side input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(strengthSlider, '0.55');
      strengthSlider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(dialog1.querySelector('aside.inpaint-side output')?.textContent).toBe('0.55');

    // 「タグを編集（一時保存して閉じる）」でモーダルを閉じる
    await click(buttonByText('タグを編集（一時保存して閉じる）', dialog1));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).toBeNull());

    // 「参照画像」タブに一時保持セッションがサムネイル付きで表示される
    await click(dockTab('参照画像'));
    const sessionCard = container.querySelector<HTMLElement>('.inpaint-session-card')!;
    expect(sessionCard).not.toBeNull();
    expect(sessionCard.textContent).toContain('custom-base.png');
    expect(sessionCard.textContent).toContain('マスク描画済み');
    const sessionUrl = sessionCard.querySelector<HTMLImageElement>('.inpaint-session-thumb')!.getAttribute('src')!;

    // 「マスク編集を再開」で同じマスク状態・強さのまま再開できる
    await click(buttonByText('マスク編集を再開', sessionCard));
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());
    const dialog2 = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    expect(buttonByText('インペイントを実行', dialog2).disabled).toBe(false);
    expect(dialog2.querySelector('aside.inpaint-side output')?.textContent).toBe('0.55');

    // 実行すると専用モデル・action: infill・ベース画像寸法 512×512・inpaintImg2ImgStrength 0.55 で送信される
    await click(buttonByText('インペイントを実行', dialog2));
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
      add_original_image: false,
    });
    expect(typeof req.parameters.image).toBe('string');
    expect(typeof req.parameters.mask).toBe('string');
    expect(req.parameters).not.toHaveProperty('director_reference_images');

    // 生成成功後はモーダルが閉じ、ギャラリーへ追加される（width/height は generation.size ではなく inpaint 寸法 512×512）
    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).toBeNull());
    expect(container.querySelectorAll('.thumb-frame')).toHaveLength(1);
    await click(container.querySelector<HTMLButtonElement>('.thumb-btn')!);
    await vi.waitFor(() => expect(container.querySelector('dialog.viewer')).not.toBeNull());
    expect(container.querySelector('dialog.viewer')?.textContent).toContain('512×512');
    // ギャラリー画像を削除してもインペイント一時保持セッションの Object URL は revoke されない
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

    // 「破棄」で確認ダイアログを確定するとセッションと Object URL が解放される
    await click(buttonByText('破棄', container.querySelector('.inpaint-session-card')!));
    const confirmDialog = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm')!;
    expect(confirmDialog).not.toBeNull();
    await click(confirmDialog.querySelector<HTMLButtonElement>('button.btn-danger')!);
    await vi.waitFor(() => expect(container.querySelector('.inpaint-session-card')).toBeNull());
    expect(revokedUrls).toContain(sessionUrl);
  });

  it('精密参照 ON の状態からインペイントを開くと確認ダイアログで一時 OFF に切り替え、リクエストに精密参照を含めない', async () => {
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

    // インペイントをアップロードで開こうとすると排他確認ダイアログが出る
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

    // もう一度試して「一時 OFF にして開く」を確定する
    Object.defineProperty(inpaintInput, 'files', { configurable: true, value: [targetFile] });
    await act(async () => {
      inpaintInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const confirmOk = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm')!;
    await click(buttonByText('一時 OFF にして開く', confirmOk));

    await vi.waitFor(() => expect(container.querySelector('dialog.inpaint-dialog')).not.toBeNull());
    // 精密参照は一時 OFF になり、インジケーターが消える
    expect(container.querySelector('.gen-ref-indicator')).toBeNull();

    // マスクを描いて実行しても精密参照はリクエストに含まれない
    const dialog = container.querySelector<HTMLDialogElement>('dialog.inpaint-dialog')!;
    await paintStrokeOnDialog(dialog);
    await click(buttonByText('インペイントを実行', dialog));
    await vi.waitFor(() => expect(requestImages).toHaveBeenCalledTimes(1));
    const req = vi.mocked(requestImages).mock.calls[0]![1];
    expect(req.action).toBe('infill');
    expect(req.parameters).not.toHaveProperty('director_reference_images');

    // アンマウント時にも保持中の Object URL が revoke される
    const heldThumbUrl = container
      .querySelector<HTMLImageElement>('.inpaint-session-thumb')!
      .getAttribute('src')!;
    await act(async () => root.unmount());
    expect(revokedUrls).toContain(heldThumbUrl);
  });
});
