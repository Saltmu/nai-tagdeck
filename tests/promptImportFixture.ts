/// <reference types="node" />
import { deflateSync } from 'node:zlib';

// The gallery V5 sample stored Software, Source and Comment in tEXt chunks.
const IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII=', 'base64');

function chunk(type: string, data: Uint8Array): Buffer {
  const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

export function pngFixture(
  comment?: Record<string, unknown> | string,
  options: { origin?: boolean; commentType?: 'tEXt' | 'zTXt' | 'iTXt' } = {},
): Uint8Array<ArrayBuffer> {
  const text = (key: string, value: string) => chunk('tEXt', Buffer.from(`${key}\0${value}`, 'latin1'));
  const metadata = options.origin === false ? [] : [
    text('Software', 'NovelAI'),
    text('Source', 'NovelAI Diffusion V5 0ADF9AB7'),
  ];
  if (comment !== undefined) {
    const json = typeof comment === 'string' ? comment : JSON.stringify(comment);
    if (options.commentType === 'zTXt') {
      metadata.push(chunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0'), deflateSync(Buffer.from(json, 'latin1'))])));
    } else if (options.commentType === 'iTXt') {
      metadata.push(chunk('iTXt', Buffer.concat([Buffer.from('Comment\0\x01\0\0\0'), deflateSync(Buffer.from(json))])));
    } else metadata.push(text('Comment', json));
  }
  return new Uint8Array(Buffer.concat([IMAGE.subarray(0, 33), ...metadata, IMAGE.subarray(33)]));
}

export function caption(base: string, chars: string[] = []) {
  return {
    use_coords: false,
    caption: { base_caption: base, char_captions: chars.map((char_caption) => ({ char_caption, centers: [{ x: 0, y: 0 }] })) },
  };
}
