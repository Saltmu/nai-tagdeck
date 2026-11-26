// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyImageRetention, createThumbnailUrl, summarizeImageHistory } from '../src/lib/imageHistory';

function makeItem(id: string, bytes: number, downloaded = false, pinned = false) {
  return {
    id,
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
    downloaded,
    pinned,
  };
}

describe('applyImageRetention', () => {
  it('retains all images within count and byte limits', () => {
    const items = [makeItem('a', 100), makeItem('b', 100)];
    const res = applyImageRetention(items, { maxCount: 2, maxBytes: 200 });
    expect(res.retained.map((x) => x.id)).toEqual(['a', 'b']);
    expect(res.evicted).toEqual([]);
    expect(res.evictedUndownloadedCount).toBe(0);
  });

  it('prioritizes evicting oldest downloaded images over undownloaded ones', () => {
    // newest: n1, then u1 (undownloaded), d1 (downloaded), u2 (oldest, undownloaded)
    const items = [
      makeItem('n1', 100, false),
      makeItem('u1', 100, false),
      makeItem('d1', 100, true),
      makeItem('u2', 100, false),
    ];
    const res = applyImageRetention(items, { maxCount: 3, maxBytes: 1000 });
    expect(res.retained.map((x) => x.id)).toEqual(['n1', 'u1', 'u2']);
    expect(res.evicted.map((x) => x.id)).toEqual(['d1']);
    expect(res.evictedUndownloadedCount).toBe(0);
  });

  it('evicts oldest downloaded image first when multiple downloaded images exist', () => {
    const items = [
      makeItem('n1', 100, false),
      makeItem('d1', 100, true),
      makeItem('d2', 100, true),
      makeItem('u1', 100, false),
    ];
    const res = applyImageRetention(items, { maxCount: 3, maxBytes: 1000 });
    expect(res.retained.map((x) => x.id)).toEqual(['n1', 'd1', 'u1']);
    expect(res.evicted.map((x) => x.id)).toEqual(['d2']);
  });

  it('evicts oldest undownloaded images when byte limit is exceeded and no downloaded images remain', () => {
    const items = [
      makeItem('n1', 60, false),
      makeItem('u1', 60, false),
      makeItem('u2', 60, false),
    ];
    const res = applyImageRetention(items, { maxCount: 10, maxBytes: 120 });
    expect(res.retained.map((x) => x.id)).toEqual(['n1', 'u1']);
    expect(res.evicted.map((x) => x.id)).toEqual(['u2']);
    expect(res.evictedUndownloadedCount).toBe(1);
  });

  it('keeps a pinned image and evicts an older unpinned image first', () => {
    const items = [
      makeItem('n1', 100, false, false),
      makeItem('p1', 100, false, true),
      makeItem('u1', 100, false, false),
    ];
    const res = applyImageRetention(items, { maxCount: 2, maxBytes: 1000 });
    expect(res.retained.map((x) => x.id)).toEqual(['n1', 'p1']);
    expect(res.evicted.map((x) => x.id)).toEqual(['u1']);
  });

  it('keeps a pinned image even when it is older and downloaded, and evicts the unpinned image', () => {
    const items = [
      makeItem('n1', 100, false, false),
      makeItem('p1', 100, true, true),
    ];
    const res = applyImageRetention(items, { maxCount: 1, maxBytes: 1000 });
    expect(res.retained.map((x) => x.id)).toEqual(['p1']);
    expect(res.evicted.map((x) => x.id)).toEqual(['n1']);
  });

  it('keeps a newly added image and evicts the oldest pinned image when the rest are pinned', () => {
    const items = [
      makeItem('new', 100, false, false),
      makeItem('p1', 100, false, true),
      makeItem('p2', 100, false, true),
      makeItem('p3', 100, false, true),
    ];
    const res = applyImageRetention(items, { maxCount: 3, maxBytes: 1000 }, 1);
    expect(res.retained.map((x) => x.id)).toEqual(['new', 'p1', 'p2']);
    expect(res.evicted.map((x) => x.id)).toEqual(['p3']);
  });

  it('evicts oldest pinned images when every image is pinned', () => {
    const items = [
      makeItem('p1', 100, false, true),
      makeItem('p2', 100, false, true),
      makeItem('p3', 100, false, true),
    ];
    const res = applyImageRetention(items, { maxCount: 2, maxBytes: 1000 });
    expect(res.retained.map((x) => x.id)).toEqual(['p1', 'p2']);
    expect(res.evicted.map((x) => x.id)).toEqual(['p3']);
  });

  it('evicts a downloaded pinned image before other pinned images when none are unpinned', () => {
    const items = [
      makeItem('p1', 100, false, true),
      makeItem('d1', 100, true, true),
      makeItem('p3', 100, false, true),
    ];
    const res = applyImageRetention(items, { maxCount: 2, maxBytes: 1000 });
    expect(res.retained.map((x) => x.id)).toEqual(['p1', 'p3']);
    expect(res.evicted.map((x) => x.id)).toEqual(['d1']);
  });

  it('evicts unpinned images for the byte limit before a pinned image', () => {
    const items = [
      makeItem('n1', 70, false, false),
      makeItem('p1', 70, false, true),
      makeItem('u1', 70, false, false),
    ];
    const res = applyImageRetention(items, { maxCount: 10, maxBytes: 100 });
    expect(res.retained.map((x) => x.id)).toEqual(['p1']);
    expect(res.evicted.map((x) => x.id)).toEqual(['u1', 'n1']);
  });

  it('keeps at least one image even if a single image exceeds maxBytes', () => {
    const items = [makeItem('huge', 500, false), makeItem('old', 100, true)];
    const res = applyImageRetention(items, { maxCount: 10, maxBytes: 200 });
    expect(res.retained.map((x) => x.id)).toEqual(['huge']);
    expect(res.evicted.map((x) => x.id)).toEqual(['old']);
  });
});

describe('createThumbnailUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null when image fits within maxEdge', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    expect(await createThumbnailUrl(blob, 512, 512, 512)).toBeNull();
  });

  it('returns null when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const blob = new Blob(['png'], { type: 'image/png' });
    expect(await createThumbnailUrl(blob, 1024, 1536, 512)).toBeNull();
  });

  it('scales down large images via canvas and returns an Object URL', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close }));
    const drawImage = vi.fn();
    const getContext = vi.fn().mockReturnValue({ drawImage });
    const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['webp'], { type: 'image/webp' })));
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return { width: 0, height: 0, getContext, toBlob } as unknown as HTMLCanvasElement;
      }
      return origCreateElement(tagName);
    });
    const createUrl = vi.fn().mockReturnValue('blob:thumb-1');
    vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: vi.fn() });

    const url = await createThumbnailUrl(new Blob(['png'], { type: 'image/png' }), 1024, 1536, 512);
    expect(url).toBe('blob:thumb-1');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 341, 512);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('summarizeImageHistory', () => {
  it('returns zeroed stats for empty history', () => {
    expect(summarizeImageHistory([], { maxCount: 30, maxBytes: 80 * 1024 * 1024 })).toEqual({
      count: 0,
      totalBytes: 0,
      pinnedCount: 0,
      downloadedCount: 0,
      pinnedWidth: 0,
      unsavedWidth: 0,
      savedWidth: 0,
      isAtLimit: false,
      usedMb: '0',
      maxMb: 80,
    });
  });

  it('uses count ratio when count ratio exceeds byte ratio', () => {
    const mib = 1024 * 1024;
    const items = [
      makeItem('p', 512 * 1024, true, true),
      makeItem('u', 512 * 1024, false, false),
      makeItem('s', 512 * 1024, true, false),
    ];
    const stats = summarizeImageHistory(items, { maxCount: 10, maxBytes: 100 * mib });
    expect(stats).toEqual({
      count: 3,
      totalBytes: 1.5 * mib,
      pinnedCount: 1,
      downloadedCount: 2,
      pinnedWidth: 10,
      unsavedWidth: 10,
      savedWidth: 10,
      isAtLimit: false,
      usedMb: '1.5',
      maxMb: 100,
    });
  });

  it('uses byte ratio when byte ratio exceeds count ratio and flags limit', () => {
    const mib = 1024 * 1024;
    const items = [
      makeItem('p', 6 * mib, false, true),
      makeItem('u', 4 * mib, false, false),
      makeItem('s', 2 * mib, true, false),
    ];
    const stats = summarizeImageHistory(items, { maxCount: 30, maxBytes: 12 * mib });
    expect(stats).toEqual({
      count: 3,
      totalBytes: 12 * mib,
      pinnedCount: 1,
      downloadedCount: 1,
      pinnedWidth: 50,
      unsavedWidth: (4 / 12) * 100,
      savedWidth: (2 / 12) * 100,
      isAtLimit: true,
      usedMb: '12',
      maxMb: 12,
    });
  });
});
