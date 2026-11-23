// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { Gallery } from '../src/components/Gallery';
import { useImages, type ImageStore, type NewImage, type UseImagesOptions } from '../src/hooks/useImages';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let store: ImageStore;
let urlSeq = 0;
let createdUrls: string[];
let revokedUrls: string[];

function makeNewImage(seed: number, bytes = 128, width = 256, height = 256): NewImage {
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
    seed,
    width,
    height,
    prompt: `prompt-${seed}`,
    characterPrompts: [],
    createdAt: 1_700_000_000_000 + seed,
  };
}

function Harness({ options }: { options?: UseImagesOptions }) {
  store = useImages(options);
  return null;
}

const renderHook = async (options?: UseImagesOptions) => {
  await act(async () => {
    root.render(
      <StrictMode>
        <Harness options={options} />
      </StrictMode>,
    );
  });
};

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
  urlSeq = 0;
  createdUrls = [];
  revokedUrls = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:img-${++urlSeq}`;
    createdUrls.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revokedUrls.push(url);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  restoreDialog?.();
  vi.restoreAllMocks();
});

it('revokes each Object URL exactly once on remove and clear under StrictMode', async () => {
  await renderHook();

  await act(async () => {
    store.add([makeNewImage(1), makeNewImage(2), makeNewImage(3)]);
  });
  expect(store.images).toHaveLength(3);
  expect(revokedUrls).toEqual([]);

  const firstId = store.images[0]!.id;
  const firstUrl = store.images[0]!.url;
  await act(async () => {
    store.remove(firstId);
  });
  expect(store.images).toHaveLength(2);
  expect(revokedUrls).toEqual([firstUrl]);

  const remainingUrls = store.images.map((img) => img.url);
  await act(async () => {
    store.clear();
  });
  expect(store.images).toHaveLength(0);
  expect(revokedUrls).toEqual([firstUrl, ...remainingUrls]);
});

it('evicts downloaded unpinned image before older undownloaded image, and keeps eviction notice until dismissed', async () => {
  const onEvict = vi.fn();
  await renderHook({
    limits: { maxCount: 2, maxBytes: 1000 },
    onEvict,
  });

  await act(async () => {
    store.add([makeNewImage(1)]);
  });
  await act(async () => {
    store.add([makeNewImage(2)]);
  });
  const olderUrl = store.images.find((img) => img.seed === 1)!.url;
  const newer = store.images.find((img) => img.seed === 2)!;
  await act(async () => {
    store.markDownloaded(newer.id);
  });

  // Adding seed 3 exceeds maxCount=2; downloaded image (seed 2) is evicted before undownloaded seed 1
  await act(async () => {
    store.add([makeNewImage(3)]);
  });
  expect(store.images.map((img) => img.seed)).toEqual([3, 1]);
  expect(revokedUrls).toEqual([newer.url]);
  expect(onEvict).toHaveBeenCalledWith(1);
  expect(store.evictedCount).toBe(1);

  // Adding seed 4 evicts oldest remaining (seed 1) and accumulates evictedCount
  await act(async () => {
    store.add([makeNewImage(4)]);
  });
  expect(store.images.map((img) => img.seed)).toEqual([4, 3]);
  expect(revokedUrls).toEqual([newer.url, olderUrl]);
  expect(onEvict).toHaveBeenLastCalledWith(1);
  expect(store.evictedCount).toBe(2);

  await act(async () => {
    store.dismissEviction();
  });
  expect(store.evictedCount).toBe(0);
});

it('keeps beforeunload protection even after markDownloaded until all images are removed', async () => {
  const addListener = vi.spyOn(window, 'addEventListener');
  const removeListener = vi.spyOn(window, 'removeEventListener');
  await renderHook();

  expect(addListener.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0);

  await act(async () => {
    store.add([makeNewImage(1)]);
  });
  expect(addListener.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);

  const id = store.images[0]!.id;
  await act(async () => {
    store.markDownloaded(id);
  });
  expect(removeListener.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0);

  await act(async () => {
    store.clear();
  });
  expect(removeListener.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
});

it('reuses existing image.url on Gallery download without confirmation dialog, renders thumbUrl for older thumbnails, and shows eviction notice', async () => {
  const onDownloaded = vi.fn();
  const onDismissEviction = vi.fn();
  const images = [
    {
      ...makeNewImage(2, 128, 1024, 1024),
      id: 'new-2',
      url: 'blob:full-2',
      thumbUrl: 'blob:thumb-2',
      downloaded: false,
      pinned: false,
    },
    {
      ...makeNewImage(1, 128, 1024, 1024),
      id: 'old-1',
      url: 'blob:full-1',
      thumbUrl: 'blob:thumb-1',
      downloaded: false,
      pinned: false,
    },
  ];

  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  await act(async () => {
    root.render(
      <DialogProvider>
        <Gallery
          images={images}
          generating={false}
          pendingSize={{ width: 1024, height: 1024 }}
          evictedCount={2}
          onDismissEviction={onDismissEviction}
          onRemove={vi.fn()}
          onClear={vi.fn()}
          onUseSeed={vi.fn()}
          onDownloaded={onDownloaded}
          onTogglePin={vi.fn()}
          onReadPng={vi.fn()}
        />
      </DialogProvider>,
    );
  });

  const notice = container.querySelector('.notice');
  expect(notice?.textContent).toContain('古い画像 2枚を削除しました');
  const dismiss = notice?.querySelector('button');
  expect(dismiss).toBeInstanceOf(HTMLButtonElement);
  await act(async () => {
    if (dismiss instanceof HTMLButtonElement) dismiss.click();
  });
  expect(onDismissEviction).toHaveBeenCalledOnce();

  const imgs = Array.from(container.querySelectorAll('.thumb img')).map((el) => el.getAttribute('src'));
  expect(imgs).toEqual(['blob:full-2', 'blob:thumb-1']);

  const downloadBtn = container.querySelector('.thumb-download') as HTMLButtonElement;
  await act(async () => {
    downloadBtn.click();
  });

  expect(createdUrls).toEqual([]);
  expect(anchorClick).toHaveBeenCalledOnce();
  expect(container.querySelector('dialog[open]')).toBeNull();
  expect(onDownloaded).toHaveBeenCalledWith('new-2');
});

it('keeps a pinned image when a newer unpinned image would otherwise be the one retained', async () => {
  await renderHook({ limits: { maxCount: 2, maxBytes: 1000 } });
  await act(async () => {
    store.add([makeNewImage(1)]);
  });
  const pinnedId = store.images[0]!.id;
  await act(async () => {
    store.togglePinned(pinnedId);
  });
  expect(store.images[0]!.pinned).toBe(true);
  await act(async () => {
    store.add([makeNewImage(2)]);
  });
  await act(async () => {
    store.add([makeNewImage(3)]);
  });
  expect(store.images.map((img) => img.seed)).toEqual([3, 1]);
  expect(store.images.find((img) => img.seed === 1)!.pinned).toBe(true);
});

it('keeps a new image when the history is already full of pinned images', async () => {
  await renderHook({ limits: { maxCount: 2, maxBytes: 1000 } });
  await act(async () => {
    store.add([makeNewImage(1)]);
  });
  await act(async () => {
    store.togglePinned(store.images[0]!.id);
  });
  await act(async () => {
    store.add([makeNewImage(2)]);
  });
  await act(async () => {
    store.togglePinned(store.images[0]!.id);
  });
  await act(async () => {
    store.add([makeNewImage(3)]);
  });
  expect(store.images.map((img) => img.seed)).toEqual([3, 2]);
  expect(store.images.find((img) => img.seed === 3)!.pinned).toBe(false);
  expect(store.images.find((img) => img.seed === 2)!.pinned).toBe(true);
});
