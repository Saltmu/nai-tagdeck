// @vitest-environment jsdom
import { unzlibSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeMaskStrokes,
  binarizeMaskRgba,
  canRedoMask,
  canUndoMask,
  clearMaskHistory,
  createInpaintMaskBase64,
  emptyMaskHistory,
  encodeBinaryMaskPngBytes,
  INPAINT_MASK_BLOCK_SIZE,
  InpaintImageError,
  isMaskEmpty,
  normalizeBrushRadius,
  normalizeInpaintStrength,
  normalizeMaskOpacity,
  prepareInpaintSource,
  pushMaskStroke,
  rasterizeMaskBlocks,
  redoMask,
  resolveInpaintSize,
  undoMask,
} from '../src/lib/inpaint';
import { isValidFreeSize } from '../src/lib/novelai';
import { MAX_REFERENCE_IMAGE_BYTES } from '../src/lib/referenceImage';

const PNG_HEADER_512 = (() => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 512, false);
  view.setUint32(20, 512, false);
  return bytes;
})();

function decodePngChunks(png: Uint8Array) {
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatParts: Uint8Array[] = [];

  while (pos < png.length) {
    const length = view.getUint32(pos, false);
    const type = String.fromCharCode(png[pos + 4]!, png[pos + 5]!, png[pos + 6]!, png[pos + 7]!);
    const data = png.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(0, false);
      height = dv.getUint32(4, false);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === 'IDAT') {
      idatParts.push(data);
    }
    pos += 12 + length;
  }

  const totalLen = idatParts.reduce((sum, p) => sum + p.length, 0);
  const idat = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of idatParts) {
    idat.set(part, offset);
    offset += part.length;
  }
  const raw = unzlibSync(idat);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const stride = 1 + width * 4;
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0);
    rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * width * 4);
  }
  return { width, height, bitDepth, colorType, rgba };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveInpaintSize', () => {
  it('既に無料枠内の 64 の倍数寸法はリサイズせずそのまま維持する', () => {
    expect(resolveInpaintSize(832, 1216)).toEqual({
      width: 832,
      height: 1216,
      originalWidth: 832,
      originalHeight: 1216,
      resized: false,
    });
    expect(resolveInpaintSize(1024, 1024)).toEqual({
      width: 1024,
      height: 1024,
      originalWidth: 1024,
      originalHeight: 1024,
      resized: false,
    });
    expect(resolveInpaintSize(512, 512).resized).toBe(false);
  });

  it('非 64 倍数や 1024×1024 超の画像は無料枠へ自動フィットする', () => {
    const oversized = resolveInpaintSize(1200, 900);
    expect(oversized.resized).toBe(true);
    expect(oversized.originalWidth).toBe(1200);
    expect(oversized.originalHeight).toBe(900);
    expect(isValidFreeSize(oversized.width, oversized.height)).toBe(true);

    const nonMultiple = resolveInpaintSize(500, 700);
    expect(nonMultiple.resized).toBe(true);
    expect(nonMultiple.width % 64).toBe(0);
    expect(nonMultiple.height % 64).toBe(0);
    expect(isValidFreeSize(nonMultiple.width, nonMultiple.height)).toBe(true);

    const huge = resolveInpaintSize(3000, 2000);
    expect(huge.resized).toBe(true);
    expect(isValidFreeSize(huge.width, huge.height)).toBe(true);

    // 長辺が 2048px を超える画像でも正方形へ潰れず縦横比（約 2:1 / 1:2）を保つ
    const wide4k = resolveInpaintSize(4096, 2048);
    expect(wide4k.resized).toBe(true);
    expect(isValidFreeSize(wide4k.width, wide4k.height)).toBe(true);
    expect(wide4k.width / wide4k.height).toBeGreaterThan(1.8);
    expect(wide4k.width / wide4k.height).toBeLessThan(2.2);

    const tall4k = resolveInpaintSize(2048, 4096);
    expect(tall4k.resized).toBe(true);
    expect(isValidFreeSize(tall4k.width, tall4k.height)).toBe(true);
    expect(tall4k.height / tall4k.width).toBeGreaterThan(1.8);
    expect(tall4k.height / tall4k.width).toBeLessThan(2.2);
  });
});

describe('マスクストローク履歴・消しゴム・Undo/Redo・全消去・空マスク判定', () => {
  const W = 128;
  const H = 128;

  it('ストローク追加・消しゴム・Undo / Redo・全消去と空マスク判定が正しく動作する', () => {
    let history = emptyMaskHistory();
    expect(isMaskEmpty(history, W, H)).toBe(true);
    expect(canUndoMask(history)).toBe(false);
    expect(canRedoMask(history)).toBe(false);

    // ブラシで描く -> 空ではなくなる
    history = pushMaskStroke(history, {
      tool: 'brush',
      radius: 16,
      points: [
        { x: 32, y: 32 },
        { x: 64, y: 32 },
      ],
    });
    expect(isMaskEmpty(history, W, H)).toBe(false);
    expect(canUndoMask(history)).toBe(true);
    expect(canRedoMask(history)).toBe(false);

    // 消しゴムで同じ範囲を完全に消す -> 空マスクと判定される
    history = pushMaskStroke(history, {
      tool: 'eraser',
      radius: 20,
      points: [
        { x: 32, y: 32 },
        { x: 64, y: 32 },
      ],
    });
    expect(isMaskEmpty(history, W, H)).toBe(true);

    // Undo で消しゴムを戻す -> ブラシが復活する
    history = undoMask(history);
    expect(isMaskEmpty(history, W, H)).toBe(false);
    expect(canRedoMask(history)).toBe(true);

    // Redo で再び消しゴムを適用
    history = redoMask(history);
    expect(isMaskEmpty(history, W, H)).toBe(true);

    // Undo してから新しいストロークを描くと Redo 履歴が切り捨てられる
    history = undoMask(history);
    history = pushMaskStroke(history, {
      tool: 'brush',
      radius: 8,
      points: [{ x: 100, y: 100 }],
    });
    expect(canRedoMask(history)).toBe(false);
    expect(activeMaskStrokes(history)).toHaveLength(2);

    // 全消去 -> 空になり、さらに Undo で全消去を取り消せる
    history = clearMaskHistory(history);
    expect(isMaskEmpty(history, W, H)).toBe(true);
    expect(activeMaskStrokes(history)).toHaveLength(0);
    // 既に空の状態で全消去しても履歴は増えない
    expect(clearMaskHistory(history)).toBe(history);

    history = undoMask(history);
    expect(isMaskEmpty(history, W, H)).toBe(false);
    expect(activeMaskStrokes(history)).toHaveLength(2);
  });

  it('空の点列や非正の半径は無視する', () => {
    const h = emptyMaskHistory();
    expect(pushMaskStroke(h, { tool: 'brush', radius: 10, points: [] })).toBe(h);
    expect(pushMaskStroke(h, { tool: 'brush', radius: 0, points: [{ x: 10, y: 10 }] })).toBe(h);
  });
});

describe('2 値マスク生成と PNG エンコード（#172 準拠）', () => {
  it('binarizeMaskRgba は半透明・中間グレーを残さず 8×8 区画ごとに純白 #FFFFFF / 純黒 #000000 へ 2 値化する', () => {
    const w = 16;
    const h = 16;
    const src = new Uint8ClampedArray(w * h * 4);
    // 左上 8×8 区画にアンチエイリアス相当のグレー画素 (140, 140, 140, 200) を 1 つ置く
    const idxA = (2 * w + 3) * 4;
    src[idxA] = 140;
    src[idxA + 1] = 140;
    src[idxA + 2] = 140;
    src[idxA + 3] = 200;
    // 右上 8×8 区画にはしきい値未満の薄いゴミ (100, 100, 100, 80) を置く -> 黒になるべき
    const idxB = (1 * w + 10) * 4;
    src[idxB] = 100;
    src[idxB + 1] = 100;
    src[idxB + 2] = 100;
    src[idxB + 3] = 80;

    const out = binarizeMaskRgba(src, w, h, INPAINT_MASK_BLOCK_SIZE);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const expected = x < 8 && y < 8 ? 255 : 0;
        expect([out[i], out[i + 1], out[i + 2], out[i + 3]]).toEqual([expected, expected, expected, 255]);
      }
    }
  });

  it('encodeBinaryMaskPngBytes / createInpaintMaskBase64 は 8bit RGBA・全 8×8 区画均一な純白／純黒 PNG を生成する', () => {
    const w = 64;
    const h = 64;
    const strokes = [
      {
        tool: 'brush' as const,
        radius: 12,
        points: [
          { x: 16, y: 16 },
          { x: 48, y: 40 },
        ],
      },
      {
        tool: 'eraser' as const,
        radius: 6,
        points: [{ x: 32, y: 28 }],
      },
    ];

    const png = encodeBinaryMaskPngBytes(strokes, w, h);
    const base64 = createInpaintMaskBase64(strokes, w, h);
    expect(base64.startsWith('data:')).toBe(false);
    expect(() => atob(base64)).not.toThrow();

    const decoded = decodePngChunks(png);
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    expect(decoded.bitDepth).toBe(8);
    expect(decoded.colorType).toBe(6);

    const grid = rasterizeMaskBlocks(strokes, w, h, INPAINT_MASK_BLOCK_SIZE);
    let whiteCount = 0;
    let blackCount = 0;

    // すべての 8×8 区画で画素値が完全一致し、純白 #FFFFFFFF または純黒 #000000FF のみ
    for (let by = 0; by < h / 8; by++) {
      for (let bx = 0; bx < w / 8; bx++) {
        const expected = grid.blocks[by * grid.cols + bx] === 1 ? 255 : 0;
        for (let dy = 0; dy < 8; dy++) {
          for (let dx = 0; dx < 8; dx++) {
            const x = bx * 8 + dx;
            const y = by * 8 + dy;
            const i = (y * w + x) * 4;
            expect([decoded.rgba[i], decoded.rgba[i + 1], decoded.rgba[i + 2], decoded.rgba[i + 3]]).toEqual([
              expected,
              expected,
              expected,
              255,
            ]);
            if (expected === 255) whiteCount++;
            else blackCount++;
          }
        }
      }
    }
    expect(whiteCount).toBeGreaterThan(0);
    expect(blackCount).toBeGreaterThan(0);
    expect(whiteCount + blackCount).toBe(w * h);
  });
});

describe('prepareInpaintSource と数値正規化', () => {
  it('無料枠外の画像を自動フィットして描画し、無料枠内 PNG は寸法を維持する', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 512, height: 512, close })));
    const keep = await prepareInpaintSource(new Blob([PNG_HEADER_512], { type: 'image/png' }));
    expect(keep.width).toBe(512);
    expect(keep.height).toBe(512);
    expect(keep.resized).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);

    const closeLarge = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1200, height: 900, close: closeLarge })));
    const drawImage = vi.fn();
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage }) as unknown as CanvasRenderingContext2D),
      toBlob: vi.fn((cb: BlobCallback) => cb(new Blob([PNG_HEADER_512], { type: 'image/png' }))),
      toDataURL: vi.fn(() => 'data:image/png;base64,iVBORw0KGgo='),
    };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? (fakeCanvas as unknown as HTMLCanvasElement) : origCreate(tag),
    );
    const resized = await prepareInpaintSource(new Blob([PNG_HEADER_512], { type: 'image/png' }));
    expect(resized.resized).toBe(true);
    expect(resized.originalWidth).toBe(1200);
    expect(resized.originalHeight).toBe(900);
    expect(isValidFreeSize(resized.width, resized.height)).toBe(true);
    expect(fakeCanvas.width).toBe(resized.width);
    expect(fakeCanvas.height).toBe(resized.height);
    expect(drawImage).toHaveBeenCalled();
    expect(closeLarge).toHaveBeenCalledTimes(1);
  });

  it('空ファイル・非画像・サイズ超過・破損画像を拒否する', async () => {
    await expect(prepareInpaintSource(new Blob([], { type: 'image/png' }))).rejects.toThrow(InpaintImageError);
    await expect(prepareInpaintSource(new Blob(['not-an-image'], { type: 'image/png' }))).rejects.toThrow(
      'PNG / JPEG / WebP',
    );
    const fakeLarge = { size: MAX_REFERENCE_IMAGE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as Blob;
    await expect(prepareInpaintSource(fakeLarge)).rejects.toThrow('20MB');
    expect(fakeLarge.arrayBuffer).not.toHaveBeenCalled();

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('corrupt');
      }),
    );
    await expect(prepareInpaintSource(new Blob([PNG_HEADER_512], { type: 'image/png' }))).rejects.toThrow(
      '壊れているか',
    );
  });

  it('強度・ブラシ半径・不透明度を規定範囲へ丸める', () => {
    expect(normalizeInpaintStrength(0)).toBe(0.01);
    expect(normalizeInpaintStrength(1.5)).toBe(1);
    expect(normalizeInpaintStrength(0.424)).toBe(0.42);
    expect(normalizeInpaintStrength(NaN)).toBe(1);

    expect(normalizeBrushRadius(1)).toBe(4);
    expect(normalizeBrushRadius(999)).toBe(160);
    expect(normalizeBrushRadius(24.4)).toBe(24);

    expect(normalizeMaskOpacity(0)).toBe(0.15);
    expect(normalizeMaskOpacity(1)).toBe(0.9);
    expect(normalizeMaskOpacity(0.52)).toBe(0.5);
  });
});
