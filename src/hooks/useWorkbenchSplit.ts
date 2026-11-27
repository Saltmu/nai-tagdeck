import { type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useRef, useState } from 'react';

export const WORKBENCH_SPLIT_STORAGE_KEY = 'nai-tagdeck:pane-ratio';
export const MIN_GENERATE_RATIO = 0.25;
export const MAX_GENERATE_RATIO = 0.65;
const DEFAULT_ARIA_PERCENT = 33;
const KEYBOARD_STEP = 0.02;

function clampRatio(value: number): number {
  return Math.min(MAX_GENERATE_RATIO, Math.max(MIN_GENERATE_RATIO, Math.round(value * 1000) / 1000));
}

function loadSavedRatio(): number | null {
  try {
    const raw = window.localStorage.getItem(WORKBENCH_SPLIT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return clampRatio(parsed);
  } catch {
    return null;
  }
}

function saveRatio(ratio: number | null) {
  try {
    if (ratio === null) window.localStorage.removeItem(WORKBENCH_SPLIT_STORAGE_KEY);
    else window.localStorage.setItem(WORKBENCH_SPLIT_STORAGE_KEY, String(ratio));
  } catch {
    // プライベートモード等で保存できなくてもドラッグ操作自体は動かす
  }
}

/**
 * PC 表示（1100px 以上の 2 ペイン）で編集ペインと画像ペインの幅比率を D&D / キーボードで変更するフック。
 * 右ペイン（画像ペイン）の割合を `localStorage` に保存し、極端に潰れないよう CSS `clamp()` で上下限を守る。
 */
export function useWorkbenchSplit(workbenchRef: RefObject<HTMLDivElement | null>) {
  const [ratio, setRatio] = useState<number | null>(() => loadSavedRatio());
  const [dragging, setDragging] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const latestRatioRef = useRef<number | null>(ratio);
  latestRatioRef.current = ratio;

  const updateFromClientX = useCallback(
    (clientX: number): number | null => {
      const el = workbenchRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const next = clampRatio((rect.right - clientX) / rect.width);
      latestRatioRef.current = next;
      setRatio(next);
      return next;
    },
    [workbenchRef],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      pointerIdRef.current = e.pointerId;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      updateFromClientX(e.clientX);
    },
    [updateFromClientX],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== e.pointerId) return;
      updateFromClientX(e.clientX);
    },
    [updateFromClientX],
  );

  const finishDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    saveRatio(latestRatioRef.current);
  }, []);

  const reset = useCallback(() => {
    latestRatioRef.current = null;
    setRatio(null);
    saveRatio(null);
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const current = latestRatioRef.current ?? DEFAULT_ARIA_PERCENT / 100;
      let next: number | null = null;
      if (e.key === 'ArrowLeft') next = clampRatio(current + KEYBOARD_STEP);
      else if (e.key === 'ArrowRight') next = clampRatio(current - KEYBOARD_STEP);
      else if (e.key === 'Home') next = MAX_GENERATE_RATIO;
      else if (e.key === 'End') next = MIN_GENERATE_RATIO;
      else if (e.key === 'Enter') {
        e.preventDefault();
        reset();
        return;
      }
      if (next === null) return;
      e.preventDefault();
      latestRatioRef.current = next;
      setRatio(next);
      saveRatio(next);
    },
    [reset],
  );

  const ratioPercent = ratio === null ? DEFAULT_ARIA_PERCENT : Math.round(ratio * 100);
  const style: CSSProperties | undefined =
    ratio === null
      ? undefined
      : ({ '--workbench-generate-width': `clamp(340px, ${(ratio * 100).toFixed(1)}%, calc(100% - 440px))` } as CSSProperties);

  return {
    ratio,
    ratioPercent,
    dragging,
    style,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onKeyDown,
    reset,
  };
}
