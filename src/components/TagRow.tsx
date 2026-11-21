import { memo, useCallback, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PromptCategoryKey, WorkTag } from '../types';
import { categoryLabel } from '../lib/categories';
import { WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP, clampWeight } from '../lib/prompt';
import { highlightTag } from '../lib/tagSearch';
import { WeightInput } from './WeightInput';
import { BookPlusIcon, CheckIcon, CloseIcon, EditIcon } from './icons';

interface Props {
  tag: WorkTag;
  onToggle: (id: string) => void;
  onWeight: (id: string, weight: number) => void;
  onEdit: (id: string, tag: string) => string | null;
  onRemove: (id: string) => void;
  /** 辞書にないタグのときだけ true。 */
  canRegister?: boolean;
  onRegister?: (tag: WorkTag) => void;
  /** 未分類カテゴリからの移動先一覧。 */
  moveDestinations?: readonly PromptCategoryKey[];
  /** 単語ベクトルで推定した移動先候補カテゴリ（ベースの未分類行に表示）。 */
  suggestedCategory?: PromptCategoryKey;
  onMoveCategory?: (id: string, to: PromptCategoryKey) => void;
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

function TagLabel({ tag, query }: { tag: string; query: string }) {
  const parts = highlightTag(tag, query);
  return (
    <span className="tag-name">
      {parts.map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
    </span>
  );
}

export const TagRow = memo(function TagRow({
  tag,
  onToggle,
  onWeight,
  onEdit,
  onRemove,
  canRegister,
  onRegister,
  moveDestinations,
  suggestedCategory,
  onMoveCategory,
  query = '',
  sorting = false,
  canMoveUp = false,
  canMoveDown = false,
  onMove,
  onDrag,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.tag);
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
  const commit = () => {
    const result = onEdit(tag.id, draft);
    setError(result);
    if (!result) setEditing(false);
  };

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
          <button type="button" className="icon-btn" aria-label="保存" title="保存" onClick={commit}>
            <CheckIcon />
          </button>
          <button type="button" className="icon-btn" aria-label="キャンセル" title="キャンセル" onClick={() => setEditing(false)}>
            <CloseIcon />
          </button>
          {error && <span id={errorId} className="tag-edit-error" role="alert">{error}</span>}
        </div>
      ) : sorting ? (
        <span
          className={`tag-check drag-area${dragging ? ' is-dragging' : ''}`}
          onPointerDown={startDrag}
        >
          <span className="drag-handle" aria-hidden="true">||</span>
          <TagLabel tag={tag.tag} query={query} />
        </span>
      ) : (
        <label className="tag-check">
          <input type="checkbox" checked={tag.enabled} onChange={() => onToggle(tag.id)} />
          <TagLabel tag={tag.tag} query={query} />
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
              onClick={() => { setDraft(tag.tag); setError(null); setEditing(true); }}>
              <EditIcon />
            </button>
          )}
          {canRegister && onRegister && !editing && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`${tag.tag} を辞書に登録`}
              title="このタグを辞書に登録"
              onClick={() => onRegister(tag)}
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
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            aria-label={`${tag.tag} を削除`}
            onClick={() => onRemove(tag.id)}
          >
            ✕
          </button>
        </>
      )}
    </li>
  );
});
