// @vitest-environment jsdom
import { unzipSync } from 'fflate';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { Gallery } from '../src/components/Gallery';
import { imageFileName } from '../src/components/ImageViewer';
import type { GeneratedImage } from '../src/hooks/useImages';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;

function image(seed: number, options?: { downloaded?: boolean; pinned?: boolean }): GeneratedImage {
  const bytes = new Uint8Array([seed, seed + 1, seed + 2, seed + 3]);
  return {
    id: `img-${seed}`,
    url: `blob:full-${seed}`,
    blob: new Blob([bytes], { type: 'image/png' }),
    seed,
    width: 64,
    height: 64,
    prompt: `prompt-${seed}`,
    characterPrompts: [],
    createdAt: Date.UTC(2026, 10, 22, 3, 4, seed),
    downloaded: options?.downloaded ?? false,
    pinned: options?.pinned ?? false,
  };
}

function zipButton(): HTMLButtonElement {
  const found = container.querySelector('.gallery-zip-btn');
  if (!found) throw new Error('zip button not found');
  return found as HTMLButtonElement;
}

async function renderGallery(images: GeneratedImage[], props?: { onDownloaded?: (id: string) => void; onTogglePin?: (id: string) => void }) {
  await act(async () => {
    root.render(
      <DialogProvider>
        <Gallery
          images={images}
          generating={false}
          pendingSize={{ width: 64, height: 64 }}
          onRemove={vi.fn()}
          onClear={vi.fn()}
          onUseSeed={vi.fn()}
          onDownloaded={props?.onDownloaded ?? vi.fn()}
          onTogglePin={props?.onTogglePin ?? vi.fn()}
          onReadPng={vi.fn()}
        />
      </DialogProvider>,
    );
  });
}

const stubDialog = () => {
  const prototype = HTMLDialogElement.prototype;
  const originals = ['showModal', 'close'].map((name) => [name, Object.getOwnPropertyDescriptor(prototype, name)] as const);
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(prototype, name, descriptor);
      else Reflect.deleteProperty(prototype, name);
    }
  };
};

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

function captureDownloads(): { name: string; blob: Blob }[] {
  const saved: { name: string; blob: Blob }[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
    if (obj instanceof Blob) saved.push({ name: '', blob: obj });
    return `blob:download-${saved.length}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const last = saved.at(-1);
    if (last) last.name = this.download;
  });
  return saved;
}

it('downloads only pinned images in a zip without confirmation dialog and marks them downloaded', async () => {
  const images = [
    image(3, { pinned: true }),
    image(2, { pinned: false }),
    image(1, { pinned: true, downloaded: true }),
  ];
  const onDownloaded = vi.fn();
  const saved = captureDownloads();
  await renderGallery(images, { onDownloaded });

  expect(zipButton().disabled).toBe(false);
  expect(zipButton().textContent).toContain('ピン留めを ZIP 保存');
  expect(zipButton().textContent).toContain('2');
  expect(container.textContent).not.toContain('すべて ZIP で保存');
  expect(container.textContent).not.toContain('未ダウンロードを ZIP で保存');

  await act(async () => {
    zipButton().click();
  });
  // imageZip は動的 import のため、ZIP 保存が終わるまで待つ
  await vi.waitFor(() => expect(saved).toHaveLength(1), { timeout: 5000 });

  expect(saved).toHaveLength(1);
  expect(container.querySelector('dialog[open]')).toBeNull();
  expect(saved[0]!.name).toMatch(/^nai-tagdeck-pinned-\d{8}-\d{6}\.zip$/);
  const files = unzipSync(new Uint8Array(await saved[0]!.blob.arrayBuffer()));
  const expected = [images[2]!, images[0]!];
  expect(Object.keys(files)).toEqual(expected.map((item) => imageFileName(item)));
  for (const item of expected) {
    expect(files[imageFileName(item)]).toEqual(new Uint8Array(await item.blob.arrayBuffer()));
  }
  expect(onDownloaded.mock.calls.map((call) => call[0])).toEqual(['img-3', 'img-1']);
});

it('does not export a zip after its pinned images are removed', async () => {
  const pending = image(3, { pinned: true });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = pending.blob.arrayBuffer.bind(pending.blob);
  pending.blob.arrayBuffer = () => gate.then(() => read());
  const onDownloaded = vi.fn();
  const saved = captureDownloads();
  await renderGallery([pending], { onDownloaded });
  act(() => {
    zipButton().click();
  });
  await renderGallery([], { onDownloaded });
  release();
  await act(async () => {
    await gate;
  });
  expect(saved).toHaveLength(0);
  expect(onDownloaded).not.toHaveBeenCalled();
});

it('disables pinned zip action when nothing is pinned, renders visual retention meter with byte limit and tab-close warning, and toggles pin', async () => {
  const onTogglePin = vi.fn();
  await renderGallery([], { onTogglePin });
  expect(zipButton().disabled).toBe(true);
  expect(container.querySelector('.gallery-meter')).not.toBeNull();
  expect(container.textContent).not.toContain('画像はこのタブのメモリにだけあり');
  expect(container.textContent).toContain('タブを閉じると消去');
  expect(container.textContent).toContain('0/30枚');
  expect(container.textContent).toContain('0/80MB');
  expect(container.querySelector('.gallery-meter-help summary')).not.toBeNull();

  const only = image(4, { downloaded: true, pinned: false });
  await renderGallery([only], { onTogglePin });
  expect(zipButton().disabled).toBe(true);
  expect(container.querySelector('.gallery-meter-seg.is-saved')).not.toBeNull();

  const pin = container.querySelector('.thumb-pin') as HTMLButtonElement;
  expect(pin.getAttribute('aria-label')).toBe('生成画像 1をピン留め');
  expect(pin.getAttribute('aria-pressed')).toBe('false');
  await act(async () => {
    pin.click();
  });
  expect(onTogglePin).toHaveBeenCalledWith('img-4');
});
