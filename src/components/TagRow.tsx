import { useId, useState } from 'react';
import type { WorkTag } from '../types';
import { WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP, clampWeight } from '../lib/prompt';
import { WeightInput } from './WeightInput';

interface Props {
  tag: WorkTag;
  onToggle: () => void;
  onWeight: (weight: number) => void;
  onEdit: (tag: string) => string | null;
  onRemove: () => void;
  /** 辞書にないタグのときだけ渡す。 */
  onRegister?: () => void;
  /** 並べ替えモードのときだけ渡す（null は端で動かせない）。 */
  sorting?: { onUp: (() => void) | null; onDown: (() => void) | null };
}

export function TagRow({ tag, onToggle, onWeight, onEdit, onRemove, onRegister, sorting }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.tag);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
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
          <button type="button" className="btn btn-small" onClick={commit}>保存</button>
          <button type="button" className="btn btn-small" onClick={() => setEditing(false)}>キャンセル</button>
          {error && <span id={errorId} className="tag-edit-error" role="alert">{error}</span>}
        </div>
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
            <button type="button" className="btn btn-small" aria-label={`${tag.tag} を編集`}
              onClick={() => { setDraft(tag.tag); setError(null); setEditing(true); }}>
              編集
            </button>
          )}
          {onRegister && !editing && (
            <button
              type="button"
              className="btn btn-small btn-ghost"
              title="このタグを辞書に登録"
              onClick={onRegister}
            >
              ＋辞書
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
