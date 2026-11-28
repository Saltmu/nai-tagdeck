import { zlibSync } from 'fflate';
import { fitFreeSize, isValidFreeSize } from './generation';
import {
  DEFAULT_INPAINT_STRENGTH,
  FREE_LIMITS,
  INPAINT_STRENGTH_MAX,
  INPAINT_STRENGTH_MIN,
  INPAINT_STRENGTH_STEP,
  sniffImageType,
} from './novelai';
import {
  bytesToBase64,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_DIMENSION,
  MAX_REFERENCE_IMAGE_PIXELS,
} from './referenceImage';

/** #172 で実測した NovelAI インペイントマスクのブロック解像度（8×8 画素単位で 2 値化）。 */
export const INPAINT_MASK_BLOCK_SIZE = 8;

/** インペイント時の `add_original_image` 既定値。マスク外の画質劣化（VAE 再構成）を防ぐため既定 ON とする。 */
export const DEFAULT_INPAINT_ADD_ORIGINAL_IMAGE = true;

export const INPAINT_BRUSH_MIN = 4;
export const INPAINT_BRUSH_MAX = 160;
export const INPAINT_BRUSH_STEP = 2;
export const DEFAULT_INPAINT_BRUSH_RADIUS = 24;

export const INPAINT_MASK_OPACITY_MIN = 0.15;
export const INPAINT_MASK_OPACITY_MAX = 0.9;
export const INPAINT_MASK_OPACITY_STEP = 0.05;
export const DEFAULT_INPAINT_MASK_OPACITY = 0.55;

export type InpaintTool = 'brush' | 'eraser' | 'pan';
export type InpaintMaskColorKey = 'red' | 'blue' | 'green' | 'yellow';

/** Canvas 描画用のマスク表示色プリセット（CSS に #hex を書かないため TS 定数で管理）。 */
export const INPAINT_MASK_COLORS: ReadonlyArray<{
  key: InpaintMaskColorKey;
  label: string;
  hex: string;
}> = [
  { key: 'red', label: '赤', hex: '#ef4444' },
  { key: 'blue', label: '青', hex: '#3b82f6' },
  { key: 'green', label: '緑', hex: '#22c55e' },
  { key: 'yellow', label: '黄', hex: '#eab308' },
];

export function maskColorHex(key: InpaintMaskColorKey): string {
  return INPAINT_MASK_COLORS.find((c) => c.key === key)?.hex ?? INPAINT_MASK_COLORS[0]!.hex;
}

export class InpaintImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InpaintImageError';
  }
}

export function normalizeInpaintStrength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INPAINT_STRENGTH;
  const clamped = Math.min(INPAINT_STRENGTH_MAX, Math.max(INPAINT_STRENGTH_MIN, value));
  const steps = Math.round(clamped / INPAINT_STRENGTH_STEP);
  return Math.round(steps * INPAINT_STRENGTH_STEP * 100) / 100;
}

export function normalizeBrushRadius(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INPAINT_BRUSH_RADIUS;
  return Math.round(Math.min(INPAINT_BRUSH_MAX, Math.max(INPAINT_BRUSH_MIN, value)));
}

export function normalizeMaskOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INPAINT_MASK_OPACITY;
  const clamped = Math.min(INPAINT_MASK_OPACITY_MAX, Math.max(INPAINT_MASK_OPACITY_MIN, value));
  const steps = Math.round(clamped / INPAINT_MASK_OPACITY_STEP);
  return Math.round(steps * INPAINT_MASK_OPACITY_STEP * 100) / 100;
}

export interface InpaintSizeResult {
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resized: boolean;
}

/**
 * ベース画像の寸法を無料枠（64 の倍数・1,048,576 px 以下）へ正規化する。
 * 既に無料枠を満たす寸法はそのまま維持し、長辺が上限を超える場合も縦横比を保ったまま縮小する。
 */
export function resolveInpaintSize(naturalWidth: number, naturalHeight: number): InpaintSizeResult {
  if (isValidFreeSize(naturalWidth, naturalHeight)) {
    return {
      width: naturalWidth,
      height: naturalHeight,
      originalWidth: naturalWidth,
      originalHeight: naturalHeight,
      resized: false,
    };
  }
  let targetW = naturalWidth;
  let targetH = naturalHeight;
  if (
    Number.isFinite(naturalWidth) &&
    Number.isFinite(naturalHeight) &&
    naturalWidth > 0 &&
    naturalHeight > 0
  ) {
    const sideScale = Math.min(1, FREE_LIMITS.maxSide / naturalWidth, FREE_LIMITS.maxSide / naturalHeight);
    const pixelScale = Math.min(1, Math.sqrt(FREE_LIMITS.maxPixels / (naturalWidth * naturalHeight)));
    const scale = Math.min(sideScale, pixelScale);
    targetW = naturalWidth * scale;
    targetH = naturalHeight * scale;
  }
  const fitted = fitFreeSize(targetW, targetH);
  return {
    width: fitted.width,
    height: fitted.height,
    originalWidth: naturalWidth,
    originalHeight: naturalHeight,
    resized: fitted.width !== naturalWidth || fitted.height !== naturalHeight,
  };
}

// ---- マスクストローク履歴（Undo / Redo / 全消去） ----

export interface MaskPoint {
  x: number;
  y: number;
}

export interface MaskStroke {
  tool: 'brush' | 'eraser';
  /** 画像座標系でのブラシ半径（px）。 */
  radius: number;
  points: readonly MaskPoint[];
}

export type MaskHistoryEntry = MaskStroke | { tool: 'clear'; radius: 0; points: readonly [] };

export interface MaskHistoryState {
  entries: readonly MaskHistoryEntry[];
  /** 現在適用されている操作数（0 .. entries.length）。 */
  cursor: number;
}

export function emptyMaskHistory(): MaskHistoryState {
  return { entries: [], cursor: 0 };
}

export function activeMaskStrokes(history: MaskHistoryState): MaskStroke[] {
  const limit = Math.max(0, Math.min(history.cursor, history.entries.length));
  let start = 0;
  for (let i = limit - 1; i >= 0; i--) {
    if (history.entries[i]!.tool === 'clear') {
      start = i + 1;
      break;
    }
  }
  const strokes: MaskStroke[] = [];
  for (let i = start; i < limit; i++) {
    const entry = history.entries[i]!;
    if (entry.tool !== 'clear') strokes.push(entry);
  }
  return strokes;
}

export function canUndoMask(history: MaskHistoryState): boolean {
  return history.cursor > 0;
}

export function canRedoMask(history: MaskHistoryState): boolean {
  return history.cursor < history.entries.length;
}

export function pushMaskStroke(history: MaskHistoryState, stroke: MaskStroke): MaskHistoryState {
  if (stroke.points.length === 0 || !Number.isFinite(stroke.radius) || stroke.radius <= 0) {
    return history;
  }
  const nextEntries = history.entries.slice(0, history.cursor);
  nextEntries.push({
    tool: stroke.tool,
    radius: stroke.radius,
    points: stroke.points.map((p) => ({ x: p.x, y: p.y })),
  });
  return { entries: nextEntries, cursor: nextEntries.length };
}

export function undoMask(history: MaskHistoryState): MaskHistoryState {
  if (history.cursor <= 0) return history;
  return { entries: history.entries, cursor: history.cursor - 1 };
}

export function redoMask(history: MaskHistoryState): MaskHistoryState {
  if (history.cursor >= history.entries.length) return history;
  return { entries: history.entries, cursor: history.cursor + 1 };
}

export function clearMaskHistory(history: MaskHistoryState): MaskHistoryState {
  if (activeMaskStrokes(history).length === 0) return history;
  const nextEntries = history.entries.slice(0, history.cursor);
  nextEntries.push({ tool: 'clear', radius: 0, points: [] });
  return { entries: nextEntries, cursor: nextEntries.length };
}

// ---- 8×8 ブロック 2 値ラスタライズと PNG エンコード ----

export interface MaskBlockGrid {
  blocks: Uint8Array;
  cols: number;
  rows: number;
  blockSize: number;
}

function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const ex = px - projX;
  const ey = py - projY;
  return ex * ex + ey * ey;
}

/**
 * ストローク列を左上起点の 8×8 ブロック 2 値グリッド（0=維持、1=描き直し）へラスタライズする。
 * プレビュー描画と送信用マスク PNG の両方がこの結果を使うため、見た目と送信結果が一致する。
 */
export function rasterizeMaskBlocks(
  strokes: readonly MaskStroke[],
  width: number,
  height: number,
  blockSize = INPAINT_MASK_BLOCK_SIZE,
): MaskBlockGrid {
  const safeW = Math.max(1, Math.trunc(width));
  const safeH = Math.max(1, Math.trunc(height));
  const cols = Math.ceil(safeW / blockSize);
  const rows = Math.ceil(safeH / blockSize);
  const blocks = new Uint8Array(cols * rows);

  for (const stroke of strokes) {
    if (stroke.points.length === 0 || !Number.isFinite(stroke.radius) || stroke.radius <= 0) continue;
    const value = stroke.tool === 'brush' ? 1 : 0;
    const radius = stroke.radius;
    const radiusSq = radius * radius;
    const pts = stroke.points;
    const segCount = Math.max(1, pts.length - 1);

    for (let s = 0; s < segCount; s++) {
      const a = pts[s]!;
      const b = pts.length === 1 ? a : pts[s + 1]!;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
        continue;
      }

      const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius) / blockSize));
      const maxX = Math.min(cols - 1, Math.floor((Math.max(a.x, b.x) + radius) / blockSize));
      const minY = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius) / blockSize));
      const maxY = Math.min(rows - 1, Math.floor((Math.max(a.y, b.y) + radius) / blockSize));

      for (let by = minY; by <= maxY; by++) {
        const cy = (by + 0.5) * blockSize;
        const rowOffset = by * cols;
        for (let bx = minX; bx <= maxX; bx++) {
          const cx = (bx + 0.5) * blockSize;
          if (pointToSegmentDistSq(cx, cy, a.x, a.y, b.x, b.y) <= radiusSq) {
            blocks[rowOffset + bx] = value;
          }
        }
      }

      // 最小ブラシでもクリック地点のブロック自体は確実に塗る／消す
      for (const p of pts.length === 1 ? [a] : [a, b]) {
        if (p.x >= 0 && p.x < safeW && p.y >= 0 && p.y < safeH) {
          const bx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / blockSize)));
          const by = Math.min(rows - 1, Math.max(0, Math.floor(p.y / blockSize)));
          blocks[by * cols + bx] = value;
        }
      }
    }
  }

  return { blocks, cols, rows, blockSize };
}

export function hasPaintedMask(grid: MaskBlockGrid): boolean {
  for (let i = 0; i < grid.blocks.length; i++) {
    if (grid.blocks[i] === 1) return true;
  }
  return false;
}

export function isMaskEmpty(
  historyOrStrokes: MaskHistoryState | readonly MaskStroke[],
  width: number,
  height: number,
): boolean {
  const strokes = Array.isArray(historyOrStrokes)
    ? historyOrStrokes
    : activeMaskStrokes(historyOrStrokes as MaskHistoryState);
  if (strokes.length === 0) return true;
  return !hasPaintedMask(rasterizeMaskBlocks(strokes, width, height));
}

/**
 * 任意の RGBA 配列を 8×8 ブロック単位で純白 (#FFFFFFFF) / 純黒 (#000000FF) へ完全 2 値化する。
 * アンチエイリアス由来の中間色や半透明を残さない。
 */
export function binarizeMaskRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize = INPAINT_MASK_BLOCK_SIZE,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);

  for (let by = 0; by < rows; by++) {
    const yStart = by * blockSize;
    const yEnd = Math.min(height, yStart + blockSize);
    for (let bx = 0; bx < cols; bx++) {
      const xStart = bx * blockSize;
      const xEnd = Math.min(width, xStart + blockSize);
      let painted = false;
      outer: for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const idx = (y * width + x) * 4;
          const r = rgba[idx] ?? 0;
          const g = rgba[idx + 1] ?? 0;
          const b = rgba[idx + 2] ?? 0;
          const a = rgba[idx + 3] ?? 0;
          if (a >= 128 && (r >= 128 || g >= 128 || b >= 128)) {
            painted = true;
            break outer;
          }
        }
      }
      const c = painted ? 255 : 0;
      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const idx = (y * width + x) * 4;
          out[idx] = c;
          out[idx + 1] = c;
          out[idx + 2] = c;
          out[idx + 3] = 255;
        }
      }
    }
  }
  return out;
}

/** 2 値ブロックグリッドから純白 (#FFFFFFFF) / 純黒 (#000000FF) の RGBA 配列を生成する。 */
export function buildBinaryMaskRgba(grid: MaskBlockGrid, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const by = Math.floor(y / grid.blockSize);
    const blockRowOffset = by * grid.cols;
    const pixelRowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / grid.blockSize);
      const c = grid.blocks[blockRowOffset + bx] === 1 ? 255 : 0;
      const idx = pixelRowOffset + x * 4;
      out[idx] = c;
      out[idx + 1] = c;
      out[idx + 2] = c;
      out[idx + 3] = 255;
    }
  }
  return out;
}

// ---- PNG エンコーダー（8 bit RGBA、カラータイプ 6） ----

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(typeBytes: Uint8Array, data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < typeBytes.length; i++) {
    c = CRC_TABLE[(c ^ typeBytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(typeBytes, data), false);
  return out;
}

/**
 * ストローク列から #172 準拠の 8 bit RGBA（カラータイプ 6）・8×8 区画 2 値 PNG バイト列を生成する。
 */
export function encodeBinaryMaskPngBytes(
  historyOrStrokes: MaskHistoryState | readonly MaskStroke[],
  width: number,
  height: number,
): Uint8Array {
  const w = Math.max(1, Math.trunc(width));
  const h = Math.max(1, Math.trunc(height));
  const strokes = Array.isArray(historyOrStrokes)
    ? historyOrStrokes
    : activeMaskStrokes(historyOrStrokes as MaskHistoryState);
  const grid = rasterizeMaskBlocks(strokes, w, h, INPAINT_MASK_BLOCK_SIZE);

  const stride = 1 + w * 4;
  const raw = new Uint8Array(h * stride);
  const templateRow = new Uint8Array(stride);

  for (let by = 0; by < grid.rows; by++) {
    templateRow[0] = 0; // filter type: None
    const blockRowOffset = by * grid.cols;
    for (let x = 0; x < w; x++) {
      const bx = Math.floor(x / grid.blockSize);
      const c = grid.blocks[blockRowOffset + bx] === 1 ? 255 : 0;
      const offset = 1 + x * 4;
      templateRow[offset] = c;
      templateRow[offset + 1] = c;
      templateRow[offset + 2] = c;
      templateRow[offset + 3] = 255;
    }
    const yStart = by * grid.blockSize;
    const yEnd = Math.min(h, yStart + grid.blockSize);
    for (let y = yStart; y < yEnd; y++) {
      raw.set(templateRow, y * stride);
    }
  }

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, w, false);
  ihdrView.setUint32(4, h, false);
  ihdrData[8] = 8; // bit depth: 8
  ihdrData[9] = 6; // color type: RGBA (6)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const idatData = zlibSync(raw, { level: 6 });
  const ihdr = pngChunk('IHDR', ihdrData);
  const idat = pngChunk('IDAT', idatData);
  const iend = pngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length);
  let pos = 0;
  png.set(PNG_SIGNATURE, pos);
  pos += PNG_SIGNATURE.length;
  png.set(ihdr, pos);
  pos += ihdr.length;
  png.set(idat, pos);
  pos += idat.length;
  png.set(iend, pos);
  return png;
}

/** 2 値化済みマスク PNG の raw base64（data URL 接頭辞なし）を生成する。 */
export function createInpaintMaskBase64(
  historyOrStrokes: MaskHistoryState | readonly MaskStroke[],
  width: number,
  height: number,
): string {
  return bytesToBase64(encodeBinaryMaskPngBytes(historyOrStrokes, width, height));
}

/** プレビュー用 Canvas に 8×8 ブロック単位のマスクを描画する。 */
export function renderMaskOverlay(
  ctx: CanvasRenderingContext2D,
  strokes: readonly MaskStroke[],
  width: number,
  height: number,
  colorHex: string,
  opacity: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (strokes.length === 0) return;
  const grid = rasterizeMaskBlocks(strokes, width, height, INPAINT_MASK_BLOCK_SIZE);
  ctx.save();
  ctx.fillStyle = colorHex;
  ctx.globalAlpha = normalizeMaskOpacity(opacity);

  const bs = grid.blockSize;
  for (let by = 0; by < grid.rows; by++) {
    const rowOffset = by * grid.cols;
    const y = by * bs;
    const drawH = Math.min(bs, height - y);
    let runStart = -1;
    for (let bx = 0; bx <= grid.cols; bx++) {
      const filled = bx < grid.cols && grid.blocks[rowOffset + bx] === 1;
      if (filled && runStart === -1) {
        runStart = bx;
      } else if (!filled && runStart !== -1) {
        const x = runStart * bs;
        const drawW = Math.min(bx * bs, width) - x;
        ctx.fillRect(x, y, drawW, drawH);
        runStart = -1;
      }
    }
  }
  ctx.restore();
}

// ---- ベース画像の検証・無料枠フィット・送信用 base64 変換 ----

export interface PreparedInpaintSource extends InpaintSizeResult {
  blob: Blob;
}

function checkImageDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new InpaintImageError('画像を読み込めませんでした。ファイルが壊れているか、対応していない形式です');
  }
  if (
    width > MAX_REFERENCE_IMAGE_DIMENSION ||
    height > MAX_REFERENCE_IMAGE_DIMENSION ||
    width * height > MAX_REFERENCE_IMAGE_PIXELS
  ) {
    throw new InpaintImageError('画像の解像度が大きすぎます（8192px 以下にしてください）');
  }
}

/** PNG の IHDR チャンクから寸法を読み取る（取得できない場合は null）。 */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

async function readAndSniffBlob(blob: Blob): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  if (blob.size <= 0) {
    throw new InpaintImageError('空のファイルはインペイントに使えません');
  }
  if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new InpaintImageError('画像ファイルが大きすぎます（20MB 以下にしてください）');
  }
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const mime = sniffImageType(bytes);
  if (!mime) {
    throw new InpaintImageError('PNG / JPEG / WebP 形式の画像ファイルを選択してください');
  }
  return { bytes, mime };
}

async function decodeWithImageElement(blob: Blob): Promise<{
  source: HTMLImageElement;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new InpaintImageError('この環境では画像の読み込みを実行できません');
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new InpaintImageError('画像を読み込めませんでした。ファイルが壊れているか、対応していない形式です'));
      img.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function renderToPngBlob(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) return blob;
  }
  const dataUrl = canvas.toDataURL('image/png');
  const b64 = dataUrl.replace(/^data:[^,]*,/, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

function hasCanvas2d(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return document.createElement('canvas').getContext('2d') !== null;
  } catch {
    return false;
  }
}

/**
 * 履歴画像またはアップロード画像を検証し、無料枠サイズへ正規化した独立 Blob を返す。
 * 既に無料枠内かつ PNG であれば再スケールせずそのまま使う。
 */
export async function prepareInpaintSource(
  blob: Blob,
  fallbackSize?: { width: number; height: number },
): Promise<PreparedInpaintSource> {
  const { bytes, mime } = await readAndSniffBlob(blob);
  const independent = new Blob([bytes], { type: mime });

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(independent);
      checkImageDimensions(bitmap.width, bitmap.height);
      const size = resolveInpaintSize(bitmap.width, bitmap.height);
      let outBlob = independent;
      if (size.resized || mime !== 'image/png') {
        const rendered = await renderToPngBlob(bitmap, size.width, size.height);
        if (rendered) outBlob = rendered;
      }
      return { blob: outBlob, ...size };
    } catch (err) {
      if (err instanceof InpaintImageError) throw err;
      throw new InpaintImageError('画像を読み込めませんでした。ファイルが壊れているか、対応していない形式です');
    } finally {
      bitmap?.close();
    }
  }

  const headerSize = mime === 'image/png' ? readPngDimensions(bytes) : null;
  if (headerSize) {
    checkImageDimensions(headerSize.width, headerSize.height);
    const size = resolveInpaintSize(headerSize.width, headerSize.height);
    if (!size.resized || !hasCanvas2d()) {
      return { blob: independent, ...size };
    }
  } else if (fallbackSize && fallbackSize.width > 0 && fallbackSize.height > 0 && !hasCanvas2d()) {
    checkImageDimensions(fallbackSize.width, fallbackSize.height);
    const size = resolveInpaintSize(fallbackSize.width, fallbackSize.height);
    return { blob: independent, ...size };
  }

  const decoded = await decodeWithImageElement(independent);
  try {
    checkImageDimensions(decoded.width, decoded.height);
    const size = resolveInpaintSize(decoded.width, decoded.height);
    let outBlob = independent;
    if (size.resized || mime !== 'image/png') {
      const rendered = await renderToPngBlob(decoded.source, size.width, size.height);
      if (rendered) outBlob = rendered;
    }
    return { blob: outBlob, ...size };
  } finally {
    decoded.cleanup();
  }
}

/**
 * 送信直前にベース画像 Blob を PNG の raw base64（data URL 接頭辞なし）へ変換する。
 */
export async function prepareInpaintBaseImageBase64(
  blob: Blob,
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  const { bytes, mime } = await readAndSniffBlob(blob);
  const independent = new Blob([bytes], { type: mime });
  if (mime === 'image/png') {
    const headerSize = readPngDimensions(bytes);
    if (!headerSize || (headerSize.width === targetWidth && headerSize.height === targetHeight)) {
      return bytesToBase64(bytes);
    }
  }
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(independent);
    try {
      const pngBlob = await renderToPngBlob(bitmap, targetWidth, targetHeight);
      if (pngBlob) {
        return bytesToBase64(new Uint8Array(await pngBlob.arrayBuffer()));
      }
    } finally {
      bitmap.close();
    }
  } else if (hasCanvas2d()) {
    const decoded = await decodeWithImageElement(independent);
    try {
      const pngBlob = await renderToPngBlob(decoded.source, targetWidth, targetHeight);
      if (pngBlob) {
        return bytesToBase64(new Uint8Array(await pngBlob.arrayBuffer()));
      }
    } finally {
      decoded.cleanup();
    }
  }
  return bytesToBase64(bytes);
}
