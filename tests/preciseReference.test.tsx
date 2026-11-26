// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
import { GenerateDock } from '../src/components/GenerateDock';
import { toBackupJSON } from '../src/lib/backup';
import { getKV, listEntries, setKV } from '../src/lib/db';
import { DEFAULT_GENERATION } from '../src/lib/generation';
import { fetchSubscription, requestImages, type Subscription } from '../src/lib/novelai';
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

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

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

async function uploadReferenceFile(name = 'char-ref.png') {
  const input = container.querySelector<HTMLInputElement>('.reference-panel input[type="file"]')!;
  const file = new File([PNG_BYTES], name, { type: 'image/png' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await vi.waitFor(() => {
    expect(container.querySelector('.reference-thumb')).not.toBeNull();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  urlSeq = 0;
  createdUrls = [];
  revokedUrls = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:mock-${++urlSeq}`;
    createdUrls.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revokedUrls.push(url);
  });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  sessionStorage.setItem('nai-tagdeck.token', 'pst-test-token');
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
  vi.mocked(requestImages).mockResolvedValue([{ blob: new Blob([PNG_BYTES], { type: 'image/png' }), seed: 999 }]);
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

describe('精密参照 UI・Anlas 連動・生成送信', () => {
  it('アップロード・種別切替・強さ変更・一時 OFF・削除で GenerateBar と AnlasLine が連動し、生成リクエストに反映される', async () => {
    await renderApp();

    // 初期状態: 消費 0、インジケーターなし、タブにアクティブドットなし
    expect(container.querySelector('.anlas-line')?.textContent).toContain('消費 0 / 残高 18,000');
    expect(container.querySelector('.gen-ref-indicator')).toBeNull();
    expect(dockTab('参照画像').querySelector('.dock-tab-dot')).toBeNull();

    await click(dockTab('参照画像'));
    expect(dockTab('参照画像').getAttribute('aria-selected')).toBe('true');

    // アップロードすると 5 Anlas・インジケーター・ドットが ON になる
    await uploadReferenceFile('my-outfit.png');
    expect(container.querySelector('.anlas-line')?.textContent).toContain('消費 5 / 残高 18,000');
    expect(container.querySelector('.gen-ref-indicator')?.textContent).toContain('精密参照 ON（キャラクター / +5 Anlas）');
    expect(dockTab('参照画像').querySelector('.dock-tab-dot')).not.toBeNull();
    expect(dockTab('参照画像').textContent).toContain('（精密参照 ON）');

    // 種別を「衣装」に切り替え
    await click(buttonByText('衣装', container.querySelector('.reference-panel')!));
    expect(container.querySelector('.gen-ref-indicator')?.textContent).toContain('精密参照 ON（衣装 / +5 Anlas）');

    // 強さを 3.25 に変更
    const slider = container.querySelector<HTMLInputElement>('.reference-panel input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '3.25');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('.reference-panel output')?.textContent).toBe('3.25');

    // 生成すると director_reference_* が送られる
    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(requestImages).toHaveBeenCalledTimes(1));
    const firstReq = vi.mocked(requestImages).mock.calls[0]![1];
    expect(firstReq.parameters).toMatchObject({
      director_reference_images: ['RAW_REF_BASE64'],
      director_reference_descriptions: [{ caption: { base_caption: 'costume', char_captions: [] }, legacy_uc: false }],
      director_reference_strength_values: [3.25],
      director_reference_secondary_strength_values: [0],
      director_reference_information_extracted: [1],
    });

    // GenerateBar の「一時 OFF」を押すと画像保持のまま 0 Anlas・インジケーター非表示になる
    await click(buttonByText('一時 OFF', container.querySelector('.generate-bar')!));
    expect(container.querySelector('.anlas-line')?.textContent).toContain('消費 0 / 残高 18,000');
    expect(container.querySelector('.gen-ref-indicator')).toBeNull();
    expect(container.querySelector('.reference-thumb')).not.toBeNull();
    expect(dockTab('参照画像').querySelector('.dock-tab-dot')).toBeNull();

    // 一時 OFF 中に生成すると director_reference_* は送られない
    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(requestImages).toHaveBeenCalledTimes(2));
    const secondReq = vi.mocked(requestImages).mock.calls[1]![1];
    expect(secondReq.parameters).not.toHaveProperty('director_reference_images');

    // トグルで再び ON にし、削除すると 0 Anlas に戻りプレビュー URL が revoke される
    const toggle = container.querySelector<HTMLInputElement>('.reference-panel input[role="switch"]')!;
    await click(toggle);
    expect(container.querySelector('.anlas-line')?.textContent).toContain('消費 5 / 残高 18,000');

    const previewUrl = container.querySelector<HTMLImageElement>('.reference-thumb')!.src;
    await click(buttonByText('削除', container.querySelector('.reference-panel')!));
    expect(container.querySelector('.anlas-line')?.textContent).toContain('消費 0 / 残高 18,000');
    expect(container.querySelector('.reference-thumb')).toBeNull();
    expect(revokedUrls).toContain(previewUrl);
  });

  it('非 Opus / 枠超過時は AnlasLine が「+5〜」になる', async () => {
    vi.mocked(fetchSubscription).mockResolvedValueOnce({
      tier: 1,
      fixedTrainingStepsLeft: 500,
      purchasedTrainingSteps: 0,
      totalAnlas: 500,
      expiresAt: null,
      usage: null,
    });
    await renderApp();
    expect(container.querySelector('.anlas-line')?.textContent).toContain('消費 有料 / 残高 500');

    await click(dockTab('参照画像'));
    await uploadReferenceFile();
    expect(container.querySelector('.anlas-line')?.textContent).toContain('消費 +5〜 / 残高 500');
  });
});

describe('ギャラリー ⋯ メニュー・ImageViewer 導線・URL 寿命と非永続化', () => {
  it('ギャラリー ⋯ メニューの開閉（外側クリック・Escape・比較モード）と参照設定ができ、履歴削除後も参照 URL が有効', async () => {
    await renderApp();

    // 2枚生成して比較モードと個別削除を試せるようにする
    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(container.querySelectorAll('.thumb-frame')).toHaveLength(1));
    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(container.querySelectorAll('.thumb-frame')).toHaveLength(2));

    // 比較モード中は ⋯ メニューボタンが非表示になる
    await click(buttonByText('比較'));
    expect(container.querySelector('.thumb-more')).toBeNull();
    await click(buttonByText('比較'));
    expect(container.querySelectorAll('.thumb-more')).toHaveLength(2);

    // ⋯ メニューを開き、外側クリックで閉じる
    const moreBtn = container.querySelectorAll<HTMLButtonElement>('.thumb-more')[0]!;
    await click(moreBtn);
    expect(moreBtn.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.thumb-menu')).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('.thumb-menu')).toBeNull();
    expect(moreBtn.getAttribute('aria-expanded')).toBe('false');

    // Escape キーで閉じてボタンへフォーカスが戻る
    await click(moreBtn);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('.thumb-menu')).toBeNull();
    expect(document.activeElement).toBe(moreBtn);

    // 「参照に使う」を実行すると参照画像タブが自動で開く
    await click(moreBtn);
    await click(buttonByText('参照に使う', container.querySelector('.thumb-menu')!));
    await vi.waitFor(() => {
      expect(container.querySelector('.reference-thumb')).not.toBeNull();
    });
    expect(dockTab('参照画像').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.dock')?.classList.contains('is-open')).toBe(true);

    const refUrl = container.querySelector<HTMLImageElement>('.reference-thumb')!.getAttribute('src')!;
    const firstGalleryUrl = container.querySelectorAll<HTMLImageElement>('.thumb img')[0]!.getAttribute('src')!;
    expect(refUrl).not.toBe(firstGalleryUrl);

    // 元の履歴画像を ImageViewer から削除しても、参照画像の Object URL は revoke されない
    await click(container.querySelectorAll<HTMLButtonElement>('.thumb-btn')[0]!);
    await vi.waitFor(() => expect(container.querySelector('dialog.viewer')).not.toBeNull());
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
    expect(revokedUrls).toContain(firstGalleryUrl);
    expect(revokedUrls).not.toContain(refUrl);
    expect(container.querySelector<HTMLImageElement>('.reference-thumb')?.getAttribute('src')).toBe(refUrl);
  });

  it('ImageViewer の「参照に使う」でビューアーを閉じて参照画像へセットし、差し替え・アンマウント時に revokeObjectURL が呼ばれる', async () => {
    await renderApp();
    await click(buttonByText('生成する'));
    await vi.waitFor(() => expect(container.querySelectorAll('.thumb-frame')).toHaveLength(1));

    await click(container.querySelector<HTMLButtonElement>('.thumb-btn')!);
    await vi.waitFor(() => expect(container.querySelector('dialog.viewer')).not.toBeNull());

    await click(buttonByText('参照に使う', container.querySelector('dialog.viewer')!));
    await vi.waitFor(() => {
      expect(container.querySelector('.reference-thumb')).not.toBeNull();
    });
    expect(container.querySelector('dialog.viewer')).toBeNull();
    expect(dockTab('参照画像').getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('参照画像に設定しました');

    const firstRefUrl = container.querySelector<HTMLImageElement>('.reference-thumb')!.getAttribute('src')!;

    // 差し替え時に古い参照 URL が revoke される
    await uploadReferenceFile('second-ref.png');
    expect(revokedUrls).toContain(firstRefUrl);
    const secondRefUrl = container.querySelector<HTMLImageElement>('.reference-thumb')!.getAttribute('src')!;
    expect(secondRefUrl).not.toBe(firstRefUrl);

    // アンマウント時にも現在の参照 URL が revoke される
    await act(async () => root.unmount());
    expect(revokedUrls).toContain(secondRefUrl);
  });

  it('IndexedDB・localStorage・sessionStorage・バックアップ JSON に参照画像データが含まれない', async () => {
    await renderApp();
    await click(dockTab('参照画像'));
    await uploadReferenceFile('secret-ref.png');

    const serializedWrites = JSON.stringify(vi.mocked(setKV).mock.calls);
    expect(serializedWrites).not.toContain('secret-ref.png');
    expect(serializedWrites).not.toContain('RAW_REF_BASE64');
    expect(serializedWrites).not.toContain('director_reference');
    expect(JSON.stringify(localStorage)).not.toContain('secret-ref.png');
    expect(JSON.stringify(sessionStorage)).not.toContain('secret-ref.png');

    const backupJson = toBackupJSON({
      dictionary: [],
      presets: [],
      workspace: emptyWorkspace(),
      settings: DEFAULT_SETTINGS,
      generation: DEFAULT_GENERATION,
    });
    expect(backupJson).not.toContain('secret-ref.png');
    expect(backupJson).not.toContain('director_reference');
  });
});

describe('GenerateDock 3タブキーボード操作', () => {
  it('ArrowLeft / ArrowRight / Home / End で 3 タブを巡回し、参照 ON 表示が出る', async () => {
    await act(async () => {
      root.render(
        <GenerateDock
          collapseSignal={0}
          generating={false}
          referenceActive
          error={null}
          onDismissError={() => {}}
          promptPanel={<div>prompt</div>}
          generatePanel={<div>generate</div>}
          referencePanel={<div>reference</div>}
        />,
      );
    });

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['プロンプト', '生成', '参照画像（精密参照 ON）']);
    expect(tabs[2]!.querySelector('.dock-tab-dot')).not.toBeNull();

    await act(async () => {
      tabs[0]!.focus();
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      tabs[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[0]);

    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[2]);

    await act(async () => {
      tabs[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[0]);
  });
});
