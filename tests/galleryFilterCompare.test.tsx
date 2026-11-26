// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { Gallery } from '../src/components/Gallery';
import type { GeneratedImage } from '../src/hooks/useImages';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;

function makeImage(seed: number, extra: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: `img-${seed}`,
    url: `blob:img-${seed}`,
    blob: new Blob([new Uint8Array([seed])], { type: 'image/png' }),
    seed,
    width: 832,
    height: 1216,
    prompt: `1girl, tag-${seed}`,
    characterPrompts: [],
    createdAt: Date.UTC(2026, 10, 22, 3, 4, seed),
    downloaded: false,
    pinned: false,
    ...extra,
  };
}

const stubDialog = () => {
  const prototype = HTMLDialogElement.prototype;
  const originals = ['showModal', 'close'].map((name) => [name, Object.getOwnPropertyDescriptor(prototype, name)] as const);
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      },
    },
  });
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(prototype, name, descriptor);
      else Reflect.deleteProperty(prototype, name);
    }
  };
};

async function renderGallery(
  images: GeneratedImage[],
  options?: { generating?: boolean; onRemove?: (id: string) => void; onTogglePin?: (id: string) => void },
) {
  await act(async () => {
    root.render(
      <DialogProvider>
        <Gallery
          images={images}
          generating={options?.generating ?? false}
          pendingSize={{ width: 832, height: 1216 }}
          onRemove={options?.onRemove ?? vi.fn()}
          onClear={vi.fn()}
          onUseSeed={vi.fn()}
          onDownloaded={vi.fn()}
          onTogglePin={options?.onTogglePin ?? vi.fn()}
          onReadPng={vi.fn()}
        />
      </DialogProvider>,
    );
  });
}

function clickButtonByText(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`Button containing "${text}" not found`);
  return btn;
}

describe('Gallery filtering and 2-image comparison', () => {
  let restoreDialog: (() => void) | undefined;

  beforeEach(() => {
    restoreDialog = stubDialog();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    restoreDialog?.();
    vi.restoreAllMocks();
  });

  it('filters images by pinned and undownloaded, toggles uniform grid, and resets from empty state', async () => {
    const images = [
      makeImage(1, { pinned: true, downloaded: true }),
      makeImage(2, { pinned: false, downloaded: false }),
    ];
    await renderGallery(images, { generating: true });

    const thumbs = () => container.querySelector('ul.thumbs');
    expect(thumbs()?.classList.contains('is-uniform')).toBe(false);
    expect(container.querySelectorAll('.thumb-frame')).toHaveLength(2);
    expect(container.querySelector('.thumb.is-pending')).not.toBeNull();

    await act(async () => clickButtonByText('ピン留め1').click());
    expect(thumbs()?.classList.contains('is-uniform')).toBe(true);
    expect(container.querySelectorAll('.thumb-frame')).toHaveLength(1);
    expect(container.querySelector('.thumb.is-pending')).toBeNull();

    await act(async () => clickButtonByText('未DL1').click());
    expect(container.querySelectorAll('.thumb-frame')).toHaveLength(1);
    expect(container.querySelector('.thumb.is-pending')).not.toBeNull();

    // All downloaded -> empty state on undownloaded filter
    await renderGallery([makeImage(1, { pinned: false, downloaded: true })]);
    expect(container.textContent).toContain('未 DL の画像はありません');
    await act(async () => clickButtonByText('すべて表示').click());
    expect(container.querySelectorAll('.thumb-frame')).toHaveLength(1);
  });

  it('keeps ImageViewer open when unpinned under pinned filter', async () => {
    const img1 = makeImage(1, { pinned: true });
    const img2 = makeImage(2, { pinned: false });
    await renderGallery([img1, img2]);

    await act(async () => clickButtonByText('ピン留め1').click());
    await act(async () => {
      (container.querySelector('.thumb-btn') as HTMLButtonElement).click();
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(container.querySelector('dialog.viewer')).not.toBeNull();

    // Unpin img1 externally -> no longer matches pinned filter, but viewer stays open
    await renderGallery([makeImage(1, { pinned: false }), img2]);
    expect(container.querySelector('dialog.viewer')).not.toBeNull();
  });

  it('selects 2 images across filters, opens compare dialog, supports swap/flip/keys, and closes safely on delete', async () => {
    const img1 = makeImage(1, { pinned: true, downloaded: true, prompt: '1girl, smile' });
    const img2 = makeImage(2, { pinned: false, downloaded: false, prompt: '1girl, 1.2::smile::, hat' });
    await renderGallery([img1, img2]);

    const compareToggle = container.querySelector('.gallery-compare-toggle') as HTMLButtonElement;
    expect(compareToggle.disabled).toBe(false);
    await act(async () => compareToggle.click());
    expect(compareToggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('ul.thumbs')?.classList.contains('is-uniform')).toBe(true);

    // Filter to pinned and pick A
    await act(async () => clickButtonByText('ピン留め1').click());
    const firstThumbBtn = container.querySelector('.thumb-btn') as HTMLButtonElement;
    await act(async () => firstThumbBtn.click());
    expect(firstThumbBtn.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.thumb-compare-badge')?.textContent).toBe('A');

    // Switch to undownloaded filter and pick B -> auto-opens compare dialog
    await act(async () => clickButtonByText('未DL1').click());
    const secondThumbBtn = container.querySelector('.thumb-btn') as HTMLButtonElement;
    await act(async () => secondThumbBtn.click());
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    const dialog = container.querySelector('dialog.compare-dialog') as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('設定の差分');
    expect(dialog?.textContent).toContain('重み変更');
    expect(dialog?.textContent).toContain('+ Bのみ');

    // Swap A and B
    await act(async () => clickButtonByText('A ⇄ B 入れ替え').click());
    expect(dialog?.textContent).toContain('- Aのみ');

    // Switch to flip mode and use ArrowRight key
    await act(async () => clickButtonByText('A・B 切替').click());
    const flipA = () => [...(dialog?.querySelectorAll('.compare-flip-bar button') ?? [])][0] as HTMLButtonElement;
    const flipB = () => [...(dialog?.querySelectorAll('.compare-flip-bar button') ?? [])][1] as HTMLButtonElement;
    expect(flipA().getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(flipB().getAttribute('aria-pressed')).toBe('true');

    // Removing one of the compared images safely closes the compare dialog
    await renderGallery([img1]);
    expect(container.querySelector('dialog.compare-dialog')).toBeNull();
    expect((container.querySelector('.gallery-compare-toggle') as HTMLButtonElement).disabled).toBe(true);
  });
});
