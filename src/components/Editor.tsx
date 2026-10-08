import { useCallback, useMemo, type Dispatch } from 'react';
import type { CategoryKey, WeightSyntax, WorkTag, Workspace } from '../types';
import type { Dictionary } from '../hooks/useDictionary';
import { BASE, MAX_CHARACTERS, MAX_ENABLED_CHARACTERS, type WorkspaceAction } from '../lib/workspace';
import { CATEGORY_KEYS } from '../lib/categories';
import { normalize } from '../lib/suggest';
import { newId } from '../lib/id';
import { pairedInteraction } from '../lib/interaction';
import { CategorySection } from './CategorySection';
import { CharacterCard } from './CharacterCard';
import { PresetBar } from './PresetBar';
import { useDialogs } from './Dialogs';
import type { PresetStore } from '../hooks/usePresets';

import { useEditorSelection } from '../hooks/useEditorSelection';

/** ベースの品質でよく使うタグ（公式の Quality Tags と定番）。ボタンで付け外しする。 */
const QUALITY_PICKS = ['masterpiece', 'best quality', 'amazing quality', 'very aesthetic', 'absurdres', 'no text'] as const;

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
  const dialogs = useDialogs();

  /** キャラ同士の動作を追加したら、まだ対のタグを持っていない相手に付けるか尋ねる。 */
  const offerPair = async (fromId: string, tag: string) => {
    const pair = pairedInteraction(tag);
    if (!pair) return;
    const key = normalize(pair);
    const others = characters
      .map((c, i) => ({ c, name: c.name.trim() || `キャラ${i + 1}` }))
      .filter(({ c }) => c.id !== fromId && !c.tags.pose.some((t) => normalize(t.tag) === key))
      // 生成対象のキャラを先に並べる
      .sort((a, b) => Number(b.c.enabled) - Number(a.c.enabled));
    if (others.length === 0) return;
    const target = await dialogs.choose(
      `相手のキャラクターのポーズに「${pair}」を追加しますか？`,
      others.map(({ c, name }, i) => ({ value: c.id, label: `${name}に追加`, primary: i === 0 })),
    );
    if (!target) return;
    dispatch({ type: 'add', target, category: 'pose', tag: pair });
    notify(`${others.find(({ c }) => c.id === target)!.name}に「${pair}」を追加しました`);
  };

  const enabledCount = characters.filter((c) => c.enabled).length;

  const { selected, select } = useEditorSelection(characters.map((c) => c.id), loaded);
  const activeIndex = characters.findIndex((c) => c.id === selected);
  const active = activeIndex >= 0 ? characters[activeIndex] : undefined;

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
        {characters.map((c, i) => {
          const name = c.name.trim() || `キャラ${i + 1}`;
          const locked = !c.enabled && enabledCount >= MAX_ENABLED_CHARACTERS;
          return (
            <div key={c.id} className="editor-tab-wrap" role="presentation">
              <input
                type="checkbox"
                className="editor-tab-check"
                checked={c.enabled}
                disabled={locked}
                aria-label={`${name} を生成に含める`}
                title={
                  locked
                    ? `生成対象は最大${MAX_ENABLED_CHARACTERS}人です。他のキャラクターのチェックを外してください`
                    : 'OFF にすると出力・生成から外します'
                }
                onChange={() => dispatch({ type: 'toggleCharacter', id: c.id })}
              />
              <button
                type="button"
                role="tab"
                aria-selected={c.id === active?.id}
                className={`editor-tab editor-tab-character${c.enabled ? '' : ' is-off'}`}
                onClick={() => select(c.id)}
              >
                {name}
              </button>
            </div>
          );
        })}
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
          dispatch={dispatch}
          entries={dictionary.entries}
          syntax={syntax}
          isKnown={isKnown}
          onCopy={onCopy}
          onRegister={register}
          onPoseAdded={(tag) => void offerPair(active.id, tag)}
        />
      ) : (
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
              quickPicks={key === 'quality' ? QUALITY_PICKS : undefined}
              quickPicksMode="many"
            />
          ))}
        </div>
      )}

      <p className="hint">
        複数のキャラクターを描くときは、タブ右端の「＋」でキャラクターを追加し、キャラクターごとにタグを分けて登録します（V4 以降のキャラクタープロンプト）。
        人数（2girls など）や背景・画風はベースに書き、各キャラは「被写体」の girl / boy / other ボタンで種類を選びます（人数は付けません）。
        キャラ同士の動作はそれぞれのキャラの「ポーズ」に書き、する側に source#、される側に target#、お互いなら両方に mutual# を付けます（例: source#hug と
        target#hug、両方に mutual#holding hands）。「ポーズ」の入力欄の上のボタンで付けられます。
      </p>

      <p className="hint">
        保存 {characters.length}/{MAX_CHARACTERS} · 生成対象 {enabledCount}/{MAX_ENABLED_CHARACTERS}
      </p>
    </div>
  );
}
