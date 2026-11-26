import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

interface Options {
  enabled: boolean;
  onMove: (clientY: number) => void;
}

/**
 * ドラッグ中に DOM が移動してポインターキャプチャが外れるケースに対応するため、
 * window リスナーでポインターの縦位置を追跡する。
 */
export function useWindowPointerDrag({ enabled, onMove }: Options) {
  const [dragging, setDragging] = useState(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (enabled || !cleanupRef.current) return;
    cleanupRef.current();
    setDragging(false);
  }, [enabled]);

  const startDrag = useCallback((e: ReactPointerEvent) => {
    if (!enabled || e.button !== 0) return;
    e.preventDefault();
    cleanupRef.current?.();
    setDragging(true);
    const move = (ev: PointerEvent) => onMoveRef.current(ev.clientY);
    const end = () => {
      cleanupRef.current?.();
      setDragging(false);
    };
    const cleanup = () => {
      cleanupRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, [enabled]);

  return { dragging, startDrag };
}
