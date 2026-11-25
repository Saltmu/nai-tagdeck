import type { GeneratedImage } from '../hooks/useImages';
import { timeStamp } from './browser';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

/** 生成画像の個別ダウンロードや ZIP 作成で使うファイル名。 */
export function imageFileName(image: GeneratedImage): string {
  return `nai-tagdeck-${timeStamp(new Date(image.createdAt))}-${image.seed}.${EXT[image.blob.type] ?? 'png'}`;
}
