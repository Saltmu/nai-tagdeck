import type { WorkTag } from '../types';
import { WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP, clampWeight } from '../lib/prompt';
import { WeightInput } from './WeightInput';

interface Props {
  tag: WorkTag;
  onToggle: () => void;
  onWeight: (weight: number) => void;
  onRemove: () => void;
  /** 辞書にないタグのときだけ渡す。 */
  onRegister?: () => void;
  /** 並べ替えモードのときだけ渡す（null は端で動かせない）。 */
  sorting?: { onUp: (() => void) | null; onDown: (() => void) | null };
}

export function TagRow({ tag, onToggle, onWeight, onRemove, onRegister, sorting }: Props) {
  const step = (delta: number) => onWeight(clampWeight(tag.weight + delta));

  return (
    <li className={`tag-row${tag.enabled ? '' : ' is-off'}`}>
      <label className="tag-check">
        <input type="checkbox" checked={tag.enabled} onChange={onToggle} />
        <span className="tag-name">{tag.tag}</span>
      </label>

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
          {onRegister && (
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
