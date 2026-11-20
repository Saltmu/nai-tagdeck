import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { CategoryKey, WeightSyntax, WorkTag, Workspace, WorkspaceCategoryKey } from '../types';
import type { Dictionary } from '../hooks/useDictionary';
import {
  BASE,
  MAX_CHARACTERS,
  MAX_ENABLED_CHARACTERS,
  NEGATIVE,
  defaultNegativeTags,
  type WorkspaceAction,
} from '../lib/workspace';
import { CHARACTER_CATEGORY_KEYS, PROMPT_CATEGORY_KEYS } from '../lib/categories';
import { saveCategoriesOpen } from '../lib/categoryOpen';
import { isTagFilterActive, visibleWorkTags, type TagFilter } from '../lib/tagSearch';
import { DEFAULT_CHARACTER_NEGATIVE } from '../lib/novelai';
import { normalize } from '../lib/suggest';
import { newId } from '../lib/id';
import { pairedInteraction } from '../lib/interaction';
import { CategorySection } from './CategorySection';
import { CharacterCard } from './CharacterCard';
import { PresetBar } from './PresetBar';
import { TagFilterBar } from './TagFilterBar';
import type { PromptSource } from './PromptImportDialog';
import { useDialogs } from './Dialogs';
import type { PresetStore } from '../hooks/usePresets';

import { useEditorSelection } from '../hooks/useEditorSelection';
import { usePngDrop } from '../hooks/usePngDrop';
import { useScrollMemory } from '../hooks/useScrollMemory';

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
  onPickPng?: () => void;
  onReadPng?: (source: PromptSource) => void;
  /** 個別指定がないキャラクターに付けるネガティブ。 */
  characterNegative: string;
  onCharacterNegativeChange: (value: string) => void;
  /** 編集画面を開いている（false の間は他の画面を表示している）。 */
  shown: boolean;
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
  onPickPng,
  onReadPng,
  characterNegative,
  onCharacterNegativeChange,
  shown,
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
  const charactersRef = useRef(characters);
  useLayoutEffect(() => {
    charactersRef.current = characters;
  });

  /** キャラ同士の動作を追加したら、まだ対のタグを持っていない相手に付けるか尋ねる。 */
  const offerPair = useCallback(
    async (fromId: string, tag: string) => {
      const pair = pairedInteraction(tag);
      if (!pair) return;
      const key = normalize(pair);
      const others = charactersRef.current
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
    },
    [dialogs, dispatch, notify],
  );

  const enabledCount = characters.filter((c) => c.enabled).length;

  const [tagQuery, setTagQuery] = useState('');
  const [onlyEnabledTags, setOnlyEnabledTags] = useState(false);
  const tagFilter = useMemo<TagFilter>(
    () => ({ query: tagQuery, onlyEnabled: onlyEnabledTags }),
    [tagQuery, onlyEnabledTags],
  );

  const { selected, select } = useEditorSelection(characters.map((c) => c.id), loaded);
  const negativeSelected = selected === NEGATIVE;
  const activeIndex = characters.findIndex((c) => c.id === selected);
  const active = activeIndex >= 0 ? characters[activeIndex] : undefined;
  const activeId = active?.id;
  const handlePoseAdded = useCallback(
    (tag: string) => {
      if (activeId) void offerPair(activeId, tag);
    },
    [activeId, offerPair],
  );
  const paneTarget = negativeSelected ? NEGATIVE : active?.id ?? BASE;
  const paneCategories: readonly WorkspaceCategoryKey[] = negativeSelected
    ? ['negative']
    : active
      ? CHARACTER_CATEGORY_KEYS
      : PROMPT_CATEGORY_KEYS;
  const paneTagLists: WorkTag[][] = negativeSelected
    ? [workspace.negative]
    : (active ? CHARACTER_CATEGORY_KEYS : PROMPT_CATEGORY_KEYS).map((key) => (active ? active.tags[key] : workspace.base[key]));
  const matchCount = isTagFilterActive(tagFilter)
    ? paneTagLists.reduce((sum, tags) => sum + visibleWorkTags(tags, tagFilter).length, 0)
    : null;

  // 編集対象のタブはスクロールしてもヘッダーの直下に残す。張り付いている間だけ見た目を変え、
  // スクロール位置の調整（visibleBounds）でも上を隠すものとして扱う
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsStuck, setTabsStuck] = useState(false);
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const header = document.querySelector<HTMLElement>('.app-header');
    const update = () => {
      const top = header ? header.getBoundingClientRect().bottom : 0;
      tabs.style.top = `${top}px`;
      setTabsStuck(tabs.getBoundingClientRect().top <= top + 0.5 && window.scrollY > 0);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    if (header) ro.observe(header);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, []);

  // ベース・ネガティブ・各キャラごとにスクロール位置を覚え、タブを切り替えたときや他の画面から戻ったときに戻す
  useScrollMemory(selected, shown, tabsRef);

  const { dragging, dropProps } = usePngDrop({
    enabled: !!onPickPng && !!onReadPng,
    onDropFile: (source) => onReadPng?.(source),
    onMultipleFiles: () => notify('PNG を1枚ずつドロップしてください'),
  });

  return (
    <div className={`editor${dragging ? ' is-dragging' : ''}`} aria-busy={!loaded} {...dropProps}>
      <PresetBar store={presets} workspace={workspace} dispatch={dispatch} notify={notify} onPickPng={onPickPng} />

      <div
        ref={tabsRef}
        className={`editor-tabs${tabsStuck ? ' is-stuck' : ''}`}
        role="tablist"
        aria-label="編集対象"
        data-occludes={tabsStuck ? '' : undefined}
      >
        <button
          type="button"
          role="tab"
          aria-selected={!active && !negativeSelected}
          className="editor-tab"
          onClick={() => select(BASE)}
        >
          ベース
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={negativeSelected}
          className="editor-tab editor-tab-negative"
          onClick={() => select(NEGATIVE)}
        >
          ネガティブ
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

      <TagFilterBar
        filter={tagFilter}
        matchCount={matchCount}
        onQueryChange={setTagQuery}
        onOnlyEnabledChange={setOnlyEnabledTags}
        onExpandAll={() => saveCategoriesOpen(paneTarget, paneCategories, true)}
        onCollapseAll={() => saveCategoriesOpen(paneTarget, paneCategories, false)}
      />

      {negativeSelected ? (
        <NegativePane
          tags={workspace.negative}
          dispatch={dispatch}
          entries={dictionary.entries}
          syntax={syntax}
          isKnown={isKnown}
          onCopy={onCopy}
          notify={notify}
          onRegister={register}
          characterNegative={characterNegative}
          onCharacterNegativeChange={onCharacterNegativeChange}
          filter={tagFilter}
        />
      ) : active ? (
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
          notify={notify}
          onRegister={register}
          sharedNegative={characterNegative}
          onPoseAdded={handlePoseAdded}
          filter={tagFilter}
        />
      ) : (
        <div className="category-grid editor-pane">
          {PROMPT_CATEGORY_KEYS.map((key) => (
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
              notify={notify}
              onRegister={register}
              quickPicks={key === 'quality' ? QUALITY_PICKS : undefined}
              quickPicksMode="many"
              filter={tagFilter}
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

interface NegativePaneProps {
  tags: WorkTag[];
  dispatch: Dispatch<WorkspaceAction>;
  entries: Dictionary['entries'];
  syntax: WeightSyntax;
  isKnown: (tag: string) => boolean;
  onCopy: (text: string, label: string) => void;
  notify: (message: string) => void;
  onRegister: (tag: WorkTag, category: CategoryKey) => void;
  characterNegative: string;
  onCharacterNegativeChange: (value: string) => void;
  filter: TagFilter;
}

/** ネガティブはカテゴリに分けず、1つの並びで編集する。 */
function NegativePane({
  tags,
  dispatch,
  entries,
  syntax,
  isKnown,
  onCopy,
  notify,
  onRegister,
  characterNegative,
  onCharacterNegativeChange,
  filter,
}: NegativePaneProps) {
  const id = useId();
  const [characterOpen, setCharacterOpen] = useState(false);
  const defaults = useMemo(() => defaultNegativeTags(), []);
  const hasAllDefaults = defaults.every((d) => tags.some((t) => t.enabled && normalize(t.tag) === normalize(d.tag)));

  const addDefaults = () => {
    for (const d of defaults) dispatch({ type: 'add', target: NEGATIVE, category: 'negative', tag: d.tag, weight: d.weight });
  };

  return (
    <div className="editor-pane negative-pane">
      <CategorySection
        target={NEGATIVE}
        category="negative"
        title="ネガティブ（Undesired Content）"
        tags={tags}
        dispatch={dispatch}
        entries={entries}
        syntax={syntax}
        isKnown={isKnown}
        onCopy={onCopy}
        notify={notify}
        onRegister={onRegister}
        filter={filter}
      />
      <div className="negative-actions">
        <button type="button" className="btn btn-small" disabled={hasAllDefaults} onClick={addDefaults}>
          既定のタグを追加
        </button>
        <p className="hint">
          既定は公式UIの UC プリセット「heavy」と同じタグです。足りないものだけ追加し、OFF のものは ON に戻します。NSFW を生成するときは nsfw を OFF にしてください。
        </p>
      </div>

      <div className="card negative-section">
        <button
          type="button"
          className="disclosure"
          aria-expanded={characterOpen}
          aria-controls={`${id}-character`}
          onClick={() => setCharacterOpen((value) => !value)}
        >
          <span className="disclosure-icon" aria-hidden="true" />
          キャラクター用のネガティブ
        </button>
        <div id={`${id}-character`} className="setting" hidden={!characterOpen}>
          <div className="setting-head">
            <label htmlFor={`${id}-character-text`}>個別のネガティブを指定していない ON のキャラクターに付けます</label>
            <button
              type="button"
              className="btn btn-small"
              disabled={characterNegative === DEFAULT_CHARACTER_NEGATIVE}
              onClick={() => onCharacterNegativeChange(DEFAULT_CHARACTER_NEGATIVE)}
            >
              既定値に戻す
            </button>
          </div>
          <textarea
            id={`${id}-character-text`}
            rows={2}
            spellCheck={false}
            autoCapitalize="off"
            value={characterNegative}
            onChange={(e) => onCharacterNegativeChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
