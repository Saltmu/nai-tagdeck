import type { Dispatch } from 'react';
import type { CategoryKey, WorkTag } from '../types';
import type { WorkspaceAction } from '../lib/workspace';
import { WeightInput } from './WeightInput';

interface Props {
  tag: WorkTag;
  category: CategoryKey;
  dispatch: Dispatch<WorkspaceAction>;
  known: boolean;
  onRegister: (tag: WorkTag, category: CategoryKey) => void;
}

export function TagRow({ tag, category, dispatch, known, onRegister }: Props) {
  return (
    <li className={`tag-row${tag.enabled ? '' : ' is-off'}`}>
      <label className="tag-check">
        <input
          type="checkbox"
          checked={tag.enabled}
          onChange={() => dispatch({ type: 'toggle', category, id: tag.id })}
        />
        <span className="tag-name">{tag.tag}</span>
      </label>
      {!known && (
        <button
          type="button"
          className="btn btn-small btn-ghost"
          title="このタグを辞書に登録"
          onClick={() => onRegister(tag, category)}
        >
          ＋辞書
        </button>
      )}
      <WeightInput
        value={tag.weight}
        label={`${tag.tag} の重み`}
        onChange={(weight) => dispatch({ type: 'setWeight', category, id: tag.id, weight })}
      />
      <button
        type="button"
        className="icon-btn"
        aria-label={`${tag.tag} を削除`}
        onClick={() => dispatch({ type: 'remove', category, id: tag.id })}
      >
        ✕
      </button>
    </li>
  );
}
