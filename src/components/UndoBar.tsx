import type { RemovedTag } from '../hooks/useTagUndo';

interface Props {
  removed: RemovedTag[];
  onUndo: () => void;
  onDismiss: () => void;
}

/** タグを削除した後の取り消し通知。自動では消えず、続けて消したタグは1つにまとめる。 */
export function UndoBar({ removed, onUndo, onDismiss }: Props) {
  return (
    <div className="undo-bar-slot" role="status" aria-live="polite">
      {removed.length > 0 && (
        <div className="undo-bar">
          <span className="undo-bar-text">
            {removed.length === 1 ? `「${removed[0]!.tag.tag}」を削除しました` : `${removed.length}件のタグを削除しました`}
          </span>
          <button type="button" className="btn btn-small btn-primary" onClick={onUndo}>
            元に戻す
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={onDismiss}>
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}
