export const MAX_IMAGE_HISTORY_COUNT = 30;
export const MAX_IMAGE_HISTORY_BYTES = 80 * 1024 * 1024;
export const THUMBNAIL_MAX_EDGE = 512;

export interface ImageHistoryLimits {
  maxCount: number;
  maxBytes: number;
}

export const DEFAULT_IMAGE_HISTORY_LIMITS: ImageHistoryLimits = {
  maxCount: MAX_IMAGE_HISTORY_COUNT,
  maxBytes: MAX_IMAGE_HISTORY_BYTES,
};

export interface RetainableImage {
  blob: Blob;
  downloaded: boolean;
  /** 保存ダイアログのキャンセル等がなく、保存完了が明示的に確認された場合のみ true */
  saveConfirmed?: boolean;
  /** 履歴上限の自動破棄から守る。すべてピン留めのときは上限のため破棄対象に戻る */
  pinned?: boolean;
}

export interface RetentionResult<T extends RetainableImage> {
  retained: T[];
  evicted: T[];
  evictedUndownloadedCount: number;
}

/**
 * 新しい画像を先頭に含む配列に対し、枚数・総バイト数の上限に収まるよう破棄する。
 * 同じ段では古い画像を先に捨てる。
 * 1. ピン留めしていない、保存完了が確認された画像（saveConfirmed）
 * 2. ピン留めしていない画像
 * 3. 残りがすべてピン留めのとき: 保存完了が確認された画像、なければ古い画像
 * 最後の1枚は残す。
 */
function oldestIndex<T extends RetainableImage>(images: T[], match: (img: T) => boolean): number {
  for (let i = images.length - 1; i >= 0; i--) {
    if (match(images[i]!)) return i;
  }
  return -1;
}

export function applyImageRetention<T extends RetainableImage>(
  images: T[],
  limits: ImageHistoryLimits = DEFAULT_IMAGE_HISTORY_LIMITS,
): RetentionResult<T> {
  const retained = [...images];
  const evicted: T[] = [];
  let totalBytes = retained.reduce((sum, img) => sum + img.blob.size, 0);

  const pickEvictIndex = (): number => {
    const unpinnedSaved = oldestIndex(retained, (img) => !img.pinned && !!img.saveConfirmed);
    if (unpinnedSaved >= 0) return unpinnedSaved;
    const unpinned = oldestIndex(retained, (img) => !img.pinned);
    if (unpinned >= 0) return unpinned;
    const saved = oldestIndex(retained, (img) => !!img.saveConfirmed);
    if (saved >= 0) return saved;
    return retained.length - 1;
  };

  while (retained.length > 1 && (retained.length > limits.maxCount || totalBytes > limits.maxBytes)) {
    const idx = pickEvictIndex();
    const [removed] = retained.splice(idx, 1);
    if (!removed) break;
    totalBytes -= removed.blob.size;
    evicted.push(removed);
  }

  const evictedUndownloadedCount = evicted.filter((img) => !img.downloaded).length;
  return { retained, evicted, evictedUndownloadedCount };
}

/**
 * 一覧表示用の縮小サムネイル Object URL を生成する。
 * 元画像が十分小さい場合やブラウザ API が利用できない場合は null を返す。
 */
export async function createThumbnailUrl(
  blob: Blob,
  width: number,
  height: number,
  maxEdge = THUMBNAIL_MAX_EDGE,
): Promise<string | null> {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest <= 0) return null;
  if (typeof createImageBitmap !== 'function') return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const scale = maxEdge / longest;
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, tw, th);
    const thumbBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.82);
    });
    if (!thumbBlob) return null;
    return URL.createObjectURL(thumbBlob);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
