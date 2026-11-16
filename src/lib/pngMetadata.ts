const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TEXT_KEYS = ['Software', 'Source', 'Comment'] as const;
type TextKey = (typeof TEXT_KEYS)[number];
const MAX_TEXT_BYTES = 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

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

async function uncompress(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_TEXT_BYTES) throw new Error('PNG のメタデータが大きすぎます');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
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
  const bytes = compressed ? await uncompress(payload) : payload;
  if (type === 'iTXt') return utf8.decode(bytes);
  return latin1(bytes);
}

export async function readPngMetadata(blob: Blob): Promise<Partial<Record<TextKey, string>>> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) throw new Error('PNG 画像を選んでください');

  const view = new DataView(buffer);
  const metadata: Partial<Record<TextKey, string>> = {};
  for (let offset = PNG_SIGNATURE.length; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const start = offset + 8;
    const end = start + length;
    if (length > 0x7fffffff || end + 4 > bytes.length) break;
    const type = latin1(bytes.subarray(offset + 4, start));
    offset = end + 4;
    if (type === 'IEND' && length === 0) return metadata;
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
