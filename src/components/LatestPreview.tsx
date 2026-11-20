import type { GeneratedImage } from '../hooks/useImages';

interface Props {
  image: GeneratedImage;
  onOpen: () => void;
  onDismiss: () => void;
}

/** 狭い画面で編集タブにいるとき、生成し終わった画像を右下に小さく出す。 */
export function LatestPreview({ image, onOpen, onDismiss }: Props) {
  return (
    <div className="latest-preview" role="status">
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
