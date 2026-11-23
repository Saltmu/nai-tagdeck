import { MAX_TEXT_BYTES, TEXT_KEYS, type PngMetadata, uncompress, utf8 } from './pngShared';

const MAGIC_COMP = 'stealth_pngcomp';
const MAGIC_INFO = 'stealth_pnginfo';
const MAGIC_BYTES = 15;
const LENGTH_BYTES = 4;
export const MIN_STEALTH_PIXELS = (MAGIC_BYTES + LENGTH_BYTES) * 8;
export const MAX_STEALTH_PIXELS = 33_554_432;

function createByteReader(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number) {
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

/** RGBA ピクセル配列から NovelAI 互換の Stealth PNG メタデータを抽出する。 */
export async function extractStealthMetadata(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<PngMetadata | undefined> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    throw new Error('Stealth PNG のピクセルデータが不正です');
  }
  const totalBits = width * height;
  if (totalBits < MIN_STEALTH_PIXELS) return undefined;

  const readBytes = createByteReader(rgba, width, height);
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

async function decodeImageBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  } catch {
    return await createImageBitmap(blob);
  }
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
    if (width <= 0 || height <= 0 || width * height > MAX_STEALTH_PIXELS || width * height < MIN_STEALTH_PIXELS) {
      return undefined;
    }
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);
    return await extractStealthMetadata(data, width, height);
  } finally {
    bitmap?.close?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
