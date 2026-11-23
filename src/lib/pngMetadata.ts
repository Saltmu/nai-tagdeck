import { MAX_TEXT_BYTES, TEXT_KEYS, type PngMetadata, type TextKey, uncompress, utf8 } from './pngShared';
import { MAX_STEALTH_PIXELS, MIN_STEALTH_PIXELS, readStealthPngMetadata } from './stealthPng';

export type { PngMetadata, TextKey };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface IhdrInfo {
  width: number;
  height: number;
  colorType: number;
}

function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return text;
}

function separator(bytes: Uint8Array, start = 0): number {
  const index = bytes.indexOf(0, start);
  if (index < 0) throw new Error('PNG のテキストチャンクが壊れています');
  return index;
}

async function decodeText(type: string, data: Uint8Array<ArrayBuffer>, start: number): Promise<string> {
  const compressed = type === 'zTXt' || (type === 'iTXt' && data[start] === 1);
  if (type !== 'tEXt') {
    const method = type === 'zTXt' ? start : start + 1;
    if (data[method] !== 0 || (type === 'iTXt' && data[start] !== 0 && data[start] !== 1)) {
      throw new Error('PNG のテキストチャンクの圧縮方式が不明です');
    }
    start = method + 1;
    if (type === 'iTXt') start = separator(data, separator(data, start) + 1) + 1;
  }
  const payload = data.subarray(start);
  const bytes = compressed ? await uncompress(payload, 'deflate') : payload;
  if (type === 'iTXt') return utf8.decode(bytes);
  return latin1(bytes);
}

function hasAlphaChannel(ihdr: IhdrInfo | undefined, hasTrns: boolean): ihdr is IhdrInfo {
  if (!ihdr || ihdr.width <= 0 || ihdr.height <= 0) return false;
  return ihdr.colorType === 4 || ihdr.colorType === 6 || hasTrns;
}

function stripChunkRanges(blob: Blob, ranges: ReadonlyArray<readonly [number, number]>): Blob {
  const parts: Blob[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(blob.slice(cursor, start));
    cursor = end;
  }
  if (cursor < blob.size) parts.push(blob.slice(cursor));
  return new Blob(parts, { type: blob.type || 'image/png' });
}

export async function readPngMetadata(blob: Blob): Promise<PngMetadata> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) throw new Error('PNG 画像を選んでください');

  const view = new DataView(buffer);
  const metadata: PngMetadata = {};
  let ihdr: IhdrInfo | undefined;
  let hasTrns = false;
  const exifRanges: Array<[number, number]> = [];

  for (let offset = PNG_SIGNATURE.length; offset + 12 <= bytes.length;) {
    const chunkStart = offset;
    const length = view.getUint32(offset);
    const start = offset + 8;
    const end = start + length;
    if (length > 0x7fffffff || end + 4 > bytes.length) break;
    const type = latin1(bytes.subarray(offset + 4, start));
    offset = end + 4;

    if (type === 'IHDR' && !ihdr && length === 13) {
      ihdr = {
        width: view.getUint32(start),
        height: view.getUint32(start + 4),
        colorType: bytes[start + 9]!,
      };
      continue;
    }
    if (type === 'tRNS') {
      hasTrns = true;
      continue;
    }
    if (type === 'eXIf') {
      exifRanges.push([chunkStart, offset]);
      continue;
    }
    if (type === 'IEND' && length === 0) {
      if (metadata.Comment !== undefined) return metadata;
      if (hasAlphaChannel(ihdr, hasTrns)) {
        const pixels = ihdr.width * ihdr.height;
        if (pixels > MAX_STEALTH_PIXELS) {
          throw new Error('画像サイズが大きすぎるため、Stealth PNG のメタデータを読み取れません');
        }
        if (pixels >= MIN_STEALTH_PIXELS) {
          const decodeBlob = exifRanges.length > 0 ? stripChunkRanges(blob, exifRanges) : blob;
          const stealth = await readStealthPngMetadata(decodeBlob);
          if (stealth) return { ...metadata, ...stealth };
        }
      }
      return metadata;
    }
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') continue;

    const data = bytes.subarray(start, end);
    const keyEnd = separator(data.subarray(0, 80));
    const key = TEXT_KEYS.find((candidate) => candidate === latin1(data.subarray(0, keyEnd)));
    if (!key) continue;
    if (length > MAX_TEXT_BYTES) throw new Error('PNG のメタデータが大きすぎます');
    try {
      metadata[key] = await decodeText(type, data, keyEnd + 1);
    } catch (error) {
      throw new Error('PNG のテキストメタデータを展開できませんでした', { cause: error });
    }
  }
  throw new Error('PNG のチャンクが途中で切れています');
}
