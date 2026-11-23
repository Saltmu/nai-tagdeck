export const TEXT_KEYS = ['Software', 'Source', 'Comment'] as const;
export type TextKey = (typeof TEXT_KEYS)[number];
export type PngMetadata = Partial<Record<TextKey, string>>;

export const MAX_TEXT_BYTES = 1024 * 1024;
export const utf8 = new TextDecoder('utf-8', { fatal: true });

export async function uncompress(
  bytes: Uint8Array<ArrayBuffer>,
  format: 'deflate' | 'gzip' = 'deflate',
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = stream.pipeThrough(new DecompressionStream(format)).getReader();
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
