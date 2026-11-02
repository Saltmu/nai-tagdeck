import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { WorkTag } from '../types';
import { WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP, clampWeight } from '../lib/prompt';
import { WeightInput } from './WeightInput';
import { BookPlusIcon, CheckIcon, CloseIcon, EditIcon } from './icons';

interface Props {
  tag: WorkTag;
  onToggle: () => void;
  onWeight: (weight: number) => void;
  onEdit: (tag: string) => string | null;
  onRemove: () => void;
  /** 辞書にないタグのときだけ渡す。 */
  onRegister?: () => void;
  /** 並べ替えモードのときだけ渡す（null は端で動かせない）。 */
  sorting?: {
    onUp: (() => void) | null;
    onDown: (() => void) | null;
    /** 「||」をつかんで動かしている間、ポインターの縦位置を渡す。 */
    onDrag: (clientY: number) => void;
  };
}

export function TagRow({ tag, onToggle, onWeight, onEdit, onRemove, onRegister, sorting }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.tag);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const errorId = useId();
  // ドラッグ中は行の DOM が動いてポインターのキャプチャが外れる（上へ動かすとき）ので、window で追う。
  // 並びが変わるたびに onDrag の中身（自分の位置）が変わるため、最新のものを ref 経由で呼ぶ
  const onDragRef = useRef(sorting?.onDrag);
  onDragRef.current = sorting?.onDrag;
  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => onDragRef.current?.(ev.clientY);
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
  const step = (delta: number) => onWeight(clampWeight(tag.weight + delta));
  const commit = () => {
    const result = onEdit(draft);
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
          <span className="tag-name">{tag.tag}</span>
        </span>
      ) : (
        <label className="tag-check">
          <input type="checkbox" checked={tag.enabled} onChange={onToggle} />
          <span className="tag-name">{tag.tag}</span>
        </label>
      )}

      {sorting ? (
        <div className="sort-control">
          <button
            type="button"
            className="icon-btn"
            aria-label={`${tag.tag} を上へ`}
            disabled={!sorting.onUp}
            onClick={sorting.onUp ?? undefined}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`${tag.tag} を下へ`}
            disabled={!sorting.onDown}
            onClick={sorting.onDown ?? undefined}
          >
            ↓
          </button>
        </div>
      ) : (
        <>
          {!editing && (
            <button type="button" className="icon-btn" aria-label={`${tag.tag} を編集`} title="このタグを編集"
              onClick={() => { setDraft(tag.tag); setError(null); setEditing(true); }}>
              <EditIcon />
            </button>
          )}
          {onRegister && !editing && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`${tag.tag} を辞書に登録`}
              title="このタグを辞書に登録"
              onClick={onRegister}
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
            <WeightInput value={tag.weight} label={`${tag.tag} の重み`} onChange={onWeight} />
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
            onClick={onRemove}
          >
            ✕
          </button>
        </>
      )}
    </li>
  );
}
