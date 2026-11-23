import { MAX_TEXT_BYTES, TEXT_KEYS, type PngMetadata, uncompress, utf8 } from './pngShared';

const MAGIC_COMP = 'stealth_pngcomp';
const MAGIC_INFO = 'stealth_pnginfo';
const MAGIC_BYTES = 15;
const LENGTH_BYTES = 4;
export const MIN_STEALTH_PIXELS = (MAGIC_BYTES + LENGTH_BYTES) * 8;
export const MAX_STEALTH_PIXELS = 33_554_432;
export const MAX_STEALTH_TILE_PIXELS = 1_048_576;
export const MAX_STEALTH_TILE_DIM = 4096;

type ByteReader = (count: number) => Uint8Array<ArrayBuffer>;

function createRgbaByteReader(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): ByteReader {
  let x = 0;
  let y = 0;
  const nextBit = (): number => {
    const alpha = rgba[(y * width + x) * 4 + 3]!;
    y += 1;
    if (y === height) {
      y = 0;
      x += 1;
    }
    return alpha & 1;
  };
  return (count: number): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        byte = (byte << 1) | nextBit();
      }
      out[i] = byte;
    }
    return out;
  };
}

function createCanvasByteReader(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  width: number,
  height: number,
): ByteReader {
  let x = 0;
  let y = 0;
  let tileX = -1;
  let tileY = -1;
  let tileW = 0;
  let tileH = 0;
  let tileData: Uint8ClampedArray = new Uint8ClampedArray(0);

  const loadTile = (targetX: number, targetY: number) => {
    tileH = Math.min(height - targetY, MAX_STEALTH_TILE_DIM);
    tileW = tileH === height
      ? Math.min(width - targetX, MAX_STEALTH_TILE_DIM, Math.max(1, Math.floor(MAX_STEALTH_TILE_PIXELS / tileH)))
      : 1;
    tileX = targetX;
    tileY = targetY;
    if (canvas.width !== tileW) canvas.width = tileW;
    if (canvas.height !== tileH) canvas.height = tileH;
    try {
      ctx.clearRect(0, 0, tileW, tileH);
      ctx.drawImage(bitmap, tileX, tileY, tileW, tileH, 0, 0, tileW, tileH);
      tileData = ctx.getImageData(0, 0, tileW, tileH).data;
    } catch (error) {
      throw new Error('画像サイズが大きすぎるため、Stealth PNG のメタデータを読み取れません', { cause: error });
    }
    if (tileData.length < tileW * tileH * 4) {
      throw new Error('画像サイズが大きすぎるため、Stealth PNG のメタデータを読み取れません');
    }
  };

  const nextBit = (): number => {
    if (x < tileX || x >= tileX + tileW || y < tileY || y >= tileY + tileH) {
      loadTile(x, y);
    }
    const localX = x - tileX;
    const localY = y - tileY;
    const alpha = tileData[(localY * tileW + localX) * 4 + 3]!;
    y += 1;
    if (y === height) {
      y = 0;
      x += 1;
    }
    return alpha & 1;
  };

  return (count: number): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        byte = (byte << 1) | nextBit();
      }
      out[i] = byte;
    }
    return out;
  };
}

async function decodeStealthFromReader(readBytes: ByteReader, totalBits: number): Promise<PngMetadata | undefined> {
  if (totalBits < MIN_STEALTH_PIXELS) return undefined;

  const magic = String.fromCharCode(...readBytes(MAGIC_BYTES));
  if (magic !== MAGIC_COMP && magic !== MAGIC_INFO) return undefined;

  const lengthBytes = readBytes(LENGTH_BYTES);
  const bitLength = new DataView(lengthBytes.buffer).getUint32(0);
  if (bitLength === 0 || bitLength % 8 !== 0) {
    throw new Error('Stealth PNG のメタデータが壊れています');
  }
  const byteLength = bitLength / 8;
  if (byteLength > MAX_TEXT_BYTES) {
    throw new Error('Stealth PNG のメタデータが大きすぎます');
  }
  const remainingBits = totalBits - MIN_STEALTH_PIXELS;
  if (bitLength > remainingBits) {
    throw new Error('Stealth PNG のメタデータが壊れています');
  }

  const payload = readBytes(byteLength);
  let plainBytes: Uint8Array<ArrayBuffer>;
  if (magic === MAGIC_COMP) {
    try {
      plainBytes = await uncompress(payload, 'gzip');
    } catch (error) {
      if (error instanceof Error && error.message.includes('大きすぎます')) {
        throw new Error('Stealth PNG のメタデータが大きすぎます', { cause: error });
      }
      throw new Error('Stealth PNG のメタデータを展開できませんでした', { cause: error });
    }
  } else {
    plainBytes = payload;
  }

  let text: string;
  try {
    text = utf8.decode(plainBytes);
  } catch (error) {
    throw new Error('Stealth PNG のメタデータを UTF-8 として読み取れませんでした', { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error('Stealth PNG のメタデータを JSON として読み取れませんでした', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stealth PNG のメタデータの形式を解釈できませんでした');
  }

  const record = parsed as Record<string, unknown>;
  const metadata: PngMetadata = {};
  for (const key of TEXT_KEYS) {
    const value = record[key];
    if (typeof value === 'string') metadata[key] = value;
  }
  return metadata;
}

/** RGBA ピクセル配列から NovelAI 互換の Stealth PNG メタデータを抽出する。 */
export async function extractStealthMetadata(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<PngMetadata | undefined> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    throw new Error('Stealth PNG のピクセルデータが不正です');
  }
  return decodeStealthFromReader(createRgbaByteReader(rgba, width, height), width * height);
}

const BITMAP_OPTION_VARIANTS: ReadonlyArray<ImageBitmapOptions | undefined> = [
  { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' },
  { imageOrientation: 'none' },
  undefined,
];

async function decodeImageBitmap(blob: Blob): Promise<ImageBitmap> {
  let lastError: unknown;
  for (const options of BITMAP_OPTION_VARIANTS) {
    try {
      return options ? await createImageBitmap(blob, options) : await createImageBitmap(blob);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** ブラウザの Canvas 2D を使って PNG の RGBA ピクセルを取り出し、Stealth PNG メタデータを読み取る。 */
export async function readStealthPngMetadata(blob: Blob): Promise<PngMetadata | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return undefined;

  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    try {
      bitmap = await decodeImageBitmap(blob);
    } catch (error) {
      throw new Error('PNG の画像データを展開できませんでした', { cause: error });
    }
    const { width, height } = bitmap;
    if (width <= 0 || height <= 0 || width * height < MIN_STEALTH_PIXELS) {
      return undefined;
    }
    if (width * height > MAX_STEALTH_PIXELS) {
      throw new Error('画像サイズが大きすぎるため、Stealth PNG のメタデータを読み取れません');
    }
    canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
    if (!ctx) return undefined;
    return await decodeStealthFromReader(createCanvasByteReader(canvas, ctx, bitmap, width, height), width * height);
  } finally {
    bitmap?.close?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
