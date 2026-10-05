// アプリアイコン（PNG）を生成する。依存なし: node scripts/make-icons.mjs
// 図柄: 紫の背景に、チェックボックスとタグの行が並んだカード（「タグを ON/OFF する」を表す）。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [79, 70, 229];
const CARD_BACK = [165, 160, 255];
const CARD = [255, 255, 255];
const ACCENT = [79, 70, 229];
const MUTED = [205, 208, 222];

/** 角丸長方形の符号付き距離（内側が負）。座標は 0〜1 の正規化。 */
function roundRect(x, y, cx, cy, w, h, r) {
  const qx = Math.abs(x - cx) - w / 2 + r;
  const qy = Math.abs(y - cy) - h / 2 + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function colorAt(x, y) {
  let c = BG;
  if (roundRect(x, y, 0.55, 0.45, 0.5, 0.56, 0.06) < 0) c = CARD_BACK;
  if (roundRect(x, y, 0.47, 0.54, 0.5, 0.56, 0.06) < 0) {
    c = CARD;
    const rows = [0.39, 0.54, 0.69];
    rows.forEach((ry, i) => {
      const on = i !== 1; // 2行目だけ OFF
      if (roundRect(x, y, 0.3, ry, 0.08, 0.08, 0.015) < 0) c = on ? ACCENT : MUTED;
      // チェックマーク（ON の行だけ）
      if (on) {
        const d1 = distToSegment(x, y, 0.28, ry, 0.295, ry + 0.017);
        const d2 = distToSegment(x, y, 0.295, ry + 0.017, 0.322, ry - 0.02);
        if (Math.min(d1, d2) < 0.008) c = CARD;
      }
      if (roundRect(x, y, 0.5, ry, 0.24, 0.04, 0.02) < 0) c = on ? ACCENT : MUTED;
    });
  }
  return c;
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
