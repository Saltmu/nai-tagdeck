import type { Dispatch } from 'react';
import type { Character, CategoryKey, DictEntry, WeightSyntax, WorkTag } from '../types';
import type { TagFilter } from '../lib/tagSearch';
import type { WorkspaceAction } from '../lib/workspace';
import { CHARACTER_CATEGORY_KEYS } from '../lib/categories';
import { MAX_CHARACTERS, MAX_ENABLED_CHARACTERS } from '../lib/characterLimits';
import { buildPrompt } from '../lib/prompt';
import { CategorySection } from './CategorySection';
import { CharacterCenterPicker, type PeerCharacterCenter } from './CharacterCenterPicker';
import { NumberField } from './NumberField';
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
  notify: (message: string) => void;
  onRegister: (tag: WorkTag, category: CategoryKey) => void;
  /** 個別指定がないキャラに付ける共通ネガティブ。 */
  sharedNegative: string;
  /** ポーズにタグを追加したとき（キャラ同士の動作なら相手にも付けるか尋ねる）。 */
  onPoseAdded?: (tag: string) => void;
  /** 表示中のタグ検索と ON 絞り込み。 */
  filter?: TagFilter;
  /** 生成対象が ON のキャラクター数。複製を OFF で足すときの案内に使う。 */
  enabledCount: number;
  /** 位置ピッカーの縦横比に使う出力画像サイズ。 */
  canvasSize?: { width: number; height: number };
  /** 位置ピッカー上に同時表示する他の ON キャラクター。 */
  peerCenters?: readonly PeerCharacterCenter[];
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
  notify,
  onRegister,
  sharedNegative,
  onPoseAdded,
  filter,
  enabledCount,
  canvasSize = { width: 832, height: 1216 },
  peerCenters = [],
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

  const atSaveLimit = count >= MAX_CHARACTERS;
  const duplicate = () => {
    if (atSaveLimit) return;
    dispatch({ type: 'duplicateCharacter', id });
    if (enabled && enabledCount >= MAX_ENABLED_CHARACTERS) {
      notify(`生成対象は最大${MAX_ENABLED_CHARACTERS}人のため、「${name}（コピー）」はOFFで追加しました`);
    }
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
            className="btn btn-small"
            aria-label={`${name} を複製`}
            title={`${name} を複製`}
            disabled={atSaveLimit}
            onClick={duplicate}
          >
            複製
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`${name} を左へ`}
            title={`${name} を左へ`}
            disabled={index === 0}
            onClick={() => dispatch({ type: 'moveCharacter', id, delta: -1 })}
          >
            ←
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`${name} を右へ`}
            title={`${name} を右へ`}
            disabled={index === count - 1}
            onClick={() => dispatch({ type: 'moveCharacter', id, delta: 1 })}
          >
            →
          </button>
          <button type="button" className="icon-btn icon-btn-danger" aria-label={`${name} を削除`} onClick={remove}>
            ✕
          </button>
        </div>
      </div>

      <div className="character-extra">
        <label className="check-line">
          <input
            type="checkbox"
            checked={character.negative !== undefined}
            onChange={(e) => dispatch({
              type: 'setCharacterNegative',
              id,
              negative: e.target.checked ? sharedNegative : null,
            })}
          />
          個別のネガティブを使う
        </label>
        {character.negative !== undefined && (
          <textarea
            rows={2}
            spellCheck={false}
            autoCapitalize="off"
            aria-label={`${name} の個別ネガティブ`}
            value={character.negative}
            onChange={(e) => dispatch({ type: 'setCharacterNegative', id, negative: e.target.value })}
          />
        )}
        {character.negative !== undefined && (
          <p className="hint">空欄にすると、このキャラにはネガティブを付けません。チェックを外すと共通の文面に戻します。</p>
        )}
        <label className="check-line">
          <input
            type="checkbox"
            checked={character.center !== undefined}
            onChange={(e) => dispatch({
              type: 'setCharacterCenter',
              id,
              center: e.target.checked ? { x: 0.5, y: 0.5 } : null,
            })}
          />
          位置を指定する
        </label>
        {character.center && (
          <CharacterCenterPicker
            characterName={name}
            center={character.center}
            canvasSize={canvasSize}
            peers={peerCenters}
            onChange={(center) => dispatch({
              type: 'setCharacterCenter',
              id,
              center,
            })}
          />
        )}
        {character.center && (
          <div className="center-grid">
            <label className="field" htmlFor={`${id}-x`}>
              <span>横（0 が左、1 が右）</span>
              <NumberField
                id={`${id}-x`}
                value={character.center.x}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => dispatch({
                  type: 'setCharacterCenter',
                  id,
                  center: { x: v ?? character.center!.x, y: character.center!.y },
                })}
              />
            </label>
            <label className="field" htmlFor={`${id}-y`}>
              <span>縦（0 が上、1 が下）</span>
              <NumberField
                id={`${id}-y`}
                value={character.center.y}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => dispatch({
                  type: 'setCharacterCenter',
                  id,
                  center: { x: character.center!.x, y: v ?? character.center!.y },
                })}
              />
            </label>
          </div>
        )}
        {character.center && (
          <p className="hint">位置を指定していないキャラは、この指定があるあいだ中央（0.5, 0.5）で送ります。</p>
        )}
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
            notify={notify}
            onRegister={onRegister}
            quickPicks={key === 'subject' ? CHARACTER_KINDS : undefined}
            title={key === 'subject' ? '被写体' : undefined}
            interactions={key === 'pose'}
            onAdded={key === 'pose' ? onPoseAdded : undefined}
            filter={filter}
          />
        ))}
      </div>
    </section>
  );
}
