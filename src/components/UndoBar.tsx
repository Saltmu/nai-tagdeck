import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  label: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDismiss: () => void;
}

/** 直前のワークスペース操作を 1 件ずつ取り消す・やり直す。 */
export function UndoBar({ open, label, canUndo, canRedo, onUndo, onRedo, onDismiss }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  // トーストをバーの上に置く。閉じているときは 0。
  useEffect(() => {
    if (!open) {
      document.documentElement.style.setProperty('--undo-offset', '0px');
      return;
    }
    const el = barRef.current;
    if (!el) return;
    const publish = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--undo-offset', `${height > 0 ? height + 8 : 0}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty('--undo-offset', '0px');
    };
  }, [open, label, canUndo, canRedo]);

  return (
    <div className="undo-bar-slot">
      {open && (
        <div ref={barRef} className="undo-bar" role="status" aria-live="polite">
          <span className="undo-bar-text">{canUndo ? label : '操作を取り消しました'}</span>
          {canUndo && (
            <button type="button" className="btn btn-small btn-primary" onClick={onUndo} title="Ctrl+Z または ⌘Z">
              元に戻す
            </button>
          )}
          {canRedo && (
            <button type="button" className="btn btn-small" onClick={onRedo} title="Ctrl+Shift+Z または ⌘Shift+Z">
              やり直す
            </button>
          )}
          <button type="button" className="btn btn-small btn-ghost" onClick={onDismiss}>
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}
