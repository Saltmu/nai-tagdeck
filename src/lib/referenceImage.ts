import {
  DEFAULT_PRECISE_REFERENCE_STRENGTH,
  PRECISE_REFERENCE_STRENGTH_MAX,
  PRECISE_REFERENCE_STRENGTH_MIN,
  PRECISE_REFERENCE_STRENGTH_STEP,
  sniffImageType,
  type PreciseReferenceType,
} from './novelai';

export interface PreciseReferenceItem {
  id: string;
  /** 履歴から独立した Blob（履歴削除・上限破棄の影響を受けない）。 */
  blob: Blob;
  /** このアイテム専用の Object URL。差し替え・削除・アンマウント時に必ず revoke する。 */
  previewUrl: string;
  /** 表示用ファイル名または由来ラベル（例: "生成画像（シード 12345）"）。 */
  name: string;
  type: PreciseReferenceType;
  /** 0.1〜5.0（刻み・既定値は #172 の実測に合わせる。0 は不可とし、無効化は enabled で行う）。 */
  strength: number;
  /** 画像を保持したまま通常生成（0 Anlas）へ一時切替できる ON/OFF。既定 true。 */
  enabled: boolean;
}

export const PRECISE_REFERENCE_TYPES: ReadonlyArray<{ value: PreciseReferenceType; label: string }> = [
  { value: 'character', label: 'キャラクター' },
  { value: 'style', label: 'スタイル' },
  { value: 'outfit', label: '衣装' },
];

export function referenceTypeLabel(type: PreciseReferenceType): string {
  return PRECISE_REFERENCE_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function normalizeReferenceStrength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PRECISE_REFERENCE_STRENGTH;
  const clamped = Math.min(PRECISE_REFERENCE_STRENGTH_MAX, Math.max(PRECISE_REFERENCE_STRENGTH_MIN, value));
  const steps = Math.round(clamped / PRECISE_REFERENCE_STRENGTH_STEP);
  return Math.round(steps * PRECISE_REFERENCE_STRENGTH_STEP * 100) / 100;
}

export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_DIMENSION = 8192;
export const MAX_REFERENCE_IMAGE_PIXELS = 33_554_432;

const REFERENCE_CANVAS_TARGET_PIXELS = 1024 * 1024;
const REFERENCE_CANVAS_STEP = 64;
const REFERENCE_CANVAS_MIN_SIDE = 512;
const REFERENCE_CANVAS_MAX_SIDE = 1536;

export class ReferenceImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceImageError';
  }
}

function clampSide(n: number): number {
  return Math.min(REFERENCE_CANVAS_MAX_SIDE, Math.max(REFERENCE_CANVAS_MIN_SIDE, n));
}

function roundToStep(n: number): number {
  return Math.round(n / REFERENCE_CANVAS_STEP) * REFERENCE_CANVAS_STEP;
}

/**
 * #172 で実測した V5 の参照画像キャンバス寸法（1024×1024 相当以下、64 の倍数）に合わせる。
 * 縦長 192×256 → 896×1152、横長 256×192 → 1152×896、正方形 → 1024×1024 となる。
 */
export function chooseReferenceCanvasSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1024, height: 1024 };
  }
  const ratio = width / height;
  const idealW = Math.sqrt(REFERENCE_CANVAS_TARGET_PIXELS * ratio);
  const idealH = idealW / ratio;
  let w = clampSide(roundToStep(idealW));
  let h = clampSide(roundToStep(idealH));

  while (w * h > REFERENCE_CANVAS_TARGET_PIXELS) {
    const canShrinkW = w - REFERENCE_CANVAS_STEP >= REFERENCE_CANVAS_MIN_SIDE;
    const canShrinkH = h - REFERENCE_CANVAS_STEP >= REFERENCE_CANVAS_MIN_SIDE;
    if (!canShrinkW && !canShrinkH) return { width: 1024, height: 1024 };
    if (canShrinkW && canShrinkH) {
      const errW = Math.abs((w - REFERENCE_CANVAS_STEP) / h - ratio);
      const errH = Math.abs(w / (h - REFERENCE_CANVAS_STEP) - ratio);
      if (errW <= errH) w -= REFERENCE_CANVAS_STEP;
      else h -= REFERENCE_CANVAS_STEP;
    } else if (canShrinkW) {
      w -= REFERENCE_CANVAS_STEP;
    } else {
      h -= REFERENCE_CANVAS_STEP;
    }
  }
  return { width: w, height: h };
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function readAndSniffBlob(blob: Blob): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  if (blob.size <= 0) {
    throw new ReferenceImageError('空のファイルは参照画像に使えません');
  }
  if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ReferenceImageError('画像ファイルが大きすぎます（20MB 以下にしてください）');
  }
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const mime = sniffImageType(bytes);
  if (!mime) {
    throw new ReferenceImageError('PNG / JPEG / WebP 形式の画像ファイルを選択してください');
  }
  return { bytes, mime };
}

function checkImageDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ReferenceImageError('画像を読み込めませんでした。ファイルが壊れているか、対応していない形式です');
  }
  if (
    width > MAX_REFERENCE_IMAGE_DIMENSION ||
    height > MAX_REFERENCE_IMAGE_DIMENSION ||
    width * height > MAX_REFERENCE_IMAGE_PIXELS
  ) {
    throw new ReferenceImageError('画像の解像度が大きすぎます（8192px 以下にしてください）');
  }
}

/**
 * 画像形式・破損・解像度上限を検証し、元データから独立した Blob を返す。
 */
export async function validateReferenceImageBlob(blob: Blob): Promise<Blob> {
  const { bytes, mime } = await readAndSniffBlob(blob);
  const independent = new Blob([bytes], { type: mime });

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(independent);
      checkImageDimensions(bitmap.width, bitmap.height);
    } catch (err) {
      if (err instanceof ReferenceImageError) throw err;
      throw new ReferenceImageError('画像を読み込めませんでした。ファイルが壊れているか、対応していない形式です');
    } finally {
      bitmap?.close();
    }
  }

  return independent;
}

async function decodeWithImageElement(blob: Blob): Promise<{
  source: HTMLImageElement;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new ReferenceImageError('この環境では画像の前処理を実行できません');
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new ReferenceImageError('画像を読み込めませんでした。ファイルが壊れているか、対応していない形式です'));
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

async function decodeImage(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      throw new ReferenceImageError('画像を読み込めませんでした。ファイルが壊れているか、対応していない形式です');
    }
  }
  return decodeWithImageElement(blob);
}

/**
 * 送信直前にのみ呼び出し、黒パディングでフィットさせた PNG の raw base64（data URL 接頭辞なし）を返す。
 */
export async function prepareReferenceImageBase64(blob: Blob): Promise<string> {
  const { bytes, mime } = await readAndSniffBlob(blob);
  const independent = new Blob([bytes], { type: mime });
  const decoded = await decodeImage(independent);

  try {
    checkImageDimensions(decoded.width, decoded.height);
    const target = chooseReferenceCanvasSize(decoded.width, decoded.height);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new ReferenceImageError('参照画像の変換に必要な描画領域を作成できませんでした');
    }

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, target.width, target.height);

    const scale = Math.min(target.width / decoded.width, target.height / decoded.height);
    const drawWidth = Math.max(1, Math.round(decoded.width * scale));
    const drawHeight = Math.max(1, Math.round(decoded.height * scale));
    const dx = Math.round((target.width - drawWidth) / 2);
    const dy = Math.round((target.height - drawHeight) / 2);
    ctx.drawImage(decoded.source, dx, dy, drawWidth, drawHeight);

    if (typeof canvas.toBlob === 'function') {
      const pngBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
      if (pngBlob) {
        const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
        return bytesToBase64(pngBytes);
      }
    }

    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.replace(/^data:[^,]*,/, '');
  } finally {
    decoded.cleanup();
  }
}
