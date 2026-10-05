import { useEffect, useRef } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { downloadBlob, timeStamp } from '../lib/browser';

interface Props {
  image: GeneratedImage;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onRemove: () => void;
  onUseSeed: (seed: number) => void;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

export function imageFileName(image: GeneratedImage): string {
  return `nai-tagdeck-${timeStamp(new Date(image.createdAt))}-${image.seed}.${EXT[image.blob.type] ?? 'png'}`;
}

export function ImageViewer({ image, hasPrev, hasNext, onPrev, onNext, onClose, onRemove, onUseSeed }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="viewer"
      aria-label="画像の拡大表示"
      onClose={onClose}
      onClick={(e) => {
        // 画像の外側（背景）を押したら閉じる
        if (e.target === e.currentTarget) dialog.current?.close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' && hasPrev) onPrev();
        if (e.key === 'ArrowRight' && hasNext) onNext();
      }}
    >
      <div className="viewer-body">
        <img src={image.url} alt={`生成画像（シード ${image.seed}）`} className="viewer-img" />
        <div className="viewer-side">
          <dl className="viewer-meta">
            <div>
              <dt>シード</dt>
              <dd>{image.seed}</dd>
            </div>
            <div>
              <dt>サイズ</dt>
              <dd>
                {image.width}×{image.height}
              </dd>
            </div>
            <div>
              <dt>生成</dt>
              <dd>{new Date(image.createdAt).toLocaleTimeString()}</dd>
            </div>
          </dl>
          <details className="viewer-prompt">
            <summary>プロンプト</summary>
            <p>{image.prompt}</p>
            {image.characterPrompts.map((c, i) => (
              <p key={i}>
                <strong>キャラ{i + 1}:</strong> {c}
              </p>
            ))}
          </details>
          <div className="viewer-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => downloadBlob(imageFileName(image), image.blob)}
            >
              保存
            </button>
            <button
              type="button"
              className="btn"
              title="次の生成でこのシードを使います"
              onClick={() => {
                onUseSeed(image.seed);
                dialog.current?.close();
              }}
            >
              このシードを使う
            </button>
            <button type="button" className="btn btn-danger" onClick={onRemove}>
              削除
            </button>
          </div>
          <div className="viewer-nav">
            <button type="button" className="btn" disabled={!hasPrev} onClick={onPrev} aria-label="新しい画像へ">
              ← 新しい
            </button>
            <button type="button" className="btn" disabled={!hasNext} onClick={onNext} aria-label="古い画像へ">
              古い →
            </button>
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              閉じる
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
