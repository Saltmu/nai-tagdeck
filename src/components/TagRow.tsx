import { memo, useCallback, useState } from 'react';
import type { PromptCategoryKey, TargetId, WorkTag } from '../types';
import { categoryLabel } from '../lib/categories';
import { WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP, clampWeight } from '../lib/prompt';
import { highlightTag } from '../lib/tagSearch';
import { useWindowPointerDrag } from '../hooks/useWindowPointerDrag';
import { TagRowEditor } from './TagRowEditor';
import { WeightInput } from './WeightInput';
import { BookPlusIcon, EditIcon } from './icons';

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
  const { dragging, startDrag } = useWindowPointerDrag({
    enabled: sorting,
    onMove: (clientY) => onDrag?.(tag.id, clientY),
  });
  const handleWeightChange = useCallback((weight: number) => onWeight(tag.id, weight), [onWeight, tag.id]);
  const step = (delta: number) => onWeight(tag.id, clampWeight(tag.weight + delta));
  const isEditing = editing && !sorting;
  const aliasList = typeof aliases === 'string' ? (aliases ? [aliases] : []) : (aliases ?? []);
  const aliasText = aliasList.join(' / ');

  return (
    <li className={`tag-row${tag.enabled ? '' : ' is-off'}${isEditing ? ' is-editing' : ''}`}>
      {isEditing ? (
        <TagRowEditor
          tag={tag}
          aliasText={aliasText}
          moveTargets={moveTargets}
          onEdit={onEdit}
          onMoveTag={onMoveTag}
          onCancel={() => setEditing(false)}
        />
      ) : sorting ? (
        <>
          <span
            className={`tag-check drag-area${dragging ? ' is-dragging' : ''}`}
            onPointerDown={startDrag}
          >
            <span className="drag-handle" aria-hidden="true">||</span>
            <TagLabel tag={tag.tag} query={query} title={aliasText} />
            {aliasText && <AliasLabel alias={aliasText} query={query} />}
          </span>
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
        </>
      ) : (
        <>
          <label className="tag-check">
            <input type="checkbox" checked={tag.enabled} onChange={() => onToggle(tag.id)} />
            <TagLabel tag={tag.tag} query={query} title={aliasText} />
            {aliasText && <AliasLabel alias={aliasText} query={query} />}
          </label>
          <button
            type="button"
            className="icon-btn"
            aria-label={`${tag.tag} を編集`}
            title="このタグを編集"
            onClick={() => setEditing(true)}
          >
            <EditIcon />
          </button>
          {canRegister && onRegister && (
            <button
              type="button"
              className="icon-btn tag-register-btn"
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
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            aria-label={`${tag.tag} を削除`}
            onClick={() => onRemove(tag.id)}
          >
            ✕
          </button>
          {/* 未分類行の移動系は通常カテゴリと同じ並び（編集・重み・削除）の後ろに置く */}
          {suggestedCategory && onMoveCategory && (
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
          {moveDestinations && onMoveCategory && (
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
        </>
      )}
    </li>
  );
});
