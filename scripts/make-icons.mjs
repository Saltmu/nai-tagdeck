// アプリアイコン（PNG）を生成する。依存なし: node scripts/make-icons.mjs
// 図柄: 採用ロゴ02のチェックタグ。紫背景・白いタグ・紫のチェック。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [79, 70, 229];
const TAG = [255, 255, 255];

function colorAt(x, y) {
  // Map to the header mark's 48 × 48 grid, at 80% scale for maskable safe area.
  const px = ((x - 0.5) / 0.8) * 48 + 24;
  const py = ((y - 0.5) / 0.8) * 48 + 24;
  // Same outline as public/brand/icon.svg: M7 9h21l14 15-14 15H7Z.
  if (px < 7 || py < 9 || py > 39 || px > 42 - (14 / 15) * Math.abs(py - 24)) return BG;
  if (Math.hypot(px - 13, py - 24) <= 3) return BG;
  // Same rounded check: m22 24 5 5 8-10, stroke width 3.
  if (Math.min(distToSegment(px, py, 22, 24, 27, 29), distToSegment(px, py, 27, 29, 35, 19)) <= 1.5) return BG;
  return TAG;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

function render(size) {
  const SS = 4; // 4×4 のスーパーサンプリングでアンチエイリアス
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // フィルタなし
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          for (let k = 0; k < 3; k++) acc[k] += c[k];
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(acc[k] / (SS * SS));
      raw[o + 3] = 255;
    }
  }
  return png(size, size, raw);
}

function png(width, height, raw) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

mkdirSync('public/icons', { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
]) {
  writeFileSync(`public/icons/${name}`, render(size));
  console.log(`public/icons/${name}`);
}
