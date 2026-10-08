import { useEffect, useRef, useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { timeStamp } from '../lib/browser';
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon, NextIcon, PrevIcon, TrashIcon } from './icons';

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
function ZoomStage({ src, alt }: { src: string; alt: string }) {
  const stage = useRef<HTMLDivElement>(null);
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
    moved.current = false;
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
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0 || moved.current) return;
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

export function ImageViewer({ image, hasPrev, hasNext, onPrev, onNext, onClose, onRemove, onUseSeed, onDownload }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [seedCopied, setSeedCopied] = useState(false);

  useEffect(() => setSeedCopied(false), [image]);
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
        if (e.key === 'ArrowLeft' && hasPrev) onPrev();
        if (e.key === 'ArrowRight' && hasNext) onNext();
      }}
    >
      <div className="viewer-body">
        <ZoomStage src={image.url} alt={`生成画像（シード ${image.seed}）`} />
        <div className="viewer-side">
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
          <details className="viewer-prompt">
            <summary>プロンプト</summary>
            <p>{image.prompt}</p>
            {image.characterPrompts.map((c, i) => (
              <p key={i}>
                <strong>キャラ{i + 1}:</strong> {c}
              </p>
            ))}
          </details>
          <div className="viewer-toolbar">
            <button type="button" className="icon-btn" disabled={!hasPrev} onClick={onPrev} aria-label="新しい画像へ" title="新しい画像へ">
              <PrevIcon />
            </button>
            <button type="button" className="icon-btn" disabled={!hasNext} onClick={onNext} aria-label="古い画像へ" title="古い画像へ">
              <NextIcon />
            </button>
            <span className="viewer-toolbar-gap" />
            <button type="button" className="icon-btn" onClick={onDownload} aria-label="保存" title="保存">
              <DownloadIcon />
            </button>
            <button type="button" className="icon-btn icon-btn-danger" onClick={onRemove} aria-label="削除" title="削除">
              <TrashIcon />
            </button>
            <button type="button" className="icon-btn" onClick={() => dialog.current?.close()} aria-label="閉じる" title="閉じる">
              <CloseIcon />
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
