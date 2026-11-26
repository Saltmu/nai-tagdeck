import { useId, useState } from 'react';
import type { PromptCategoryKey, TargetId, WorkTag } from '../types';
import { splitInteraction } from '../lib/interaction';
import type { MoveTargetGroup } from './TagRow';
import { CheckIcon, CloseIcon } from './icons';

function moveOptionKey(target: TargetId, category: PromptCategoryKey): string {
  return JSON.stringify([target, category]);
}

interface Props {
  tag: WorkTag;
  aliasText: string;
  moveTargets?: readonly MoveTargetGroup[];
  onEdit: (id: string, tag: string) => string | null;
  onMoveTag?: (id: string, toTarget: TargetId, toCategory: PromptCategoryKey) => void;
  onCancel: () => void;
}

export function TagRowEditor({ tag, aliasText, moveTargets, onEdit, onMoveTag, onCancel }: Props) {
  const [draft, setDraft] = useState(tag.tag);
  const [pendingMove, setPendingMove] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const visibleMoveTargets = moveTargets
    ? (moveTargets[0]?.id !== 'base' && splitInteraction(tag.tag).interaction !== null
        ? moveTargets.filter((group) => group.id !== 'base')
        : moveTargets)
    : undefined;
  const selectedMove = pendingMove && visibleMoveTargets
    ? visibleMoveTargets
        .flatMap((group) => group.options)
        .find((opt) => moveOptionKey(opt.target, opt.category) === pendingMove)
    : undefined;
  const hasUnsavedRename = draft.trim() !== tag.tag.trim();

  const commit = () => {
    const result = onEdit(tag.id, draft);
    setError(result);
    if (!result) onCancel();
  };

  const commitMove = () => {
    if (!selectedMove || hasUnsavedRename || !onMoveTag) return;
    onMoveTag(tag.id, selectedMove.target, selectedMove.category);
  };

  return (
    <div className="tag-edit">
      <input
        type="text"
        aria-label={`${tag.tag} のタグを編集`}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        value={draft}
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
      />
      <button type="button" className="icon-btn" aria-label="保存" title="保存" onClick={commit}>
        <CheckIcon />
      </button>
      <button type="button" className="icon-btn" aria-label="キャンセル" title="キャンセル" onClick={onCancel}>
        <CloseIcon />
      </button>
      {/* 移動はめったに使わないため折りたたみに入れ、編集行の表には入力と✓／×だけを残す */}
      {visibleMoveTargets && visibleMoveTargets.length > 0 && onMoveTag && (
        <details className="accordion tag-edit-move-details">
          <summary>カテゴリ移動</summary>
          <div className="accordion-body">
            <select
              className="tag-edit-move"
              aria-label={`${tag.tag} の移動先カテゴリ`}
              value={selectedMove ? pendingMove : ''}
              onChange={(e) => setPendingMove(e.target.value)}
            >
              <option value="" disabled>カテゴリ移動</option>
              {visibleMoveTargets.length === 1
                ? visibleMoveTargets[0]!.options.map((opt) => {
                    const key = moveOptionKey(opt.target, opt.category);
                    return <option key={key} value={key}>{opt.label}</option>;
                  })
                : visibleMoveTargets.map((group) => (
                    <optgroup key={group.id} label={group.label}>
                      {group.options.map((opt) => {
                        const key = moveOptionKey(opt.target, opt.category);
                        return <option key={key} value={key}>{`${group.label} / ${opt.label}`}</option>;
                      })}
                    </optgroup>
                  ))}
            </select>
            <button
              type="button"
              className="btn btn-small"
              aria-label={`${tag.tag} を移動`}
              title={hasUnsavedRename ? 'タグ名の変更を先に保存してください' : undefined}
              disabled={!selectedMove || hasUnsavedRename}
              onClick={commitMove}
            >
              移動
            </button>
            <p className="hint">移動先を選んで「移動」を押すと移動します。タグ名の変更とは別に確定します。</p>
            {hasUnsavedRename && (
              <p className="hint" role="note">タグ名を変更したままでは移動できません。先に✓で保存してください。</p>
            )}
          </div>
        </details>
      )}
      <p className="tag-edit-hint">Enter で保存・Esc でキャンセル</p>
      {aliasText && <span className="tag-alias tag-alias-edit">日本語名: {aliasText}</span>}
      {error && <span id={errorId} className="tag-edit-error" role="alert">{error}</span>}
    </div>
  );
}
