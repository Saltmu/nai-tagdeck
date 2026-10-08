import type { Dispatch } from 'react';
import type { Character, CategoryKey, DictEntry, WeightSyntax, WorkTag } from '../types';
import type { WorkspaceAction } from '../lib/workspace';
import { CHARACTER_CATEGORY_KEYS } from '../lib/categories';
import { buildPrompt } from '../lib/prompt';
import { CategorySection } from './CategorySection';
import { useDialogs } from './Dialogs';

/** キャラクタープロンプトの先頭に書く種類（人数は付けない）。 */
const CHARACTER_KINDS = ['girl', 'boy', 'other'] as const;

interface Props {
  character: Character;
  index: number;
  count: number;
  dispatch: Dispatch<WorkspaceAction>;
  entries: DictEntry[];
  syntax: WeightSyntax;
  isKnown: (tag: string) => boolean;
  onCopy: (text: string, label: string) => void;
  onRegister: (tag: WorkTag, category: CategoryKey) => void;
  /** ポーズにタグを追加したとき（キャラ同士の動作なら相手にも付けるか尋ねる）。 */
  onPoseAdded?: (tag: string) => void;
}

export function CharacterCard({
  character,
  index,
  count,
  dispatch,
  entries,
  syntax,
  isKnown,
  onCopy,
  onRegister,
  onPoseAdded,
}: Props) {
  const { id, enabled, tags } = character;
  const name = character.name.trim() || `キャラ${index + 1}`;
  const prompt = buildPrompt(tags, syntax, CHARACTER_CATEGORY_KEYS);
  const tagCount = CHARACTER_CATEGORY_KEYS.reduce((n, k) => n + tags[k].length, 0);

  const dialogs = useDialogs();
  const remove = async () => {
    if (
      tagCount > 0 &&
      !(await dialogs.confirm(`「${name}」とそのタグ ${tagCount}件を削除しますか？`, { okLabel: '削除', danger: true }))
    ) {
      return;
    }
    dispatch({ type: 'removeCharacter', id });
  };

  return (
    <section className={`character${enabled ? '' : ' is-off'}`} aria-label={name}>
      <div className="character-head">
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
            quickPicks={key === 'subject' ? CHARACTER_KINDS : undefined}
            title={key === 'subject' ? '被写体' : undefined}
            interactions={key === 'pose'}
            onAdded={key === 'pose' ? onPoseAdded : undefined}
          />
        ))}
      </div>
    </section>
  );
}
