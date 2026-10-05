import { useCallback, useEffect, useRef, useState } from 'react';
import { newId } from '../lib/id';

/** 生成画像はメモリ（Blob URL）にだけ置き、タブを閉じたら消える。 */
export interface GeneratedImage {
  id: string;
  url: string;
  blob: Blob;
  seed: number;
  width: number;
  height: number;
  prompt: string;
  characterPrompts: string[];
  createdAt: number;
  downloaded: boolean;
}

export type NewImage = Omit<GeneratedImage, 'id' | 'url' | 'downloaded'>;

export interface ImageStore {
  images: GeneratedImage[];
  add: (images: NewImage[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  markDownloaded: (id: string) => void;
}

export function useImages(): ImageStore {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const latest = useRef(images);
  latest.current = images;
  useEffect(() => () => {
    for (const img of latest.current) URL.revokeObjectURL(img.url);
  }, []);

  const add = useCallback((list: NewImage[]) => {
    const created = list.map((img) => ({ ...img, id: newId(), url: URL.createObjectURL(img.blob), downloaded: false }));
    setImages((prev) => [...created, ...prev]);
  }, []);

  const remove = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.url);
      return [];
    });
  }, []);

  // 画像があるときだけ、閉じる・再読み込みの前に確認を出す（unload では確認を出せない）
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
    setImages((prev) => prev.map((img) => img.id === id ? { ...img, downloaded: true } : img));
  }, []);

  return { images, add, remove, clear, markDownloaded };
}
