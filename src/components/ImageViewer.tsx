import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { modeLabel, samplerLabel } from '../lib/generation';
import { CheckIcon, CloseIcon, DownloadIcon, LockIcon, NextIcon, PinIcon, PrevIcon, TrashIcon } from './icons';
import { ViewerPromptDetails } from './ViewerPromptDetails';
import { ViewerZoomStage } from './ViewerZoomStage';

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
  onTogglePin: () => void;
  onImportPrompt?: () => void;
}

const VIEWER_STATE = 'naiTagdeckViewer';
const isViewerState = (state: unknown) =>
  typeof state === 'object' && state !== null && (state as Record<string, unknown>)[VIEWER_STATE] === true;

const REMOVE_ARM_MS = 1000;
const COPY_MS = 1500;

export { imageFileName } from '../lib/imageFileName';

export function ImageViewer({ image, hasPrev, hasNext, onPrev, onNext, onClose, onRemove, onUseSeed, onDownload, onTogglePin, onImportPrompt }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [seedApplied, setSeedApplied] = useState(false);
  // 削除は1回目で確認状態にし、2回目で実行する。連打で消えないよう、確認状態になってから
  // REMOVE_ARM_MS の間は押せない。押せるようになってからしばらく押さなければ元に戻す
  const [removeArmed, setRemoveArmed] = useState(false);
  const [removeReady, setRemoveReady] = useState(false);

  useEffect(() => {
    setSeedApplied(false);
    setRemoveArmed(false);
  }, [image]);
  useEffect(() => {
    setRemoveReady(false);
    if (!removeArmed) return;
    const ready = setTimeout(() => setRemoveReady(true), REMOVE_ARM_MS);
    const reset = setTimeout(() => setRemoveArmed(false), REMOVE_ARM_MS + 3000);
    return () => {
      clearTimeout(ready);
      clearTimeout(reset);
    };
  }, [removeArmed]);
  useEffect(() => {
    if (!seedApplied) return;
    const t = setTimeout(() => setSeedApplied(false), COPY_MS);
    return () => clearTimeout(t);
  }, [seedApplied]);
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
        if (e.key === 'ArrowLeft' && hasPrev) {
          e.preventDefault();
          onPrev();
        }
        if (e.key === 'ArrowRight' && hasNext) {
          e.preventDefault();
          onNext();
        }
      }}
    >
      <div className="viewer-body">
        <ViewerZoomStage
          src={image.url}
          alt={`生成画像（シード ${image.seed}）`}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={onPrev}
          onNext={onNext}
          onClose={() => dialog.current?.close()}
        />
        <div className="viewer-side" tabIndex={0} aria-label="生成画像の詳細">
          <div className="viewer-toolbar">
            <button type="button" className="icon-btn" disabled={!hasPrev} onClick={onPrev} aria-label="新しい画像へ" title="新しい画像へ">
              <PrevIcon />
            </button>
            <button type="button" className="icon-btn" disabled={!hasNext} onClick={onNext} aria-label="古い画像へ" title="古い画像へ">
              <NextIcon />
            </button>
            <span className="viewer-toolbar-gap" />
            <button
              type="button"
              className="icon-btn"
              aria-pressed={image.pinned}
              aria-label="ピン留め"
              title={image.pinned ? 'ピン留めを外す' : 'ピン留め（上限超過時に後から削除・ZIP保存対象）'}
              onClick={onTogglePin}
            >
              <PinIcon filled={image.pinned} />
            </button>
            <button
              type="button"
              className={`icon-btn${image.downloaded ? ' is-downloaded' : ''}`}
              onClick={onDownload}
              aria-label={image.downloaded ? 'PNGを再ダウンロード（DL操作済み）' : 'PNGをダウンロード'}
              title={image.downloaded ? 'PNGを再ダウンロード（DL操作済み）' : 'PNGをダウンロード'}
            >
              <DownloadIcon />
            </button>
            {removeArmed ? (
              <button
                type="button"
                className={`viewer-remove-confirm${removeReady ? ' is-ready' : ''}`}
                // disabled にするとフォーカスが外れて確認状態が解けるため、aria-disabled で押下だけ無視する
                aria-disabled={!removeReady}
                onClick={() => {
                  if (removeReady) onRemove();
                }}
                onBlur={() => setRemoveArmed(false)}
                autoFocus
                aria-label="もう一度押すと削除"
                title="もう一度押すと削除"
                style={{ '--arm-ms': `${REMOVE_ARM_MS}ms` } as CSSProperties}
              >
                <span>削除</span>
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                onClick={() => setRemoveArmed(true)}
                aria-label="削除"
                title="削除"
              >
                <TrashIcon />
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => dialog.current?.close()} aria-label="閉じる" title="閉じる">
              <CloseIcon />
            </button>
            <span className="visually-hidden" role="status" aria-live="polite">
              {removeArmed && removeReady ? '削除の準備ができました。もう一度押すと削除します' : ''}
            </span>
          </div>
          <dl className="viewer-meta">
            <div>
              <dt>シード</dt>
              <dd className="viewer-seed">
                {image.seed}
                <button
                  type="button"
                  className="btn btn-small viewer-seed-apply"
                  aria-label={seedApplied ? '設定済み' : 'このシードを次の生成で使う'}
                  title={seedApplied ? '設定済み' : 'このシードを次の生成で使う'}
                  onClick={() => {
                    onUseSeed(image.seed);
                    setSeedApplied(true);
                  }}
                >
                  {seedApplied ? <CheckIcon /> : <LockIcon />}
                  <span>{seedApplied ? '設定済み' : '次に使う'}</span>
                </button>
              </dd>
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
            {image.params && (
              <>
                <div>
                  <dt>モード</dt>
                  <dd>{modeLabel(image.params.mode)}</dd>
                </div>
                <div>
                  <dt>ステップ</dt>
                  <dd>{image.params.steps}</dd>
                </div>
                <div>
                  <dt>スケール</dt>
                  <dd>{image.params.scale}</dd>
                </div>
                <div>
                  <dt>サンプラー</dt>
                  <dd>{samplerLabel(image.params.sampler)}</dd>
                </div>
                <div>
                  <dt>ノイズスケジュール</dt>
                  <dd>{image.params.noiseSchedule}</dd>
                </div>
                <div>
                  <dt>CFG リスケール</dt>
                  <dd>{image.params.cfgRescale}</dd>
                </div>
                <div>
                  <dt>ダイナミックしきい値</dt>
                  <dd>{image.params.dynamicThresholding ? 'オン' : 'オフ'}</dd>
                </div>
              </>
            )}
          </dl>
          {onImportPrompt && (
            <button type="button" className="btn btn-small" onClick={onImportPrompt}>プロンプトを読み込む</button>
          )}
          <ViewerPromptDetails image={image} getCopyContainer={() => dialog.current} />
        </div>
      </div>
    </dialog>
  );
}
