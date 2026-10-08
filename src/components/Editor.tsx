import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
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

const SELECTED_KEY = 'nai-tagdeck:editor-tab';

function loadSelected(): string {
  try {
    return window.localStorage.getItem(SELECTED_KEY) ?? BASE;
  } catch {
    return BASE;
  }
}

function saveSelected(id: string) {
  try {
    window.localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // 保存できなくてもタブ切替は動かす。
  }
}

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

  const [selected, setSelected] = useState(loadSelected);
  const select = (id: string) => {
    setSelected(id);
    saveSelected(id);
  };
  // 削除などで選択中のキャラクターが無くなったらベースに戻す。
  const activeIndex = characters.findIndex((c) => c.id === selected);
  const active = activeIndex >= 0 ? characters[activeIndex] : undefined;

  // キャラクターが増えたら追加されたタブへ、選択中が削除されたら左隣のタブ（先頭ならベース）へ移る。
  const prevIds = useRef(characters.map((c) => c.id));
  useEffect(() => {
    const before = prevIds.current;
    const last = characters[characters.length - 1];
    if (loaded) {
      if (last && characters.length > before.length) {
        select(last.id);
      } else if (characters.length < before.length && !characters.some((c) => c.id === selected)) {
        const removedAt = before.indexOf(selected);
        if (removedAt >= 0) select((removedAt > 0 && before[removedAt - 1]) || BASE);
      }
    }
    prevIds.current = characters.map((c) => c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters.length]);

  return (
    <div className="editor" aria-busy={!loaded}>
      <PresetBar store={presets} workspace={workspace} dispatch={dispatch} notify={notify} />

      <div className="editor-tabs" role="tablist" aria-label="編集対象">
        <button
          type="button"
          role="tab"
          aria-selected={!active}
          className="editor-tab"
          onClick={() => select(BASE)}
        >
          ベース
        </button>
        {characters.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === active?.id}
            className={`editor-tab${c.enabled ? '' : ' is-off'}`}
            onClick={() => select(c.id)}
          >
            {c.name.trim() || `キャラ${i + 1}`}
          </button>
        ))}
        <button
          type="button"
          className="editor-tab editor-tab-add"
          aria-label="キャラクターを追加"
          title="キャラクターを追加"
          disabled={characters.length >= MAX_CHARACTERS}
          onClick={() => dispatch({ type: 'addCharacter' })}
        >
          ＋
        </button>
      </div>

      {active ? (
        <CharacterCard
          key={active.id}
          character={active}
          index={activeIndex}
          count={characters.length}
          canEnable={enabledCount < MAX_ENABLED_CHARACTERS}
          dispatch={dispatch}
          entries={dictionary.entries}
          syntax={syntax}
          isKnown={isKnown}
          onCopy={onCopy}
          onRegister={register}
        />
      ) : (
        <>
          <div className="category-grid editor-pane">
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
          {characters.length === 0 && (
            <p className="hint">
              複数のキャラクターを描くときは、タブ右端の「＋」でキャラクターを追加し、キャラクターごとにタグを分けて登録します（V4 以降のキャラクタープロンプト）。
              人数は付けずに girl / boy / other と書き、キャラ同士の動作は source# / target# / mutual# を付けます。
            </p>
          )}
        </>
      )}

      <p className="hint">
        保存 {characters.length}/{MAX_CHARACTERS} · 生成対象 {enabledCount}/{MAX_ENABLED_CHARACTERS}
      </p>
    </div>
  );
}
