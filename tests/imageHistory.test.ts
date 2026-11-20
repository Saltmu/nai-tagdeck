// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyImageRetention, createThumbnailUrl } from '../src/lib/imageHistory';

function makeItem(id: string, bytes: number, downloaded = false) {
  return {
    id,
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
    downloaded,
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
