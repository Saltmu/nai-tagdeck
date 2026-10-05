import type { WorkTag } from '../types';
import { WeightInput } from './WeightInput';

interface Props {
  tag: WorkTag;
  onToggle: () => void;
  onWeight: (weight: number) => void;
  onRemove: () => void;
  /** 辞書にないタグのときだけ渡す。 */
  onRegister?: () => void;
}

export function TagRow({ tag, onToggle, onWeight, onRemove, onRegister }: Props) {
  return (
    <li className={`tag-row${tag.enabled ? '' : ' is-off'}`}>
      <label className="tag-check">
        <input type="checkbox" checked={tag.enabled} onChange={onToggle} />
        <span className="tag-name">{tag.tag}</span>
      </label>
      {onRegister && (
        <button type="button" className="btn btn-small btn-ghost" title="このタグを辞書に登録" onClick={onRegister}>
          ＋辞書
        </button>
      )}
      <WeightInput value={tag.weight} label={`${tag.tag} の重み`} onChange={onWeight} />
      <button type="button" className="icon-btn icon-btn-danger" aria-label={`${tag.tag} を削除`} onClick={onRemove}>
        ✕
      </button>
    </li>
  );
}
