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
  return (
    <div className="undo-bar-slot">
      {open && (
        <div className="undo-bar" role="status" aria-live="polite">
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
