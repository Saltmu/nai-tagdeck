import { RedoIcon, UndoIcon } from './icons';

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  status: string;
}

/** 編集タブの横に置く、ワークスペース共通の操作履歴。 */
export function HistoryControls({ canUndo, canRedo, undo, redo, status }: Props) {
  return (
    <div className="editor-history" role="group" aria-label="編集履歴">
      <button
        type="button"
        className="icon-btn"
        aria-label="元に戻す"
        aria-disabled={!canUndo}
        title="元に戻す（Ctrl+Z / ⌘Z）"
        onClick={canUndo ? undo : undefined}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="やり直す"
        aria-disabled={!canRedo}
        title="やり直す（Ctrl+Shift+Z / ⌘Shift+Z）"
        onClick={canRedo ? redo : undefined}
      >
        <RedoIcon />
      </button>
      <span className="visually-hidden" role="status">{status}</span>
    </div>
  );
}
