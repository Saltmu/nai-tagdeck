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
  /** 履歴上限の自動破棄から守る。すべてピン留めのときは上限のため破棄対象に戻る */
  pinned?: boolean;
}

export interface RetentionResult<T extends RetainableImage> {
  retained: T[];
  evicted: T[];
  evictedUndownloadedCount: number;
}

export interface ImageHistoryStats {
  count: number;
  totalBytes: number;
  pinnedCount: number;
  downloadedCount: number;
  pinnedWidth: number;
  unsavedWidth: number;
  savedWidth: number;
  isAtLimit: boolean;
  usedMb: string;
  maxMb: number;
}

/**
 * 履歴画像の枚数・総バイト数・ピン留め/DL操作済の件数とメーター幅を 1 パスで集計する。
 */
export function summarizeImageHistory(
  images: readonly RetainableImage[],
  limits: ImageHistoryLimits = DEFAULT_IMAGE_HISTORY_LIMITS,
): ImageHistoryStats {
  let totalBytes = 0;
  let pinnedCount = 0;
  let downloadedCount = 0;
  let unpinnedUndownloadedCount = 0;
  let unpinnedDownloadedCount = 0;
  let pinnedBytes = 0;
  let unpinnedUndownloadedBytes = 0;
  let unpinnedDownloadedBytes = 0;

  for (const img of images) {
    const size = img.blob.size;
    totalBytes += size;
    if (img.downloaded) downloadedCount += 1;
    if (img.pinned) {
      pinnedCount += 1;
      pinnedBytes += size;
    } else if (img.downloaded) {
      unpinnedDownloadedCount += 1;
      unpinnedDownloadedBytes += size;
    } else {
      unpinnedUndownloadedCount += 1;
      unpinnedUndownloadedBytes += size;
    }
  }

  const count = images.length;
  const countRatio = count / limits.maxCount;
  const byteRatio = totalBytes / limits.maxBytes;
  const useByteScale = byteRatio > countRatio;
  const meterScale = useByteScale
    ? Math.max(limits.maxBytes, totalBytes)
    : Math.max(limits.maxCount, count);
  const pinnedWidth = ((useByteScale ? pinnedBytes : pinnedCount) / meterScale) * 100;
  const unsavedWidth = ((useByteScale ? unpinnedUndownloadedBytes : unpinnedUndownloadedCount) / meterScale) * 100;
  const savedWidth = ((useByteScale ? unpinnedDownloadedBytes : unpinnedDownloadedCount) / meterScale) * 100;
  const isAtLimit = count >= limits.maxCount || totalBytes >= limits.maxBytes;
  const mib = 1024 * 1024;
  const usedMb = totalBytes === 0
    ? '0'
    : (totalBytes / mib < 10 ? (totalBytes / mib).toFixed(1) : String(Math.round(totalBytes / mib)));
  const maxMb = Math.round(limits.maxBytes / mib);

  return {
    count,
    totalBytes,
    pinnedCount,
    downloadedCount,
    pinnedWidth,
    unsavedWidth,
    savedWidth,
    isAtLimit,
    usedMb,
    maxMb,
  };
}

/**
 * 新しい画像を先頭に含む配列に対し、枚数・総バイト数の上限に収まるよう破棄する。
 * 同じ段では古い画像を先に捨てる。
 * 先頭 protectCount 枚は、今回追加した画像として、それより古い画像で上限に収まるあいだ残す。
 * 1. 保護対象でない、ピン留めしていない、ダウンロード済みの画像
 * 2. 保護対象でない、ピン留めしていない画像
 * 3. 保護対象でない画像（すべてピン留めのときは、ダウンロード済みを先に、なければ古いもの）
 * 4. それでも超えるときは、保護対象も含めて同じ順
 * 最後の1枚は残す。
 */
function oldestIndex<T extends RetainableImage>(
  images: T[],
  match: (img: T, index: number) => boolean,
): number {
  for (let i = images.length - 1; i >= 0; i--) {
    if (match(images[i]!, i)) return i;
  }
  return -1;
}

export function applyImageRetention<T extends RetainableImage>(
  images: T[],
  limits: ImageHistoryLimits = DEFAULT_IMAGE_HISTORY_LIMITS,
  protectCount = 0,
): RetentionResult<T> {
  const retained = [...images];
  const evicted: T[] = [];
  let totalBytes = retained.reduce((sum, img) => sum + img.blob.size, 0);
  let protectedPrefix = Math.max(0, Math.min(protectCount, retained.length));

  const pickEvictIndex = (): number => {
    const pick = (match: (img: T, index: number) => boolean) => oldestIndex(retained, match);
    const outside = (index: number) => index >= protectedPrefix;
    const unpinnedDownloaded = pick((img, index) => outside(index) && !img.pinned && img.downloaded);
    if (unpinnedDownloaded >= 0) return unpinnedDownloaded;
    const unpinned = pick((img, index) => outside(index) && !img.pinned);
    if (unpinned >= 0) return unpinned;
    const downloaded = pick((img, index) => outside(index) && img.downloaded);
    if (downloaded >= 0) return downloaded;
    const older = pick((_img, index) => outside(index));
    if (older >= 0) return older;
    const downloadedInside = pick((img) => img.downloaded);
    if (downloadedInside >= 0) return downloadedInside;
    return retained.length - 1;
  };

  while (retained.length > 1 && (retained.length > limits.maxCount || totalBytes > limits.maxBytes)) {
    const idx = pickEvictIndex();
    if (idx < protectedPrefix) protectedPrefix -= 1;
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
