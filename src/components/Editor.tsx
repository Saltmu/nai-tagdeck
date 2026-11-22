import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type KeyboardEvent } from 'react';
import type { CategoryKey, WeightSyntax, WorkTag, Workspace } from '../types';
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
import { classifyEditorTag, createTagVectorIndex, type PromptTagCategory } from '../lib/tagClassification';
import { DEFAULT_CHARACTER_NEGATIVE } from '../lib/novelai';
import { normalize } from '../lib/tagText';
import { newId } from '../lib/id';
import { pairedInteraction } from '../lib/interaction';
import { CategorySection, type BaseCategorySuggestion } from './CategorySection';
import { CharacterCard } from './CharacterCard';
import { HistoryControls } from './HistoryControls';
import { PresetBar } from './PresetBar';
import { TagFilterBar } from './TagFilterBar';
import { TagInput } from './TagInput';
import type { PromptSource } from './PromptImportDialog';
import { useDialogs } from './Dialogs';
import type { PresetStore } from '../hooks/usePresets';

import { useEditorSelection } from '../hooks/useEditorSelection';
import { usePngDrop } from '../hooks/usePngDrop';
import { useScrollMemory } from '../hooks/useScrollMemory';

/** ベースの品質でよく使うタグ（公式の Quality Tags と定番）。ボタンで付け外しする。 */
const QUALITY_PICKS = ['masterpiece', 'best quality', 'amazing quality', 'very aesthetic', 'absurdres', 'no text'] as const;

/** 消えたキャラのタブ、生成チェック、カードにフォーカスがあったか。履歴ボタンなど残っている要素は対象外。 */
function focusWasInRemovedCharacter(element: HTMLElement | null): boolean {
  if (!element || element.isConnected) return false;
  return element.closest('.editor-tab-wrap, .character') !== null;
}

function focusOnEditorTab(element: EventTarget | null): element is HTMLElement {
  return element instanceof HTMLElement
    && element.getAttribute('role') === 'tab'
    && element.closest('.editor-tablist') !== null;
}

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
  shown,
}: Props) {
  const vectorIndex = useMemo(() => createTagVectorIndex(dictionary.entries), [dictionary.entries]);
  const knownTags = vectorIndex.byTag;
  const isKnown = useCallback((tag: string) => knownTags.has(normalize(tag)), [knownTags]);
  const [baseSuggestions, setBaseSuggestions] = useState<Record<string, BaseCategorySuggestion>>({});
  // 上部入力欄で追加した直後の行 ID が確定したタイミングで候補を結び付ける（PNG 取り込み等の別行へ引き継がないため）
  const pendingBaseSuggestions = useRef<Map<string, PromptTagCategory | null>>(new Map());
  const [pendingSuggestionVersion, setPendingSuggestionVersion] = useState(0);
  const clearBaseSuggestion = useCallback((tag: string) => {
    const key = normalize(tag);
    pendingBaseSuggestions.current.set(key, null);
    setPendingSuggestionVersion((v) => v + 1);
  }, []);

  useLayoutEffect(() => {
    if (pendingBaseSuggestions.current.size === 0) return;
    const pending = pendingBaseSuggestions.current;
    pendingBaseSuggestions.current = new Map();
    const byTag = new Map(workspace.base.unclassified.map((t) => [normalize(t.tag), t.id]));
    setBaseSuggestions((prev) => {
      let next: Record<string, BaseCategorySuggestion> | null = null;
      for (const [key, suggested] of pending) {
        const rowId = byTag.get(key);
        if (!rowId) continue;
        if (suggested) {
          const current = (next ?? prev)[rowId];
          if (current?.tag === key && current.category === suggested) continue;
          next ??= { ...prev };
          next[rowId] = { tag: key, category: suggested };
        } else if (rowId in (next ?? prev)) {
          next ??= { ...prev };
          delete next[rowId];
        }
      }
      return next ?? prev;
    });
  }, [workspace.base.unclassified, pendingSuggestionVersion]);

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
  const focusCopiedTab = useRef(false);
  const copiedTabId = useRef<string | null>(null);
  const knownCharacterIds = useRef(characters.map((c) => c.id));
  const lastFocused = useRef<HTMLElement | null>(null);
  const pendingRemovedTabFocus = useRef(false);
  const pendingAddedTabFocus = useRef<string | null>(null);
  const dispatchForCard = useCallback((action: WorkspaceAction) => {
    if (action.type === 'duplicateCharacter') focusCopiedTab.current = true;
    dispatch(action);
  }, [dispatch]);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocused.current = event.target;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
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
  const promptCategories = active ? CHARACTER_CATEGORY_KEYS : PROMPT_CATEGORY_KEYS;
  const paneCategories = negativeSelected ? ['negative'] as const : promptCategories;
  const addTagEntries = useMemo(
    () => dictionary.entries.filter((entry) => entry.category !== 'negative' && promptCategories.includes(entry.category)),
    [dictionary.entries, promptCategories],
  );
  const addPromptTag = (tag: string, weight: number, pickedCategory?: CategoryKey) => {
    let category: typeof promptCategories[number];
    if (pickedCategory && pickedCategory !== 'negative' && promptCategories.includes(pickedCategory)) {
      category = pickedCategory;
    } else {
      const routed = classifyEditorTag(tag, vectorIndex, promptCategories, active ? 'auto' : 'suggest');
      category = routed.category;
      if (!active) {
        pendingBaseSuggestions.current.set(normalize(tag), routed.suggestedCategory);
        setPendingSuggestionVersion((v) => v + 1);
      }
    }
    dispatch({ type: 'add', target: paneTarget, category, tag, weight });
    if (category === 'pose') handlePoseAdded(tag);
  };
  const paneTagLists: WorkTag[][] = negativeSelected
    ? [workspace.negative]
    : promptCategories.map((key) => (active ? active.tags[key] : workspace.base[key]));
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

  const id = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());
  useLayoutEffect(() => {
    const ids = characters.map((c) => c.id);
    const prev = knownCharacterIds.current;
    const added = ids.filter((characterId) => !prev.includes(characterId));
    knownCharacterIds.current = ids;
    const addedId = added.at(-1) ?? null;
    if (focusWasInRemovedCharacter(lastFocused.current)) pendingRemovedTabFocus.current = true;
    if (focusCopiedTab.current) {
      focusCopiedTab.current = false;
      copiedTabId.current = addedId;
    } else if (addedId && focusOnEditorTab(lastFocused.current)) {
      pendingAddedTabFocus.current = addedId;
    }
    const copied = copiedTabId.current;
    const restored = pendingAddedTabFocus.current;
    const focusFree = document.activeElement == null || document.activeElement === document.body;
    if (copied && selected === copied) {
      copiedTabId.current = null;
      pendingAddedTabFocus.current = null;
      pendingRemovedTabFocus.current = false;
      tabRefs.current.get(copied)?.focus();
    } else if (restored && selected === restored) {
      pendingAddedTabFocus.current = null;
      if (focusOnEditorTab(document.activeElement)) tabRefs.current.get(restored)?.focus();
    } else if (pendingRemovedTabFocus.current) {
      const ready = selected === BASE || selected === NEGATIVE || ids.includes(selected);
      if (ready) {
        pendingRemovedTabFocus.current = false;
        if (focusFree) tabRefs.current.get(selected)?.focus();
      }
    }
    lastFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [characters, selected]);
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
