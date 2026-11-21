import { useEffect, useRef } from 'react';
import type { GeneratedImage } from '../hooks/useImages';

interface Props {
  image: GeneratedImage;
  onOpen: () => void;
  onDismiss: () => void;
}

/** 狭い画面で編集タブにいるとき、生成し終わった画像を右下に小さく出す。 */
export function LatestPreview({ image, onOpen, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // トーストを、このプレビューの上へ持ち上げる。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--latest-offset', height > 0 ? `${height + 8}px` : '0px');
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--latest-offset');
    };
  }, [image]);

  return (
    <div ref={ref} className="latest-preview" role="status">
      <button type="button" className="latest-open" onClick={onOpen} aria-label="生成した画像を開く">
        <img src={image.thumbUrl ?? image.url} alt="" style={{ aspectRatio: `${image.width} / ${image.height}` }} />
        <span>生成しました</span>
      </button>
      <button type="button" className="icon-btn latest-close" aria-label="閉じる" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
