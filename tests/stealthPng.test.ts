// @vitest-environment jsdom
import { deflateSync, gzipSync, inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPngMetadata } from '../src/lib/pngMetadata';
import { MAX_TEXT_BYTES, uncompress } from '../src/lib/pngShared';
import { readPromptImport } from '../src/lib/promptImport';
import {
  MAX_STEALTH_PIXELS,
  MAX_STEALTH_TILE_DIM,
  MAX_STEALTH_TILE_PIXELS,
  extractStealthMetadata,
  readStealthPngMetadata,
} from '../src/lib/stealthPng';
import { caption, pngFixture } from './promptImportFixture';

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12);
  new DataView(result.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) result[4 + i] = type.charCodeAt(i);
  result.set(data, 8);
  return result;
}

function makePng(options: {
  width: number;
  height: number;
  colorType: number;
  extraChunks?: Uint8Array[];
}): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, options.width);
  view.setUint32(4, options.height);
  ihdr[8] = 8;
  ihdr[9] = options.colorType;
  const parts = [
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    ...(options.extraChunks ?? []),
    makeChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeStealthRgba(
  width: number,
  height: number,
  magic: string,
  payload: Uint8Array,
  bitLengthOverride?: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 120;
    rgba[i + 1] = 140;
    rgba[i + 2] = 160;
    rgba[i + 3] = 254;
  }
  const header = new Uint8Array(19);
  for (let i = 0; i < 15; i++) header[i] = magic.charCodeAt(i);
  new DataView(header.buffer).setUint32(15, bitLengthOverride ?? payload.length * 8);

  const stream = new Uint8Array(header.length + payload.length);
  stream.set(header, 0);
  stream.set(payload, header.length);

  let x = 0;
  let y = 0;
  for (const byte of stream) {
    for (let bit = 7; bit >= 0; bit--) {
      if (x >= width) break;
      const idx = (y * width + x) * 4 + 3;
      rgba[idx] = 254 | ((byte >> bit) & 1);
      y += 1;
      if (y === height) {
        y = 0;
        x += 1;
      }
    }
  }
  return rgba;
}

function makeRgbaPngWithExif(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Uint8Array<ArrayBuffer> {
  const rawScanlines = new Uint8Array(height * (1 + width * 4));
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    rawScanlines[y * (1 + rowBytes)] = 0;
    rawScanlines.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), y * (1 + rowBytes) + 1);
  }
  const idat = makeChunk('IDAT', deflateSync(rawScanlines));
  // Minimal TIFF/EXIF header specifying Orientation = 6 (90 deg CW).
  const exif = makeChunk('eXIf', Uint8Array.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]));
  return makePng({ width, height, colorType: 6, extraChunks: [exif, idat] });
}

function decodeRgbaFromPng(pngBytes: Uint8Array, applyExifRotation: boolean) {
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let width = 0;
  let height = 0;
  let hasExif = false;
  const idatChunks: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= pngBytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...pngBytes.subarray(offset + 4, offset + 8));
    const data = pngBytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
    } else if (type === 'eXIf') {
      hasExif = true;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    }
    offset += 12 + length;
  }
  const scanlines = inflateSync(Buffer.concat(idatChunks));
  const rowBytes = width * 4;
  const raw = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    raw.set(scanlines.subarray(y * (1 + rowBytes) + 1, (y + 1) * (1 + rowBytes)), y * rowBytes);
  }
  if (!applyExifRotation || !hasExif) return { width, height, rgba: raw };
  // Rotate 90 deg CW (Orientation = 6) to simulate browser EXIF orientation when imageOrientation !== 'none'.
  const rotated = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const nx = height - 1 - y;
      const ny = x;
      const dst = (ny * height + nx) * 4;
      rotated.set(raw.subarray(src, src + 4), dst);
    }
  }
  return { width: height, height: width, rgba: rotated };
}

function sliceRgbaRect(
  rgba: Uint8ClampedArray,
  imageWidth: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let row = 0; row < sh; row++) {
    const srcStart = ((sy + row) * imageWidth + sx) * 4;
    out.set(rgba.subarray(srcStart, srcStart + sw * 4), row * sw * 4);
  }
  return out;
}

function stubCanvasAndBitmap(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: { rejectOptionCount?: number } = {},
) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  let calls = 0;
  const createBitmap = vi.fn(async (_blob: Blob, _init?: ImageBitmapOptions) => {
    calls += 1;
    if (options.rejectOptionCount && calls <= options.rejectOptionCount) {
      throw new TypeError('unsupported options');
    }
    return bitmap;
  });
  vi.stubGlobal('createImageBitmap', createBitmap);

  let currentTile = new Uint8ClampedArray(0);
  const clearRect = vi.fn();
  const drawImage = vi.fn((_img: ImageBitmap, sx = 0, sy = 0, sw = width, sh = height) => {
    currentTile = sliceRgbaRect(rgba, width, sx, sy, sw, sh);
  });
  const getImageData = vi.fn((_x: number, _y: number, sw: number, sh: number) => ({
    data: currentTile,
    width: sw,
    height: sh,
    colorSpace: 'srgb' as const,
  }));
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ clearRect, drawImage, getImageData })),
  };
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName === 'canvas') return canvas as unknown as HTMLCanvasElement;
    return originalCreateElement(tagName);
  }) as typeof document.createElement);

  return { createBitmap, close, clearRect, drawImage, getImageData, canvas };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Stealth PNG decoding', () => {
  it('extracts gzip-compressed stealth_pngcomp metadata in column-major MSB order', async () => {
    const comment = JSON.stringify({
      v4_prompt: caption('masterpiece, 1.2::sakura::', ['girl']),
      v4_negative_prompt: caption('lowres', ['bad hands']),
      seed: 98765,
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5.5,
      sampler: 'k_euler_ancestral',
      noise_schedule: 'karras',
    });
    const payload = gzipSync(Buffer.from(JSON.stringify({
      Title: 'AI generated image',
      Software: 'NovelAI',
      Source: 'NovelAI Diffusion V5 0ADF9AB7',
      Comment: comment,
    })));
    const width = 40;
    const height = 80;
    const rgba = encodeStealthRgba(width, height, 'stealth_pngcomp', payload);

    const metadata = await extractStealthMetadata(rgba, width, height);
    expect(metadata).toEqual({
      Software: 'NovelAI',
      Source: 'NovelAI Diffusion V5 0ADF9AB7',
      Comment: comment,
    });
  });

  it('extracts uncompressed stealth_pnginfo metadata including UTF-8 text', async () => {
    const comment = JSON.stringify({ prompt: '蓮の花, sakura' });
    const payload = Buffer.from(JSON.stringify({
      Software: 'NovelAI',
      Comment: comment,
    }), 'utf8');
    const rgba = encodeStealthRgba(50, 40, 'stealth_pnginfo', payload);

    const metadata = await extractStealthMetadata(rgba, 50, 40);
    expect(metadata).toEqual({ Software: 'NovelAI', Comment: comment });
  });

  it('returns undefined when no supported stealth magic is present', async () => {
    const plain = new Uint8ClampedArray(20 * 20 * 4).fill(255);
    expect(await extractStealthMetadata(plain, 20, 20)).toBeUndefined();

    const rgbMode = encodeStealthRgba(20, 20, 'stealth_rgbcomp', Buffer.from('{}'));
    expect(await extractStealthMetadata(rgbMode, 20, 20)).toBeUndefined();

    const tiny = new Uint8ClampedArray(10 * 10 * 4).fill(255);
    expect(await extractStealthMetadata(tiny, 10, 10)).toBeUndefined();
  });

  it('rejects invalid bit lengths, oversized headers, gzip bombs and corrupt payloads', async () => {
    const zeroLen = encodeStealthRgba(20, 20, 'stealth_pnginfo', new Uint8Array(0), 0);
    await expect(extractStealthMetadata(zeroLen, 20, 20)).rejects.toThrow('壊れています');

    const nonByteAligned = encodeStealthRgba(20, 20, 'stealth_pnginfo', new Uint8Array([0]), 9);
    await expect(extractStealthMetadata(nonByteAligned, 20, 20)).rejects.toThrow('壊れています');

    const exceedsImage = encodeStealthRgba(20, 20, 'stealth_pnginfo', new Uint8Array([0]), 400);
    await expect(extractStealthMetadata(exceedsImage, 20, 20)).rejects.toThrow('壊れています');

    const exceedsMax = encodeStealthRgba(20, 20, 'stealth_pnginfo', new Uint8Array([0]), (MAX_TEXT_BYTES + 1) * 8);
    await expect(extractStealthMetadata(exceedsMax, 20, 20)).rejects.toThrow('大きすぎます');

    const bomb = gzipSync(Buffer.alloc(MAX_TEXT_BYTES + 1024, 0x20));
    expect(bomb.length).toBeLessThan(MAX_TEXT_BYTES);
    const bombWidth = 200;
    const bombHeight = Math.ceil((19 + bomb.length) * 8 / bombWidth) + 1;
    const bombRgba = encodeStealthRgba(bombWidth, bombHeight, 'stealth_pngcomp', bomb);
    await expect(extractStealthMetadata(bombRgba, bombWidth, bombHeight)).rejects.toThrow('大きすぎます');

    const corruptGzip = encodeStealthRgba(30, 30, 'stealth_pngcomp', Uint8Array.from([1, 2, 3, 4]));
    await expect(extractStealthMetadata(corruptGzip, 30, 30)).rejects.toThrow('展開できませんでした');

    const invalidUtf8 = encodeStealthRgba(30, 30, 'stealth_pnginfo', Uint8Array.from([0xff, 0xfe]));
    await expect(extractStealthMetadata(invalidUtf8, 30, 30)).rejects.toThrow('UTF-8');

    const invalidJson = encodeStealthRgba(30, 30, 'stealth_pnginfo', Buffer.from('{'));
    await expect(extractStealthMetadata(invalidJson, 30, 30)).rejects.toThrow('JSON');

    const nonObject = encodeStealthRgba(30, 30, 'stealth_pnginfo', Buffer.from('[]'));
    await expect(extractStealthMetadata(nonObject, 30, 30)).rejects.toThrow('形式');

    await expect(extractStealthMetadata(new Uint8ClampedArray(4), 2, 2)).rejects.toThrow('ピクセルデータ');
  });

  it('feeds bounded chunks during decompression and aborts before reading the whole bomb', async () => {
    // 4 MiB with periodic pseudo-random bytes produces >100 KiB of gzip data so feeding stops early.
    const huge = Buffer.alloc(4 * 1024 * 1024, 0x20);
    for (let pos = 0; pos < huge.length; pos += 8) {
      huge[pos] = ((pos * 2654435761) >>> 24) & 0xff;
    }
    const compressed = new Uint8Array(gzipSync(huge));
    expect(compressed.length).toBeGreaterThan(64 * 1024);
    const subarraySpy = vi.spyOn(compressed, 'subarray');

    await expect(uncompress(compressed, 'gzip')).rejects.toThrow('大きすぎます');
    const chunkSizes = subarraySpy.mock.calls.map(([start = 0, end = compressed.length]) => end - start);
    expect(chunkSizes.every((len) => len <= 512)).toBe(true);
    const pulledBytes = chunkSizes.reduce((sum, len) => sum + len, 0);
    expect(pulledBytes).toBeLessThan(compressed.length);
  });

  it('falls back to imageOrientation:none then no-options createImageBitmap and cleans up bitmap and canvas', async () => {
    const payload = Buffer.from(JSON.stringify({ Software: 'NovelAI', Comment: '{"prompt":"a"}' }));
    const rgba = encodeStealthRgba(40, 40, 'stealth_pnginfo', payload);
    const { createBitmap, close, canvas } = stubCanvasAndBitmap(rgba, 40, 40, { rejectOptionCount: 1 });

    const metadata = await readStealthPngMetadata(new Blob([new Uint8Array(0)], { type: 'image/png' }));
    expect(metadata).toEqual({ Software: 'NovelAI', Comment: '{"prompt":"a"}' });
    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(createBitmap.mock.calls[0]?.[1]).toEqual({
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
      imageOrientation: 'none',
    });
    expect(createBitmap.mock.calls[1]?.[1]).toEqual({ imageOrientation: 'none' });
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);

    const fallback = stubCanvasAndBitmap(rgba, 40, 40, { rejectOptionCount: 2 });
    const metadata2 = await readStealthPngMetadata(new Blob([new Uint8Array(0)], { type: 'image/png' }));
    expect(metadata2).toEqual({ Software: 'NovelAI', Comment: '{"prompt":"a"}' });
    expect(fallback.createBitmap).toHaveBeenCalledTimes(3);
    expect(fallback.createBitmap.mock.calls[2]?.[1]).toBeUndefined();

    const decodeFailure = vi.fn(async () => {
      throw new DOMException('The source image could not be decoded.', 'EncodingError');
    });
    vi.stubGlobal('createImageBitmap', decodeFailure);
    await expect(readStealthPngMetadata(new Blob([new Uint8Array(0)], { type: 'image/png' })))
      .rejects.toThrow('PNG の画像データを展開できませんでした');
    expect(decodeFailure).toHaveBeenCalledTimes(1);
  });

  it('strips eXIf chunks via blob.slice so browsers without imageOrientation:none support keep stored pixel order', async () => {
    const stealthJson = JSON.stringify({
      Software: 'NovelAI',
      Comment: JSON.stringify({ prompt: 'exif safe tag' }),
    });
    const width = 40;
    const height = 60;
    const rgba = encodeStealthRgba(width, height, 'stealth_pngcomp', gzipSync(Buffer.from(stealthJson)));
    const realPng = makeRgbaPngWithExif(width, height, rgba);

    const close = vi.fn();
    let decoded!: ReturnType<typeof decodeRgbaFromPng>;
    // Simulate a browser that ignores imageOrientation: 'none' whenever an eXIf chunk is present.
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      decoded = decodeRgbaFromPng(bytes, true);
      return { width: decoded.width, height: decoded.height, close } as unknown as ImageBitmap;
    }));
    let currentTile = new Uint8ClampedArray(0);
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            clearRect: vi.fn(),
            drawImage: (_img: ImageBitmap, sx: number, sy: number, sw: number, sh: number) => {
              currentTile = sliceRgbaRect(decoded.rgba, decoded.width, sx, sy, sw, sh);
            },
            getImageData: (_x: number, _y: number, sw: number, sh: number) => ({
              data: currentTile,
              width: sw,
              height: sh,
            }),
          }),
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const pngBlob = new Blob([realPng], { type: 'image/png' });
    const sliceSpy = vi.spyOn(pngBlob, 'slice');
    const imported = await readPromptImport(pngBlob, []);
    expect(sliceSpy).toHaveBeenCalled();
    expect(imported.base.unclassified.map((t) => t.tag)).toEqual(['exif safe tag']);
    expect(close).toHaveBeenCalledOnce();
  });

  it('reads large and tall Stealth PNGs in bounded canvas tiles without exceeding browser canvas limits', async () => {
    const stealthJson = JSON.stringify({
      Software: 'NovelAI',
      Comment: JSON.stringify({ prompt: 'tiled tag' }),
    });
    const payload = gzipSync(Buffer.from(stealthJson));

    // Case 1: Tall image (> MAX_STEALTH_TILE_DIM) spanning multiple vertical tiles and column wraps.
    const tallWidth = 20;
    const tallHeight = MAX_STEALTH_TILE_DIM + 200;
    const tallPayload = Buffer.from(JSON.stringify({
      Software: 'NovelAI',
      Comment: JSON.stringify({ prompt: `tiled tag, ${'extra_tag '.repeat(60)}` }),
    }));
    expect((19 + tallPayload.length) * 8).toBeGreaterThan(tallHeight);
    const tallRgba = encodeStealthRgba(tallWidth, tallHeight, 'stealth_pnginfo', tallPayload);
    const tallStub = stubCanvasAndBitmap(tallRgba, tallWidth, tallHeight);
    const tallPng = makePng({ width: tallWidth, height: tallHeight, colorType: 6 });

    const tallImported = await readPromptImport(new Blob([tallPng], { type: 'image/png' }), []);
    expect(tallImported.base.unclassified[0]?.tag).toBe('tiled tag');
    expect(tallStub.drawImage.mock.calls.length).toBeGreaterThan(1);
    for (const [, , , sw, sh] of tallStub.drawImage.mock.calls) {
      expect(sw).toBeLessThanOrEqual(MAX_STEALTH_TILE_DIM);
      expect(sh).toBeLessThanOrEqual(MAX_STEALTH_TILE_DIM);
      expect(sw * sh).toBeLessThanOrEqual(MAX_STEALTH_TILE_PIXELS);
    }

    // Case 2: 4800 x 4000 (>16.7M iOS canvas limit, <= MAX_STEALTH_PIXELS) via column-strip tiles.
    const largeWidth = 4800;
    const largeHeight = 4000;
    const headerBytes = new Uint8Array(19 + payload.length);
    for (let i = 0; i < 15; i++) headerBytes[i] = 'stealth_pngcomp'.charCodeAt(i);
    new DataView(headerBytes.buffer).setUint32(15, payload.length * 8);
    headerBytes.set(payload, 19);

    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: largeWidth, height: largeHeight, close } as unknown as ImageBitmap)));
    let tilePixels = new Uint8ClampedArray(0);
    const tileSizes: Array<[number, number]> = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            clearRect: vi.fn(),
            drawImage: (_img: ImageBitmap, sx: number, sy: number, sw: number, sh: number) => {
              tileSizes.push([sw, sh]);
              tilePixels = new Uint8ClampedArray(sw * sh * 4);
              for (let row = 0; row < sh; row++) {
                const y = sy + row;
                for (let col = 0; col < sw; col++) {
                  const x = sx + col;
                  const bitIdx = x * largeHeight + y;
                  const byteIdx = Math.floor(bitIdx / 8);
                  const bitInByte = 7 - (bitIdx % 8);
                  const lsb = byteIdx < headerBytes.length ? (headerBytes[byteIdx]! >> bitInByte) & 1 : 0;
                  tilePixels[(row * sw + col) * 4 + 3] = 254 | lsb;
                }
              }
            },
            getImageData: (_x: number, _y: number, sw: number, sh: number) => ({ data: tilePixels, width: sw, height: sh }),
          }),
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const largePng = makePng({ width: largeWidth, height: largeHeight, colorType: 6 });
    const largeImported = await readPromptImport(new Blob([largePng], { type: 'image/png' }), []);
    expect(largeImported.base.unclassified.map((t) => t.tag)).toEqual(['tiled tag']);
    expect(tileSizes.length).toBeGreaterThanOrEqual(1);
    for (const [sw, sh] of tileSizes) {
      expect(sw * sh).toBeLessThanOrEqual(MAX_STEALTH_TILE_PIXELS);
      expect(sw).toBeLessThanOrEqual(MAX_STEALTH_TILE_DIM);
      expect(sh).toBeLessThanOrEqual(MAX_STEALTH_TILE_DIM);
    }
  });

  it('skips pixel decoding when Comment text chunk exists or alpha is absent, and reports pixel-limit errors explicitly', async () => {
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);

    const normalBytes = pngFixture({ prompt: 'standing' });
    expect((await readPngMetadata(new Blob([normalBytes]))).Comment).toBeDefined();
    expect(createBitmap).not.toHaveBeenCalled();

    const grayNoAlpha = makePng({ width: 40, height: 40, colorType: 0 });
    await expect(readPromptImport(new Blob([grayNoAlpha]), [])).rejects.toThrow('NovelAI の生成情報が見つかりませんでした');
    expect(createBitmap).not.toHaveBeenCalled();

    const rgbNoAlpha = makePng({ width: 40, height: 40, colorType: 2 });
    await expect(readPromptImport(new Blob([rgbNoAlpha]), [])).rejects.toThrow('NovelAI の生成情報が見つかりませんでした');
    expect(createBitmap).not.toHaveBeenCalled();

    const tooLarge = makePng({ width: 8000, height: Math.ceil(MAX_STEALTH_PIXELS / 8000) + 1, colorType: 6 });
    await expect(readPromptImport(new Blob([tooLarge]), [])).rejects.toThrow('画像サイズが大きすぎるため');
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it('integrates stealth_pngcomp and stealth_pnginfo with readPromptImport', async () => {
    const positive = caption('fur dataset, blazer, 1.2::custom tag::', ['red hair, standing']);
    positive.use_coords = true;
    positive.caption.char_captions[0]!.centers = [{ x: 0.25, y: 0.5 }];
    const negative = caption('lowres', ['blurry']);
    negative.caption.char_captions[0]!.centers = [{ x: 0.25, y: 0.5 }];
    const commentObj = {
      v4_prompt: positive,
      v4_negative_prompt: negative,
      seed: 4242,
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5,
      sampler: 'k_euler_ancestral',
      noise_schedule: 'karras',
    };
    const stealthJson = JSON.stringify({
      Software: 'NovelAI',
      Source: 'NovelAI Diffusion V5 0ADF9AB7',
      Comment: JSON.stringify(commentObj),
    });

    for (const [magic, payload] of [
      ['stealth_pngcomp', gzipSync(Buffer.from(stealthJson))],
      ['stealth_pnginfo', Buffer.from(stealthJson)],
    ] as const) {
      const width = 120;
      const height = 100;
      const rgba = encodeStealthRgba(width, height, magic, payload);
      const { close } = stubCanvasAndBitmap(rgba, width, height);
      const pngBytes = makePng({ width, height, colorType: 6 });

      const imported = await readPromptImport(new Blob([pngBytes], { type: 'image/png' }), []);
      expect(close).toHaveBeenCalledOnce();
      expect(imported.furDataset).toBe('fur dataset');
      expect(imported.base.unclassified.map((t) => [t.tag, t.weight])).toEqual([
        ['blazer', 1],
        ['custom tag', 1.2],
      ]);
      expect(imported.characters).toHaveLength(1);
      expect(imported.characters[0]?.tags.unclassified.map((t) => t.tag)).toEqual(['red hair', 'standing']);
      expect(imported.characters[0]?.center).toEqual({ x: 0.25, y: 0.5 });
      expect(imported.negative?.map((t) => t.tag)).toEqual(['lowres']);
      expect(imported.characterNegative).toBe('blurry');
      expect(imported.generation.values).toEqual({
        mode: 'furry',
        seed: 4242,
        size: 'portrait',
        steps: 28,
        scale: 5,
        sampler: 'k_euler_ancestral',
        noiseSchedule: 'karras',
      });
    }
  });

  it('rejects stealth metadata that lacks a Comment field via readPromptImport', async () => {
    const payload = Buffer.from(JSON.stringify({ Software: 'NovelAI' }));
    const rgba = encodeStealthRgba(30, 30, 'stealth_pnginfo', payload);
    stubCanvasAndBitmap(rgba, 30, 30);
    const pngBytes = makePng({ width: 30, height: 30, colorType: 6 });

    await expect(readPromptImport(new Blob([pngBytes]), [])).rejects.toThrow('NovelAI の生成情報が見つかりませんでした');
  });

  it('also checks tRNS-equipped palette PNGs when Comment text chunk is missing', async () => {
    const payload = Buffer.from(JSON.stringify({ Software: 'NovelAI', Comment: JSON.stringify({ prompt: 'palette tag' }) }));
    const rgba = encodeStealthRgba(40, 40, 'stealth_pnginfo', payload);
    stubCanvasAndBitmap(rgba, 40, 40);
    const pngBytes = makePng({
      width: 40,
      height: 40,
      colorType: 3,
      extraChunks: [makeChunk('tRNS', Uint8Array.from([254, 255]))],
    });

    const imported = await readPromptImport(new Blob([pngBytes]), []);
    expect(imported.base.unclassified.map((t) => t.tag)).toEqual(['palette tag']);
  });
});
