import { useCallback, useEffect, useRef, useState } from 'react';
import { newId } from '../lib/id';
import {
  applyImageRetention,
  createThumbnailUrl,
  DEFAULT_IMAGE_HISTORY_LIMITS,
  type ImageHistoryLimits,
} from '../lib/imageHistory';

/** 生成画像はメモリ（Blob URL）にだけ置き、タブを閉じたら消える。 */
export interface GeneratedImage {
  id: string;
  url: string;
  thumbUrl?: string;
  blob: Blob;
  seed: number;
  width: number;
  height: number;
  prompt: string;
  characterPrompts: string[];
  createdAt: number;
  downloaded: boolean;
}

export type NewImage = Omit<GeneratedImage, 'id' | 'url' | 'thumbUrl' | 'downloaded'>;

export interface ImageStore {
  images: GeneratedImage[];
  add: (images: NewImage[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  markDownloaded: (id: string) => void;
}

export interface UseImagesOptions {
  limits?: ImageHistoryLimits;
  onEvictUndownloaded?: (count: number) => void;
}

function revokeImageUrls(img: Pick<GeneratedImage, 'url' | 'thumbUrl'>): void {
  URL.revokeObjectURL(img.url);
  if (img.thumbUrl) URL.revokeObjectURL(img.thumbUrl);
}

export function useImages(options?: UseImagesOptions): ImageStore {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const imagesRef = useRef<GeneratedImage[]>([]);
  const mountedRef = useRef(true);
  const limitsRef = useRef(options?.limits ?? DEFAULT_IMAGE_HISTORY_LIMITS);
  limitsRef.current = options?.limits ?? DEFAULT_IMAGE_HISTORY_LIMITS;
  const onEvictRef = useRef(options?.onEvictUndownloaded);
  onEvictRef.current = options?.onEvictUndownloaded;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const img of imagesRef.current) revokeImageUrls(img);
    };
  }, []);

  const add = useCallback((list: NewImage[]) => {
    if (list.length === 0) return;
    const created: GeneratedImage[] = list.map((img) => ({
      ...img,
      id: newId(),
      url: URL.createObjectURL(img.blob),
      downloaded: false,
    }));
    const { retained, evicted, evictedUndownloadedCount } = applyImageRetention(
      [...created, ...imagesRef.current],
      limitsRef.current,
    );
    imagesRef.current = retained;
    setImages(retained);

    for (const img of evicted) revokeImageUrls(img);
    if (evictedUndownloadedCount > 0) onEvictRef.current?.(evictedUndownloadedCount);

    const retainedIds = new Set(retained.map((img) => img.id));
    for (const img of created) {
      if (!retainedIds.has(img.id)) continue;
      void createThumbnailUrl(img.blob, img.width, img.height).then((thumbUrl) => {
        if (!thumbUrl) return;
        if (!mountedRef.current || !imagesRef.current.some((item) => item.id === img.id)) {
          URL.revokeObjectURL(thumbUrl);
          return;
        }
        const next = imagesRef.current.map((item) => {
          if (item.id !== img.id) return item;
          if (item.thumbUrl && item.thumbUrl !== thumbUrl) URL.revokeObjectURL(item.thumbUrl);
          return { ...item, thumbUrl };
        });
        imagesRef.current = next;
        setImages(next);
      });
    }
  }, []);

  const remove = useCallback((id: string) => {
    const target = imagesRef.current.find((img) => img.id === id);
    if (!target) return;
    const next = imagesRef.current.filter((img) => img.id !== id);
    imagesRef.current = next;
    setImages(next);
    revokeImageUrls(target);
  }, []);

  const clear = useCallback(() => {
    const prev = imagesRef.current;
    if (prev.length === 0) return;
    imagesRef.current = [];
    setImages([]);
    for (const img of prev) revokeImageUrls(img);
  }, []);

  // 未ダウンロードの画像があるときだけ、閉じる・再読み込みの前に確認を出す（unload では確認を出せない）
  const hasUndownloaded = images.some((img) => !img.downloaded);
  useEffect(() => {
    if (!hasUndownloaded) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUndownloaded]);

  const markDownloaded = useCallback((id: string) => {
    if (!imagesRef.current.some((img) => img.id === id && !img.downloaded)) return;
    const next = imagesRef.current.map((img) => (img.id === id ? { ...img, downloaded: true } : img));
    imagesRef.current = next;
    setImages(next);
  }, []);

  return { images, add, remove, clear, markDownloaded };
}
