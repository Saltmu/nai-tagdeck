import { useCallback, useRef, useState, type Dispatch } from 'react';
import type { TargetId, WorkTag, Workspace, WorkspaceCategoryKey } from '../types';
import { tagsOf, type WorkspaceAction } from '../lib/workspace';

/** 削除したタグと、元の所属・位置。 */
export interface RemovedTag {
  target: TargetId;
  category: WorkspaceCategoryKey;
  tag: WorkTag;
  index: number;
}

/**
 * タグ行の削除を取り消せるようにする。削除は今までどおり即座に反映し、削除したタグを溜めておく。
 * 溜めたタグは、プリセット読み込み・新規作成・バックアップ復元などの置き換えと、元のキャラの削除で破棄する。
 */
export function useTagUndo(
  workspace: Workspace,
  dispatch: Dispatch<WorkspaceAction>,
  notify: (message: string) => void,
) {
  const [removed, setRemoved] = useState<RemovedTag[]>([]);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const trackedDispatch = useCallback<Dispatch<WorkspaceAction>>(
    (action) => {
      if (action.type === 'remove' && action.undo) {
        const tags = tagsOf(workspaceRef.current, action.target, action.category);
        const index = tags?.findIndex((t) => t.id === action.id) ?? -1;
        if (tags && index >= 0) {
          const item: RemovedTag = { target: action.target, category: action.category, tag: tags[index]!, index };
          setRemoved((prev) => (prev.some((r) => r.tag.id === item.tag.id) ? prev : [...prev, item]));
        }
      } else if (action.type === 'replace') {
        setRemoved([]);
      } else if (action.type === 'removeCharacter') {
        setRemoved((prev) => (prev.some((r) => r.target === action.id) ? prev.filter((r) => r.target !== action.id) : prev));
      }
      dispatch(action);
    },
    [dispatch],
  );

  const undo = useCallback(() => {
    if (removed.length === 0) return;
    // 消した順の逆に戻すと、記録した位置がそのまま合う
    for (const r of [...removed].reverse()) {
      dispatch({ type: 'restore', target: r.target, category: r.category, tag: r.tag, index: r.index });
    }
    notify(removed.length === 1 ? `「${removed[0]!.tag.tag}」を元に戻しました` : `${removed.length}件のタグを元に戻しました`);
    setRemoved([]);
  }, [removed, dispatch, notify]);

  const dismiss = useCallback(() => setRemoved([]), []);

  return { removed, dispatch: trackedDispatch, undo, dismiss };
}
