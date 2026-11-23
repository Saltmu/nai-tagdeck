export const TEXT_KEYS = ['Software', 'Source', 'Comment'] as const;
export type TextKey = (typeof TEXT_KEYS)[number];
export type PngMetadata = Partial<Record<TextKey, string>>;

export const MAX_TEXT_BYTES = 1024 * 1024;
const UNCOMPRESS_CHUNK_BYTES = 512;
export const utf8 = new TextDecoder('utf-8', { fatal: true });

export async function uncompress(
  bytes: Uint8Array<ArrayBuffer>,
  format: 'deflate' | 'gzip' = 'deflate',
): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let abortedForSize = false;

  const readPromise = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_TEXT_BYTES) {
        abortedForSize = true;
        await reader.cancel().catch(() => {});
        throw new Error('PNG のメタデータが大きすぎます');
      }
      chunks.push(value);
    }
  })();
  readPromise.catch(() => {});

  try {
    for (let offset = 0; offset < bytes.length && !abortedForSize; offset += UNCOMPRESS_CHUNK_BYTES) {
      await writer.ready;
      if (abortedForSize) break;
      await writer.write(bytes.subarray(offset, Math.min(offset + UNCOMPRESS_CHUNK_BYTES, bytes.length)));
    }
    if (!abortedForSize) {
      await writer.close();
    }
    await readPromise;
  } catch (error) {
    if (abortedForSize) {
      await readPromise;
    }
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
  }

  const result = new Uint8Array(size);
  let outOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, outOffset);
    outOffset += chunk.length;
  }
  return result;
}
