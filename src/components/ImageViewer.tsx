import { useEffect, useRef } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { timeStamp } from '../lib/browser';

interface Props {
  image: GeneratedImage;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onRemove: () => void;
  onUseSeed: (seed: number) => void;
  onDownload: () => void;
}

const VIEWER_STATE = 'naiTagdeckViewer';
const isViewerState = (state: unknown) =>
  typeof state === 'object' && state !== null && (state as Record<string, unknown>)[VIEWER_STATE] === true;

const EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

export function imageFileName(image: GeneratedImage): string {
  return `nai-tagdeck-${timeStamp(new Date(image.createdAt))}-${image.seed}.${EXT[image.blob.type] ?? 'png'}`;
}

export function ImageViewer({ image, hasPrev, hasNext, onPrev, onNext, onClose, onRemove, onUseSeed, onDownload }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  // 拡大表示中にブラウザの「戻る」を押したら、ページを離れずに拡大表示だけを閉じる。
  // 開いたときに履歴を1つ積み、戻るで消えたら閉じる。ボタンなどで閉じたときは積んだ履歴を自分で戻す。
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    // StrictMode の再実行で二重に積まないよう、すでに積んであれば何もしない
    if (!isViewerState(window.history.state)) window.history.pushState({ [VIEWER_STATE]: true }, '');
    const onPopState = () => dialog.current?.close();
    window.addEventListener('popstate', onPopState);
    return () => {
      active.current = false;
      window.removeEventListener('popstate', onPopState);
      // StrictMode の仮のアンマウント直後は再マウントされているので、本当に閉じたときだけ戻す
      queueMicrotask(() => {
        if (!active.current && isViewerState(window.history.state)) window.history.back();
      });
    };
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
              onClick={onDownload}
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
