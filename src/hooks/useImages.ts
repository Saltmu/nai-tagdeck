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
  /** 保存できたことをユーザーが確認したときだけ true。ダウンロードの開始とは分ける */
  saveConfirmed?: boolean;
  pinned: boolean;
}

export type NewImage = Omit<GeneratedImage, 'id' | 'url' | 'thumbUrl' | 'downloaded' | 'pinned'>;

export interface ImageStore {
  images: GeneratedImage[];
  evictedCount: number;
  add: (images: NewImage[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  markDownloaded: (id: string) => void;
  markSaved: (id: string) => void;
  togglePinned: (id: string) => void;
  dismissEviction: () => void;
}

export interface UseImagesOptions {
  limits?: ImageHistoryLimits;
  onEvict?: (count: number) => void;
}

function revokeImageUrls(img: Pick<GeneratedImage, 'url' | 'thumbUrl'>): void {
  URL.revokeObjectURL(img.url);
  if (img.thumbUrl) URL.revokeObjectURL(img.thumbUrl);
}

export function useImages(options?: UseImagesOptions): ImageStore {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [evictedCount, setEvictedCount] = useState(0);
  const imagesRef = useRef<GeneratedImage[]>([]);
  const mountedRef = useRef(true);
  const limitsRef = useRef(options?.limits ?? DEFAULT_IMAGE_HISTORY_LIMITS);
  limitsRef.current = options?.limits ?? DEFAULT_IMAGE_HISTORY_LIMITS;
  const onEvictRef = useRef(options?.onEvict);
  onEvictRef.current = options?.onEvict;

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
      saveConfirmed: false,
      pinned: false,
    }));
    const { retained, evicted } = applyImageRetention(
      [...created, ...imagesRef.current],
      limitsRef.current,
      created.length,
    );
    imagesRef.current = retained;
    setImages(retained);

    for (const img of evicted) revokeImageUrls(img);
    if (evicted.length > 0) {
      // <a download> では保存完了を確認できないため、downloaded の有無に関わらず破棄を通知する
      setEvictedCount((prev) => prev + evicted.length);
      onEvictRef.current?.(evicted.length);
    }

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
    setEvictedCount(0);
    if (prev.length === 0) return;
    imagesRef.current = [];
    setImages([]);
    for (const img of prev) revokeImageUrls(img);
  }, []);

  // <a download> では保存完了（キャンセル含む）を確認できないため、画像がある間は常に離脱確認を出す
  const hasImages = images.length > 0;
  useEffect(() => {
    if (!hasImages) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasImages]);

  const markDownloaded = useCallback((id: string) => {
    if (!imagesRef.current.some((img) => img.id === id && !img.downloaded)) return;
    const next = imagesRef.current.map((img) => (img.id === id ? { ...img, downloaded: true } : img));
    imagesRef.current = next;
    setImages(next);
  }, []);

  const markSaved = useCallback((id: string) => {
    if (!imagesRef.current.some((img) => img.id === id && !img.saveConfirmed)) return;
    const next = imagesRef.current.map((img) => (
      img.id === id ? { ...img, downloaded: true, saveConfirmed: true } : img
    ));
    imagesRef.current = next;
    setImages(next);
  }, []);

  const togglePinned = useCallback((id: string) => {
    if (!imagesRef.current.some((img) => img.id === id)) return;
    const next = imagesRef.current.map((img) => (img.id === id ? { ...img, pinned: !img.pinned } : img));
    imagesRef.current = next;
    setImages(next);
  }, []);

  const dismissEviction = useCallback(() => setEvictedCount(0), []);

  return { images, evictedCount, add, remove, clear, markDownloaded, markSaved, togglePinned, dismissEviction };
}
