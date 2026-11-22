import { useEffect, useRef, useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { timeStamp } from '../lib/browser';
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon, NextIcon, PinIcon, PrevIcon, TrashIcon } from './icons';

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

const EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

export function imageFileName(image: GeneratedImage): string {
  return `nai-tagdeck-${timeStamp(new Date(image.createdAt))}-${image.seed}.${EXT[image.blob.type] ?? 'png'}`;
}

interface View {
  s: number;
  x: number;
  y: number;
}
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const FIT: View = { s: 1, x: 0, y: 0 };

const clampView = (v: View, w: number, h: number): View => {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s));
  const mx = ((s - 1) * w) / 2;
  const my = ((s - 1) * h) / 2;
  return { s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
};

// 固定サイズの枠の中で画像をピンチ・ホイール・ダブルタップで拡大縮小し、ドラッグで動かす
const EDGE_ZONE = 0.15; // 左右端のこの割合をタップすると前後の画像へ
const SWIPE_MIN = 50;

interface StageProps {
  src: string;
  alt: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

function ZoomStage({ src, alt, hasPrev, hasNext, onPrev, onNext, onClose }: StageProps) {
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef({ x: 0, y: 0 });
  const multi = useRef(false);
  const [view, setView] = useState<View>(FIT);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef(0);
  const moved = useRef(false);

  useEffect(() => setView(FIT), [src]);

  // cx, cy: 枠の中心を原点にした拡大の基準点
  const zoomAt = (ns: number, cx: number, cy: number) => {
    const el = stage.current;
    if (!el) return;
    const v = viewRef.current;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, ns));
    const k = s / v.s;
    setView(clampView({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, el.clientWidth, el.clientHeight));
  };

  const center = (clientX: number, clientY: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  };

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = center(e.clientX, e.clientY);
      zoomAt(viewRef.current.s * Math.exp(-e.deltaY * 0.0015), c.x, c.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 既に離されたポインタなどは無視
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      moved.current = false;
      multi.current = false;
      start.current = { x: e.clientX, y: e.clientY };
    } else multi.current = true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const el = e.currentTarget;
    const next = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      if (dx || dy) moved.current = true;
      const v = viewRef.current;
      setView(clampView({ ...v, x: v.x + dx, y: v.y + dy }, el.clientWidth, el.clientHeight));
    } else if (pointers.current.size === 2) {
      moved.current = true;
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 0) {
        const c = center((next.x + other.x) / 2, (next.y + other.y) / 2);
        zoomAt(viewRef.current.s * (after / before), c.x, c.y);
      }
    }
    pointers.current.set(e.pointerId, next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size > 0) return;
    const zoomed = viewRef.current.s > 1.01;
    if (moved.current) {
      // 等倍表示での横スワイプ = 前後の画像へ
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (e.type === 'pointerup' && !zoomed && !multi.current && Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0 && hasNext) onNext();
        else if (dx > 0 && hasPrev) onPrev();
      }
      return;
    }
    if (e.type !== 'pointerup') return;
    // 等倍表示で左右の端をタップ = 前後の画像へ
    if (!zoomed) {
      const r = e.currentTarget.getBoundingClientRect();
      const rel = (e.clientX - r.left) / r.width;
      if (rel < EDGE_ZONE) {
        lastTap.current = 0;
        if (hasPrev) onPrev();
        return;
      }
      if (rel > 1 - EDGE_ZONE) {
        lastTap.current = 0;
        if (hasNext) onNext();
        return;
      }
    }
    // 動かさずに離した = タップ。素早く2回でズーム切り替え
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (viewRef.current.s > 1.01) setView(FIT);
      else {
        const c = center(e.clientX, e.clientY);
        zoomAt(2.5, c.x, c.y);
      }
    } else lastTap.current = now;
  };

  return (
    <div
      ref={stage}
      className="viewer-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <img
        src={src}
        alt={alt}
        className="viewer-img"
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
      />
      <button
        type="button"
        className="viewer-close"
        aria-label="閉じる"
        title="閉じる"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
      {view.s > 1.01 && (
        <button
          type="button"
          className="btn viewer-zoom-reset"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setView(FIT)}
        >
          {Math.round(view.s * 100)}% 元に戻す
        </button>
      )}
    </div>
  );
}

export function ImageViewer({ image, hasPrev, hasNext, onPrev, onNext, onClose, onRemove, onUseSeed, onDownload, onTogglePin, onImportPrompt }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [seedCopied, setSeedCopied] = useState(false);
  // 削除は1回目で確認状態にし、2回目で実行する。連打で消えないよう、確認状態になってから
  // REMOVE_ARM_MS の間は押せない。押せるようになってからしばらく押さなければ元に戻す
  const [removeArmed, setRemoveArmed] = useState(false);
  const [removeReady, setRemoveReady] = useState(false);

  useEffect(() => {
    setSeedCopied(false);
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
    if (!seedCopied) return;
    const t = setTimeout(() => setSeedCopied(false), 1500);
    return () => clearTimeout(t);
  }, [seedCopied]);

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
        <ZoomStage
          src={image.url}
          alt={`生成画像（シード ${image.seed}）`}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={onPrev}
          onNext={onNext}
          onClose={() => dialog.current?.close()}
        />
        <div className="viewer-side">
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
              aria-label={image.pinned ? 'ピン留めを外す' : 'ピン留め'}
              title={image.pinned ? 'ピン留めを外す' : '履歴の自動削除から保護する'}
              onClick={onTogglePin}
            >
              <PinIcon filled={image.pinned} />
            </button>
            <button type="button" className="icon-btn" onClick={onDownload} aria-label="PNGをダウンロード" title="PNGをダウンロード">
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
                style={{ '--arm-ms': `${REMOVE_ARM_MS}ms` } as React.CSSProperties}
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
                  className="icon-btn viewer-seed-copy"
                  aria-label="このシードを次の生成で使う"
                  title="このシードを次の生成で使う"
                  onClick={() => {
                    onUseSeed(image.seed);
                    setSeedCopied(true);
                  }}
                >
                  {seedCopied ? <CheckIcon /> : <CopyIcon />}
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
          </dl>
          {onImportPrompt && (
            <button type="button" className="btn btn-small" onClick={onImportPrompt}>プロンプトを読み込む</button>
          )}
          <details className="viewer-prompt">
            <summary>プロンプト</summary>
            <p>{image.prompt}</p>
            {image.characterPrompts.map((c, i) => (
              <p key={i}>
                <strong>キャラ{i + 1}:</strong> {c}
              </p>
            ))}
          </details>
        </div>
      </div>
    </dialog>
  );
}
