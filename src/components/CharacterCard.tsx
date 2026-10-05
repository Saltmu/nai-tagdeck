import type { Dispatch } from 'react';
import type { Character, CategoryKey, DictEntry, WeightSyntax, WorkTag } from '../types';
import type { WorkspaceAction } from '../lib/workspace';
import { CHARACTER_CATEGORY_KEYS } from '../lib/categories';
import { buildPrompt } from '../lib/prompt';
import { MAX_ENABLED_CHARACTERS } from '../lib/characterLimits';
import { CategorySection } from './CategorySection';

interface Props {
  character: Character;
  index: number;
  count: number;
  canEnable: boolean;
  dispatch: Dispatch<WorkspaceAction>;
  entries: DictEntry[];
  syntax: WeightSyntax;
  isKnown: (tag: string) => boolean;
  onCopy: (text: string, label: string) => void;
  onRegister: (tag: WorkTag, category: CategoryKey) => void;
}

export function CharacterCard({
  character,
  index,
  count,
  canEnable,
  dispatch,
  entries,
  syntax,
  isKnown,
  onCopy,
  onRegister,
}: Props) {
  const { id, enabled, tags } = character;
  const name = character.name.trim() || `キャラ${index + 1}`;
  const prompt = buildPrompt(tags, syntax, CHARACTER_CATEGORY_KEYS);
  const tagCount = CHARACTER_CATEGORY_KEYS.reduce((n, k) => n + tags[k].length, 0);

  const remove = () => {
    if (tagCount > 0 && !window.confirm(`「${name}」とそのタグ ${tagCount}件を削除しますか？`)) return;
    dispatch({ type: 'removeCharacter', id });
  };

  return (
    <section className={`character${enabled ? '' : ' is-off'}`} aria-label={name}>
      <div className="character-head">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!enabled && !canEnable}
          aria-label={`${name} を生成に含める`}
          title={!enabled && !canEnable
            ? `生成対象は最大${MAX_ENABLED_CHARACTERS}人です。他のキャラクターのチェックを外してください`
            : 'OFF にすると出力・生成から外します'}
          onChange={() => dispatch({ type: 'toggleCharacter', id })}
        />
        <input
          className="character-name"
          value={character.name}
          placeholder={`キャラ${index + 1}`}
          aria-label="キャラクターの呼び名（プロンプトには出力しません）"
          onChange={(e) => dispatch({ type: 'renameCharacter', id, name: e.target.value })}
        />
        <div className="head-actions">
          <button type="button" className="btn btn-small" disabled={!prompt} onClick={() => onCopy(prompt, name)}>
            コピー
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`${name} を上へ`}
            disabled={index === 0}
            onClick={() => dispatch({ type: 'moveCharacter', id, delta: -1 })}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`${name} を下へ`}
            disabled={index === count - 1}
            onClick={() => dispatch({ type: 'moveCharacter', id, delta: 1 })}
          >
            ↓
          </button>
          <button type="button" className="icon-btn icon-btn-danger" aria-label={`${name} を削除`} onClick={remove}>
            ✕
          </button>
        </div>
      </div>

      <div className="category-grid">
        {CHARACTER_CATEGORY_KEYS.map((key) => (
          <CategorySection
            key={key}
            target={id}
            scopeLabel={name}
            category={key}
            tags={tags[key]}
            dispatch={dispatch}
            entries={entries}
            syntax={syntax}
            isKnown={isKnown}
            onCopy={onCopy}
            onRegister={onRegister}
          />
        ))}
      </div>
    </section>
  );
}
