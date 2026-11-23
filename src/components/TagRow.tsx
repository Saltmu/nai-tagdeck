import { memo, useCallback, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PromptCategoryKey, TargetId, WorkTag } from '../types';
import { categoryLabel } from '../lib/categories';
import { WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP, clampWeight } from '../lib/prompt';
import { aliasMatchesQuery, highlightTag } from '../lib/tagSearch';
import { splitInteraction } from '../lib/interaction';
import { normalize } from '../lib/tagText';
import { WeightInput } from './WeightInput';
import { BookPlusIcon, CheckIcon, CloseIcon, EditIcon } from './icons';

export interface MoveTargetOption {
  target: TargetId;
  category: PromptCategoryKey;
  label: string;
}

export interface MoveTargetGroup {
  id: TargetId;
  label: string;
  options: readonly MoveTargetOption[];
}

interface Props {
  tag: WorkTag;
  onToggle: (id: string) => void;
  onWeight: (id: string, weight: number) => void;
  onEdit: (id: string, tag: string) => string | null;
  onRemove: (id: string) => void;
  /** 辞書に登録されている日本語名・よみ。 */
  aliases?: string | readonly string[];
  /** 辞書にないタグのときだけ true。 */
  canRegister?: boolean;
  onRegister?: (tag: WorkTag) => void;
  /** 未分類カテゴリからの移動先一覧。 */
  moveDestinations?: readonly PromptCategoryKey[];
  /** 単語ベクトルで推定した移動先候補カテゴリ（ベースの未分類行に表示）。 */
  suggestedCategory?: PromptCategoryKey;
  onMoveCategory?: (id: string, to: PromptCategoryKey) => void;
  /** 編集モードで表示するカテゴリ・ターゲット移動先一覧。 */
  moveTargets?: readonly MoveTargetGroup[];
  onMoveTag?: (id: string, toTarget: TargetId, toCategory: PromptCategoryKey) => void;
  /** 検索語。一致した範囲を目立たせる。 */
  query?: string;
  /** 並べ替えモード。 */
  sorting?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMove?: (id: string, delta: -1 | 1) => void;
  /** 「||」をつかんで動かしている間、ポインターの縦位置を渡す。 */
  onDrag?: (id: string, clientY: number) => void;
}

function moveOptionKey(target: TargetId, category: PromptCategoryKey): string {
  return JSON.stringify([target, category]);
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const parts = highlightTag(text, query);
  return (
    <>
      {parts.map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
    </>
  );
}

function TagLabel({ tag, query, title }: { tag: string; query: string; title?: string }) {
  return (
    <span className="tag-name" title={title || undefined}>
      <HighlightText text={tag} query={query} />
    </span>
  );
}

function AliasLabel({ alias, query }: { alias: string; query: string }) {
  return (
    <span className="tag-alias">
      <HighlightText text={alias} query={query} />
    </span>
  );
}

export const TagRow = memo(function TagRow({
  tag,
  onToggle,
  onWeight,
  onEdit,
  onRemove,
  aliases,
  canRegister,
  onRegister,
  moveDestinations,
  suggestedCategory,
  onMoveCategory,
  moveTargets,
  onMoveTag,
  query = '',
  sorting = false,
  canMoveUp = false,
  canMoveDown = false,
  onMove,
  onDrag,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.tag);
  const [pendingMove, setPendingMove] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const errorId = useId();
  // ドラッグ中は行の DOM が動いてポインターのキャプチャが外れる（上へ動かすとき）ので、window で追う。
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging(true);
    const id = tag.id;
    const move = (ev: PointerEvent) => onDragRef.current?.(id, ev.clientY);
    const end = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const handleWeightChange = useCallback((weight: number) => onWeight(tag.id, weight), [onWeight, tag.id]);
  const step = (delta: number) => onWeight(tag.id, clampWeight(tag.weight + delta));
  const isEditing = editing && !sorting;
  const visibleMoveTargets = isEditing && moveTargets
    ? (moveTargets[0]?.id !== 'base' && splitInteraction(tag.tag).interaction !== null
        ? moveTargets.filter((group) => group.id !== 'base')
        : moveTargets)
    : undefined;
  const selectedMove = isEditing && pendingMove && visibleMoveTargets
    ? visibleMoveTargets
        .flatMap((group) => group.options)
        .find((opt) => moveOptionKey(opt.target, opt.category) === pendingMove)
    : undefined;
  const hasUnsavedRename = draft.trim() !== tag.tag.trim();
  const commit = () => {
    const result = onEdit(tag.id, draft);
    setError(result);
    if (!result) setEditing(false);
  };
  const commitMove = () => {
    if (!selectedMove || hasUnsavedRename || !onMoveTag) return;
    onMoveTag(tag.id, selectedMove.target, selectedMove.category);
  };
  const aliasList = typeof aliases === 'string' ? (aliases ? [aliases] : []) : (aliases ?? []);
  const aliasText = aliasList.join(' / ');
  const aliasMatched = aliasList.length > 0 && normalize(query).length > 0 && aliasMatchesQuery(aliasList, query);

  return (
    <li className={`tag-row${tag.enabled ? '' : ' is-off'}${editing && !sorting ? ' is-editing' : ''}`}>
      {editing && !sorting ? (
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
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
          />
          {visibleMoveTargets && visibleMoveTargets.length > 0 && onMoveTag && (
            <>
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
            </>
          )}
          <button type="button" className="icon-btn" aria-label="保存" title="保存" onClick={commit}>
            <CheckIcon />
          </button>
          <button type="button" className="icon-btn" aria-label="キャンセル" title="キャンセル" onClick={() => setEditing(false)}>
            <CloseIcon />
          </button>
          {aliasText && <span className="tag-alias tag-alias-edit">日本語名: {aliasText}</span>}
          {error && <span id={errorId} className="tag-edit-error" role="alert">{error}</span>}
        </div>
      ) : sorting ? (
        <span
          className={`tag-check drag-area${dragging ? ' is-dragging' : ''}`}
          onPointerDown={startDrag}
        >
          <span className="drag-handle" aria-hidden="true">||</span>
          <TagLabel tag={tag.tag} query={query} title={aliasText} />
          {aliasMatched && aliasText && <AliasLabel alias={aliasText} query={query} />}
        </span>
      ) : (
        <label className="tag-check">
          <input type="checkbox" checked={tag.enabled} onChange={() => onToggle(tag.id)} />
          <TagLabel tag={tag.tag} query={query} title={aliasText} />
          {aliasMatched && aliasText && <AliasLabel alias={aliasText} query={query} />}
        </label>
      )}

      {sorting ? (
        <div className="sort-control">
          <button
            type="button"
            className="icon-btn"
            aria-label={`${tag.tag} を上へ`}
            disabled={!canMoveUp}
            onClick={canMoveUp && onMove ? () => onMove(tag.id, -1) : undefined}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`${tag.tag} を下へ`}
            disabled={!canMoveDown}
            onClick={canMoveDown && onMove ? () => onMove(tag.id, 1) : undefined}
          >
            ↓
          </button>
        </div>
      ) : (
        <>
          {!editing && suggestedCategory && onMoveCategory && (
            <button
              type="button"
              className="btn btn-small tag-category-suggest"
              aria-label={`${tag.tag} を候補カテゴリ「${categoryLabel(suggestedCategory)}」へ移動`}
              title={`候補カテゴリ「${categoryLabel(suggestedCategory)}」へ移動`}
              onClick={() => onMoveCategory(tag.id, suggestedCategory)}
            >
              候補: {categoryLabel(suggestedCategory)}
            </button>
          )}
          {!editing && moveDestinations && onMoveCategory && (
            <select
              className="tag-category-move"
              aria-label={`${tag.tag} の移動先カテゴリ`}
              value=""
              onChange={(e) => {
                const to = moveDestinations.find((key) => key === e.target.value);
                if (to) onMoveCategory(tag.id, to);
              }}
            >
              <option value="" disabled>移動先</option>
              {moveDestinations.map((key) => <option key={key} value={key}>{categoryLabel(key)}</option>)}
            </select>
          )}
          {!editing && (
            <button type="button" className="icon-btn" aria-label={`${tag.tag} を編集`} title="このタグを編集"
              onClick={() => { setDraft(tag.tag); setPendingMove(''); setError(null); setEditing(true); }}>
              <EditIcon />
            </button>
          )}
          {canRegister && onRegister && !editing && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`${tag.tag} を辞書に登録`}
              title="このタグを辞書に登録"
              onClick={(event) => {
                // Safari はポインタのクリックでボタンへフォーカスしない。行を特定できるよう先に合わせる。
                event.currentTarget.focus();
                onRegister(tag);
              }}
            >
              <BookPlusIcon />
            </button>
          )}
          {!editing && (
          <div className="weight-control">
            <button
              type="button"
              className="step-btn"
              aria-label={`${tag.tag} を弱める`}
              disabled={tag.weight <= WEIGHT_MIN}
              onClick={() => step(-WEIGHT_STEP)}
            >
              −
            </button>
            <WeightInput value={tag.weight} label={`${tag.tag} の重み`} onChange={handleWeightChange} />
            <button
              type="button"
              className="step-btn"
              aria-label={`${tag.tag} を強める`}
              disabled={tag.weight >= WEIGHT_MAX}
              onClick={() => step(WEIGHT_STEP)}
            >
              ＋
            </button>
          </div>
          )}
          {!editing && (
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            aria-label={`${tag.tag} を削除`}
            onClick={() => onRemove(tag.id)}
          >
            ✕
          </button>
          )}
        </>
      )}
    </li>
  );
});
