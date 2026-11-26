// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bytesToBase64,
  chooseReferenceCanvasSize,
  MAX_REFERENCE_IMAGE_BYTES,
  normalizeReferenceStrength,
  prepareReferenceImageBase64,
  ReferenceImageError,
  validateReferenceImageBlob,
} from '../src/lib/referenceImage';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('validateReferenceImageBlob', () => {
  it('PNG / JPEG / WebP を受け入れ、元データから独立した Blob を返す', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 512, height: 768, close })),
    );

    const png = await validateReferenceImageBlob(new Blob([PNG_BYTES], { type: '' }));
    const jpeg = await validateReferenceImageBlob(new Blob([JPEG_BYTES], { type: 'application/octet-stream' }));
    const webp = await validateReferenceImageBlob(new Blob([WEBP_BYTES], { type: 'image/webp' }));

    expect(png.type).toBe('image/png');
    expect(jpeg.type).toBe('image/jpeg');
    expect(webp.type).toBe('image/webp');
    expect(close).toHaveBeenCalledTimes(3);
  });

  it('非画像・GIF・空ファイル・サイズ超過を拒否する', async () => {
    await expect(validateReferenceImageBlob(new Blob([], { type: 'image/png' }))).rejects.toThrow(ReferenceImageError);
    await expect(validateReferenceImageBlob(new Blob(['hello'], { type: 'image/png' }))).rejects.toThrow(
      'PNG / JPEG / WebP',
    );
    await expect(validateReferenceImageBlob(new Blob([GIF_BYTES], { type: 'image/gif' }))).rejects.toThrow(
      ReferenceImageError,
    );

    const fakeLargeBlob = {
      size: MAX_REFERENCE_IMAGE_BYTES + 1,
      arrayBuffer: vi.fn(),
    } as unknown as Blob;
    await expect(validateReferenceImageBlob(fakeLargeBlob)).rejects.toThrow('20MB');
    expect(fakeLargeBlob.arrayBuffer).not.toHaveBeenCalled();
  });

  it('デコードできない破損画像や巨大解像度を拒否する', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode failed');
      }),
    );
    await expect(validateReferenceImageBlob(new Blob([PNG_BYTES], { type: 'image/png' }))).rejects.toThrow(
      '壊れているか',
    );

    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 10000, height: 10000, close })),
    );
    await expect(validateReferenceImageBlob(new Blob([PNG_BYTES], { type: 'image/png' }))).rejects.toThrow(
      '8192px',
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('chooseReferenceCanvasSize', () => {
  it('#172 の実測サイズと標準サイズに合う 64 の倍数キャンバスを選ぶ', () => {
    expect(chooseReferenceCanvasSize(256, 192)).toEqual({ width: 1152, height: 896 });
    expect(chooseReferenceCanvasSize(192, 256)).toEqual({ width: 896, height: 1152 });
    expect(chooseReferenceCanvasSize(192, 192)).toEqual({ width: 1024, height: 1024 });
    expect(chooseReferenceCanvasSize(832, 1216)).toEqual({ width: 832, height: 1216 });

    const wide = chooseReferenceCanvasSize(4000, 200);
    expect(wide.width % 64).toBe(0);
    expect(wide.height % 64).toBe(0);
    expect(wide.width * wide.height).toBeLessThanOrEqual(1024 * 1024);
  });
});

describe('prepareReferenceImageBase64', () => {
  it('黒背景で中央フィット描画し、data URL 接頭辞なしの raw base64 を返す', async () => {
    const close = vi.fn();
    const bitmap = { width: 256, height: 192, close };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));

    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const ctx = {
      fillStyle: '',
      fillRect,
      drawImage,
    } as unknown as CanvasRenderingContext2D;

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((cb: BlobCallback) => cb(new Blob([PNG_BYTES], { type: 'image/png' }))),
      toDataURL: vi.fn(() => `data:image/png;base64,${bytesToBase64(PNG_BYTES)}`),
    };
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? (fakeCanvas as unknown as HTMLCanvasElement) : origCreateElement(tag),
    );

    const base64 = await prepareReferenceImageBase64(new Blob([PNG_BYTES], { type: 'image/png' }));

    expect(fakeCanvas.width).toBe(1152);
    expect(fakeCanvas.height).toBe(896);
    expect(ctx.fillStyle).toBe('#000000');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1152, 896);
    // 256×192 → 1152×864（高さ 896 に対して上下 16px の黒パディング）
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 16, 1152, 864);
    expect(close).toHaveBeenCalledTimes(1);
    expect(base64).toBe(bytesToBase64(PNG_BYTES));
    expect(base64.startsWith('data:')).toBe(false);
    expect(() => atob(base64)).not.toThrow();
  });

  it('toBlob が null を返した場合は toDataURL へフォールバックし接頭辞を除去する', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 192, height: 192, close })));
    const ctx = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const expected = bytesToBase64(PNG_BYTES);
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((cb: BlobCallback) => cb(null)),
      toDataURL: vi.fn(() => `data:image/png;base64,${expected}`),
    };
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? (fakeCanvas as unknown as HTMLCanvasElement) : origCreateElement(tag),
    );

    const base64 = await prepareReferenceImageBase64(new Blob([PNG_BYTES], { type: 'image/png' }));
    expect(base64).toBe(expected);
    expect(base64.startsWith('data:')).toBe(false);
  });
});

describe('normalizeReferenceStrength', () => {
  it('0.1〜5.0 の範囲に収め、0.05 刻みに丸める', () => {
    expect(normalizeReferenceStrength(1)).toBe(1);
    expect(normalizeReferenceStrength(0)).toBe(0.1);
    expect(normalizeReferenceStrength(10)).toBe(5);
    expect(normalizeReferenceStrength(1.23)).toBe(1.25);
    expect(normalizeReferenceStrength(NaN)).toBe(1);
  });
});
