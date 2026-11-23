// @vitest-environment jsdom
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPngMetadata } from '../src/lib/pngMetadata';
import { MAX_TEXT_BYTES } from '../src/lib/pngShared';
import { readPromptImport } from '../src/lib/promptImport';
import { MAX_STEALTH_PIXELS, extractStealthMetadata, readStealthPngMetadata } from '../src/lib/stealthPng';
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

function stubCanvasAndBitmap(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: { rejectWithOptions?: boolean } = {},
) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  const createBitmap = vi.fn(async (_blob: Blob, init?: ImageBitmapOptions) => {
    if (options.rejectWithOptions && init) throw new TypeError('unsupported options');
    return bitmap;
  });
  vi.stubGlobal('createImageBitmap', createBitmap);

  const drawImage = vi.fn();
  const getImageData = vi.fn(() => ({ data: rgba, width, height, colorSpace: 'srgb' as const }));
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage, getImageData })),
  };
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName === 'canvas') return canvas as unknown as HTMLCanvasElement;
    return originalCreateElement(tagName);
  }) as typeof document.createElement);

  return { createBitmap, close, drawImage, getImageData, canvas };
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

  it('falls back to createImageBitmap without options and cleans up bitmap and canvas', async () => {
    const payload = Buffer.from(JSON.stringify({ Software: 'NovelAI', Comment: '{"prompt":"a"}' }));
    const rgba = encodeStealthRgba(40, 40, 'stealth_pnginfo', payload);
    const { createBitmap, close, canvas } = stubCanvasAndBitmap(rgba, 40, 40, { rejectWithOptions: true });

    const metadata = await readStealthPngMetadata(new Blob([new Uint8Array(0)], { type: 'image/png' }));
    expect(metadata).toEqual({ Software: 'NovelAI', Comment: '{"prompt":"a"}' });
    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(createBitmap.mock.calls[0]?.[1]).toEqual({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    expect(createBitmap.mock.calls[1]?.[1]).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('skips pixel decoding when Comment text chunk exists, alpha is absent, or dimensions exceed limit', async () => {
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
    await expect(readPromptImport(new Blob([tooLarge]), [])).rejects.toThrow('NovelAI の生成情報が見つかりませんでした');
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
