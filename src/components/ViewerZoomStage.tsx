import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CloseIcon } from './icons';

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

export function ViewerZoomStage({ src, alt, hasPrev, hasNext, onPrev, onNext, onClose }: StageProps) {
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

  // center と zoomAt は描画ごとに作り直すが、中身は ref の最新値だけを読む。
  // 依存に入れるとホイールのリスナーが毎描画で付け替わる。
  // biome-ignore lint/correctness/useExhaustiveDependencies(center): ref の最新値を読む
  // biome-ignore lint/correctness/useExhaustiveDependencies(zoomAt): ref の最新値を読む
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

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
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

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
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
