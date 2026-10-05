import { useCallback, useMemo, type Dispatch } from 'react';
import type { CategoryKey, WeightSyntax, WorkTag, Workspace } from '../types';
import type { Dictionary } from '../hooks/useDictionary';
import { BASE, MAX_CHARACTERS, MAX_ENABLED_CHARACTERS, type WorkspaceAction } from '../lib/workspace';
import { CATEGORY_KEYS } from '../lib/categories';
import { normalize } from '../lib/suggest';
import { newId } from '../lib/id';
import { CategorySection } from './CategorySection';
import { CharacterCard } from './CharacterCard';
import { PresetBar } from './PresetBar';
import type { PresetStore } from '../hooks/usePresets';

interface Props {
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  loaded: boolean;
  dictionary: Dictionary;
  syntax: WeightSyntax;
  onCopy: (text: string, label: string) => void;
  notify: (message: string) => void;
  presets: PresetStore;
}

export function Editor({
  workspace,
  dispatch,
  loaded,
  dictionary,
  syntax,
  onCopy,
  notify,
  presets,
}: Props) {
  const knownTags = useMemo(
    () => new Set(dictionary.entries.map((e) => normalize(e.tag))),
    [dictionary.entries],
  );
  const isKnown = useCallback((tag: string) => knownTags.has(normalize(tag)), [knownTags]);

  const { save } = dictionary;
  const register = useCallback(
    async (tag: WorkTag, category: CategoryKey) => {
      await save({
        id: newId(),
        tag: tag.tag,
        category,
        alias: '',
        default_weight: tag.weight,
        sort_order: 0,
        updated_at: '',
      });
      notify(`「${tag.tag}」を辞書に登録しました`);
    },
    [save, notify],
  );

  const { characters } = workspace;
  const enabledCount = characters.filter((c) => c.enabled).length;

  return (
    <div className="editor" aria-busy={!loaded}>
      <PresetBar store={presets} workspace={workspace} dispatch={dispatch} notify={notify} />

      <h2 className="section-title">ベース</h2>
      <div className="category-grid">
        {CATEGORY_KEYS.map((key) => (
          <CategorySection
            key={key}
            target={BASE}
            category={key}
            tags={workspace.base[key]}
            dispatch={dispatch}
            entries={dictionary.entries}
            syntax={syntax}
            isKnown={isKnown}
            onCopy={onCopy}
            onRegister={register}
          />
        ))}
      </div>

      <div className="section-head">
        <h2 className="section-title">
          キャラクター
          <span className="count">
            保存 {characters.length}/{MAX_CHARACTERS} · 生成対象 {enabledCount}/{MAX_ENABLED_CHARACTERS}
          </span>
        </h2>
        <button
          type="button"
          className="btn"
          disabled={characters.length >= MAX_CHARACTERS}
          onClick={() => dispatch({ type: 'addCharacter' })}
        >
          ＋ キャラクターを追加
        </button>
      </div>
      {characters.length === 0 ? (
        <p className="hint">
          複数のキャラクターを描くときは、キャラクターごとにタグを分けて登録します（V4 以降のキャラクタープロンプト）。
          人数は付けずに girl / boy / other と書き、キャラ同士の動作は source# / target# / mutual# を付けます。
        </p>
      ) : (
        characters.map((c, i) => (
          <CharacterCard
            key={c.id}
            character={c}
            index={i}
            count={characters.length}
            canEnable={enabledCount < MAX_ENABLED_CHARACTERS}
            dispatch={dispatch}
            entries={dictionary.entries}
            syntax={syntax}
            isKnown={isKnown}
            onCopy={onCopy}
            onRegister={register}
          />
        ))
      )}
    </div>
  );
}
