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

function image(seed: number, downloaded: boolean): GeneratedImage {
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
    downloaded,
    pinned: false,
  };
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((el) => el.textContent === text);
  if (!found) throw new Error(`button not found: ${text}`);
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

async function confirmZipSaved() {
  await act(async () => {
    buttonByText('保存できた').click();
  });
}

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

it('downloads every image in a zip using the individual file names and marks them downloaded', async () => {
  const images = [image(2, false), image(1, true)];
  const onDownloaded = vi.fn();
  const saved = captureDownloads();
  await renderGallery(images, { onDownloaded });

  await act(async () => {
    buttonByText('すべて ZIP で保存').click();
  });

  expect(saved).toHaveLength(1);
  expect(onDownloaded).not.toHaveBeenCalled();
  await confirmZipSaved();

  expect(saved[0]!.name).toMatch(/^nai-tagdeck-\d{8}-\d{6}\.zip$/);
  const files = unzipSync(new Uint8Array(await saved[0]!.blob.arrayBuffer()));
  const ordered = [...images].reverse();
  expect(Object.keys(files)).toEqual(ordered.map((item) => imageFileName(item)));
  for (const item of ordered) {
    expect(files[imageFileName(item)]).toEqual(new Uint8Array(await item.blob.arrayBuffer()));
  }
  expect(onDownloaded.mock.calls.map((call) => call[0])).toEqual(['img-2', 'img-1']);
});

it('zips only images that are not downloaded yet', async () => {
  const images = [image(2, false), image(1, true)];
  const onDownloaded = vi.fn();
  const saved = captureDownloads();
  await renderGallery(images, { onDownloaded });

  expect(buttonByText('未ダウンロードを ZIP で保存').disabled).toBe(false);
  await act(async () => {
    buttonByText('未ダウンロードを ZIP で保存').click();
  });
  await act(async () => {
    buttonByText('キャンセル').click();
  });
  expect(onDownloaded).not.toHaveBeenCalled();
  expect(buttonByText('未ダウンロードを ZIP で保存').disabled).toBe(false);
  expect(container.querySelector('.notice')?.textContent).toContain('もう一度 ZIP で保存できます');

  await act(async () => {
    buttonByText('未ダウンロードを ZIP で保存').click();
  });
  await confirmZipSaved();

  expect(saved[0]!.name).toMatch(/^nai-tagdeck-undownloaded-\d{8}-\d{6}\.zip$/);
  const files = unzipSync(new Uint8Array(await saved[0]!.blob.arrayBuffer()));
  expect(Object.keys(files)).toEqual([imageFileName(images[0]!)]);
  expect(onDownloaded.mock.calls.map((call) => call[0])).toEqual(['img-2']);
});

it('disables zip actions when there is nothing to save and toggles pin from the thumbnail', async () => {
  const onTogglePin = vi.fn();
  await renderGallery([], { onTogglePin });
  expect(buttonByText('すべて ZIP で保存').disabled).toBe(true);
  expect(buttonByText('未ダウンロードを ZIP で保存').disabled).toBe(true);

  const only = image(4, true);
  await renderGallery([only], { onTogglePin });
  expect(buttonByText('未ダウンロードを ZIP で保存').disabled).toBe(true);
  const pin = container.querySelector('.thumb-pin') as HTMLButtonElement;
  expect(pin.getAttribute('aria-label')).toBe('生成画像 1をピン留め');
  expect(pin.getAttribute('aria-pressed')).toBe('false');
  await act(async () => {
    pin.click();
  });
  expect(onTogglePin).toHaveBeenCalledWith('img-4');
});
