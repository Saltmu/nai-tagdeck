import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type KeyboardEvent } from 'react';
import type { CategoryKey, WeightSyntax, WorkTag, Workspace } from '../types';
import type { Dictionary } from '../hooks/useDictionary';
import {
  BASE,
  MAX_CHARACTERS,
  MAX_ENABLED_CHARACTERS,
  NEGATIVE,
  type WorkspaceAction,
} from '../lib/workspace';
import { CHARACTER_CATEGORY_KEYS, PROMPT_CATEGORY_KEYS } from '../lib/categories';
import { saveCategoriesOpen } from '../lib/categoryOpen';
import { buildPrompt } from '../lib/prompt';
import { buildTagAliasMap, isTagFilterActive, visibleWorkTags, type TagFilter } from '../lib/tagSearch';
import { classifyEditorTag, createTagVectorIndex } from '../lib/tagClassification';
import { normalize } from '../lib/tagText';
import { newId } from '../lib/id';
import { pairedInteraction } from '../lib/interaction';
import { CategorySection } from './CategorySection';
import { NegativePane } from './NegativePane';
import { CharacterCard } from './CharacterCard';
import type { PeerCharacterCenter } from './CharacterCenterPicker';
import { HistoryControls } from './HistoryControls';
import { PresetBar } from './PresetBar';
import { TagFilterBar } from './TagFilterBar';
import { TagInput } from './TagInput';
import type { PromptSource } from './PromptImportDialog';
import { useDialogs } from './Dialogs';
import type { PresetStore } from '../hooks/usePresets';

import { useCharacterTabFocus } from '../hooks/useCharacterTabFocus';
import { useEditorSelection } from '../hooks/useEditorSelection';
import { usePngDrop } from '../hooks/usePngDrop';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { useStickyEditorTabs } from '../hooks/useStickyEditorTabs';
import { useUnclassifiedSuggestions } from '../hooks/useUnclassifiedSuggestions';

/** ベースの品質でよく使うタグ（公式の Quality Tags と定番）。ボタンで付け外しする。 */
const QUALITY_PICKS = ['masterpiece', 'best quality', 'amazing quality', 'very aesthetic', 'absurdres', 'no text'] as const;

interface Props {
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  history?: ComponentProps<typeof HistoryControls>;
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
  /** 位置ピッカーの縦横比に使う出力画像サイズ。 */
  canvasSize?: { width: number; height: number };
  /** 編集画面を開いている（false の間は他の画面を表示している）。 */
  shown: boolean;
}

export function Editor({
  workspace,
  dispatch,
  history,
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
  canvasSize,
  shown,
}: Props) {
  const vectorIndex = useMemo(() => createTagVectorIndex(dictionary.entries), [dictionary.entries]);
  const knownTags = vectorIndex.byTag;
  const isKnown = useCallback((tag: string) => knownTags.has(normalize(tag)), [knownTags]);
  const {
    suggestions: baseSuggestions,
    noteSuggestion,
    clearSuggestion: clearBaseSuggestion,
  } = useUnclassifiedSuggestions(workspace.base.unclassified);

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
  const peerCenters = useMemo<PeerCharacterCenter[]>(() => {
    if (!activeId) return [];
    const activeCharacters = characters
      .map((c, i) => ({
        c,
        name: c.name.trim() || `キャラ${i + 1}`,
        hasPrompt: buildPrompt(c.tags, syntax, CHARACTER_CATEGORY_KEYS).length > 0,
      }))
      .filter(({ c, hasPrompt }) => c.enabled && hasPrompt);
    const useCoords = activeCharacters.some(({ c }) => c.center !== undefined);
    return activeCharacters
      .filter(({ c }) => c.id !== activeId)
      .map(({ c, name }) => ({
        id: c.id,
        name,
        ...(c.center ? { center: c.center } : useCoords ? { center: { x: 0.5, y: 0.5 }, autoCenter: true } : {}),
      }));
  }, [characters, activeId, syntax]);
  const handlePoseAdded = useCallback(
    (tag: string) => {
      if (activeId) void offerPair(activeId, tag);
    },
    [activeId, offerPair],
  );
  const paneTarget = negativeSelected ? NEGATIVE : active?.id ?? BASE;
  const promptCategories = active ? CHARACTER_CATEGORY_KEYS : PROMPT_CATEGORY_KEYS;
  const paneCategories = negativeSelected ? ['negative'] as const : promptCategories;
  const addTagEntries = useMemo(
    () => dictionary.entries.filter((entry) => entry.category !== 'negative' && promptCategories.includes(entry.category)),
    [dictionary.entries, promptCategories],
  );
  const resolvePromptCategory = (tag: string, pickedCategory?: CategoryKey): typeof promptCategories[number] => {
    if (pickedCategory && pickedCategory !== 'negative' && promptCategories.includes(pickedCategory)) {
      return pickedCategory;
    }
    const routed = classifyEditorTag(tag, vectorIndex, promptCategories, active ? 'auto' : 'suggest');
    if (!active) noteSuggestion(tag, routed.suggestedCategory);
    return routed.category;
  };
  const addPromptTag = (tag: string, weight: number, pickedCategory?: CategoryKey) => {
    const category = resolvePromptCategory(tag, pickedCategory);
    dispatch({ type: 'add', target: paneTarget, category, tag, weight });
    if (category === 'pose') handlePoseAdded(tag);
  };
  const addPromptTags = (items: ReadonlyArray<{ tag: string; weight: number }>) => {
    if (items.length === 0) return;
    if (items.length === 1) {
      addPromptTag(items[0]!.tag, items[0]!.weight);
      return;
    }
    const resolved = items.map(({ tag, weight }) => ({
      target: paneTarget,
      category: resolvePromptCategory(tag),
      tag,
      weight,
    }));
    dispatch({ type: 'addMany', items: resolved });
    for (const item of resolved) {
      if (item.category === 'pose') handlePoseAdded(item.tag);
    }
  };
  const aliasMap = useMemo(() => buildTagAliasMap(dictionary.entries), [dictionary.entries]);
  const characterTargets = useMemo(
    () => characters.map((c, i) => ({ id: c.id, label: `${i + 1}. ${c.name.trim() || `キャラ${i + 1}`}` })),
    [characters],
  );
  const paneTagLists: WorkTag[][] = negativeSelected
    ? [workspace.negative]
    : promptCategories.map((key) => (active ? active.tags[key] : workspace.base[key]));
  const matchCount = isTagFilterActive(tagFilter)
    ? paneTagLists.reduce((sum, tags) => sum + visibleWorkTags(tags, tagFilter, aliasMap).length, 0)
    : null;

  const { tabsRef, tabsStuck } = useStickyEditorTabs();

  // ベース・ネガティブ・各キャラごとにスクロール位置を覚え、タブを切り替えたときや他の画面から戻ったときに戻す
  useScrollMemory(selected, shown, tabsRef);

  const id = useId();
  const { tabRefs, dispatchForCard } = useCharacterTabFocus(characters, selected, dispatch);
  const tabKeys = useMemo(() => [BASE, NEGATIVE, ...characters.map((c) => c.id)], [characters]);
  const panelId = `${id}-panel`;
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabKeys.indexOf(paneTarget);
    if (index < 0) return;
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabKeys.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabKeys.length) % tabKeys.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabKeys.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextKey = tabKeys[nextIndex]!;
    select(nextKey);
    tabRefs.current.get(nextKey)?.focus();
  };

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
        data-occludes={tabsStuck ? '' : undefined}
      >
        <div className="editor-tablist" role="tablist" aria-label="編集対象" onKeyDown={onTabKeyDown}>
          <button
            ref={(el) => { tabRefs.current.set(BASE, el); }}
            type="button"
            role="tab"
            id={`${id}-tab-${BASE}`}
            tabIndex={paneTarget === BASE ? 0 : -1}
            aria-selected={!active && !negativeSelected}
            aria-controls={paneTarget === BASE ? panelId : undefined}
            className="editor-tab"
            onClick={() => select(BASE)}
          >
            ベース
          </button>
          <button
            ref={(el) => { tabRefs.current.set(NEGATIVE, el); }}
            type="button"
            role="tab"
            id={`${id}-tab-${NEGATIVE}`}
            tabIndex={paneTarget === NEGATIVE ? 0 : -1}
            aria-selected={negativeSelected}
            aria-controls={paneTarget === NEGATIVE ? panelId : undefined}
            className="editor-tab editor-tab-negative"
            onClick={() => select(NEGATIVE)}
          >
            ネガティブ
          </button>
          {characters.map((c, i) => {
            const name = c.name.trim() || `キャラ${i + 1}`;
            const locked = !c.enabled && enabledCount >= MAX_ENABLED_CHARACTERS;
            const isSelected = c.id === active?.id;
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
                  ref={(el) => { tabRefs.current.set(c.id, el); }}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${c.id}`}
                  tabIndex={isSelected ? 0 : -1}
                  aria-selected={isSelected}
                  aria-controls={isSelected ? panelId : undefined}
                  className={`editor-tab editor-tab-character${c.enabled ? '' : ' is-off'}`}
                  onClick={() => select(c.id)}
                >
                  {name}
                </button>
              </div>
            );
          })}
        </div>
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
        {history && <HistoryControls {...history} />}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`${id}-tab-${paneTarget}`}>
        {!negativeSelected && (
          <TagInput
            key={`add-${paneTarget}`}
            label={active ? active.name.trim() || `キャラ${activeIndex + 1}` : 'ベース'}
            placeholder="タグを追加（英語・日本語名・よみ）"
            entries={addTagEntries}
            onAdd={addPromptTag}
            onAddMany={addPromptTags}
            onPick={addPromptTag}
          />
        )}
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
            aliasMap={aliasMap}
          />
        ) : active ? (
          <CharacterCard
            key={`character-${active.id}`}
            character={active}
            index={activeIndex}
            count={characters.length}
            dispatch={dispatchForCard}
            entries={dictionary.entries}
            syntax={syntax}
            isKnown={isKnown}
            onCopy={onCopy}
            notify={notify}
            onRegister={register}
            sharedNegative={characterNegative}
            onPoseAdded={handlePoseAdded}
            filter={tagFilter}
            enabledCount={enabledCount}
            canvasSize={canvasSize}
            peerCenters={peerCenters}
            characterTargets={characterTargets}
            aliasMap={aliasMap}
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
                onAdded={key === 'unclassified' ? clearBaseSuggestion : undefined}
                suggestedCategories={key === 'unclassified' ? baseSuggestions : undefined}
                filter={tagFilter}
                characters={characterTargets}
                aliasMap={aliasMap}
              />
            ))}
          </div>
        )}
      </div>

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
