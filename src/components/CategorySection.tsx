import { memo, useEffect, useId, useRef, useState, type Dispatch } from 'react';
import type { CategoryKey, DictEntry, TargetId, WeightSyntax, WorkTag, WorkspaceCategoryKey } from '../types';
import { BASE, type WorkspaceAction } from '../lib/workspace';
import { categoryLabel, CHARACTER_CATEGORY_KEYS, PROMPT_CATEGORY_KEYS } from '../lib/categories';
import { buildCategoryPrompt, parseTagList } from '../lib/prompt';
import { useCategoryOpen } from '../hooks/useCategoryOpen';
import { normalize } from '../lib/suggest';
import { isTagFilterActive, visibleWorkTags, type TagFilter } from '../lib/tagSearch';
import { TagRow } from './TagRow';
import { TagInput } from './TagInput';
import { CheckIcon, CopyIcon, PasteIcon, SortIcon, ToggleAllIcon } from './icons';

interface Props {
  target: TargetId;
  /** コピー時のトーストや入力欄のラベルに使う（例: 「キャラ1 / 外見」）。 */
  scopeLabel?: string;
  category: WorkspaceCategoryKey;
  tags: WorkTag[];
  dispatch: Dispatch<WorkspaceAction>;
  entries: DictEntry[];
  syntax: WeightSyntax;
  isKnown: (tag: string) => boolean;
  onCopy: (text: string, label: string) => void;
  notify: (message: string) => void;
  onRegister: (tag: WorkTag, category: CategoryKey) => void;
  /** 先頭に並べる択一ボタン（キャラの girl / boy / other など）。押し直すと外す。 */
  quickPicks?: readonly string[];
  /** one: 1つだけ選ぶ（先頭に置く）／ many: それぞれ付け外しする。 */
  quickPicksMode?: 'one' | 'many';
  /** カテゴリ名の代わりに出す見出し（キャラ側の「被写体」など）。 */
  title?: string;
  /** 入力欄にキャラ同士の動作（source# など）のボタンを出す。 */
  interactions?: boolean;
  /** 入力欄からタグを追加した直後に呼ぶ。 */
  onAdded?: (tag: string) => void;
  /** 検索語と ON だけの表示。並べ替えは絞り込み中は使わない。 */
  filter?: TagFilter;
}

export const CategorySection = memo(function CategorySection({
  target,
  scopeLabel,
  category,
  tags,
  dispatch,
  entries,
  syntax,
  isKnown,
  onCopy,
  notify,
  onRegister,
  quickPicks,
  quickPicksMode = 'one',
  title,
  interactions,
  onAdded,
  filter,
}: Props) {
  const [open, toggleOpen] = useCategoryOpen(target, category);
  const [sorting, setSorting] = useState(false);
  const appliedFilter = filter ?? { query: '', onlyEnabled: false };
  const filtering = isTagFilterActive(appliedFilter);
  const visibleTags = filtering ? visibleWorkTags(tags, appliedFilter) : tags;
  useEffect(() => {
    if (filtering) setSorting(false);
  }, [filtering]);
  const [suggesting, setSuggesting] = useState(false);
  const canSort = tags.length > 1;
  const listRef = useRef<HTMLUListElement>(null);
  const bodyId = useId();
  const label = title ?? categoryLabel(category);
  const fullLabel = scopeLabel ? `${scopeLabel} / ${label}` : label;
  const enabledCount = tags.filter((t) => t.enabled).length;
  const summarySource = filtering ? visibleTags : tags.filter((t) => t.enabled);
  const summaryTags = summarySource.slice(0, 2).map((t) => t.tag);
  const remainingCount = summarySource.length - summaryTags.length;
  const allOn = tags.length > 0 && enabledCount === tags.length;
  const sortLabel = sorting ? '完了' : '並べ替え';
  const toggleAllLabel = allOn ? '全OFF' : '全ON';
  const text = buildCategoryPrompt(tags, syntax);
  const destinations = category === 'unclassified'
    ? (target === BASE ? PROMPT_CATEGORY_KEYS : CHARACTER_CATEGORY_KEYS).filter((key) => key !== 'unclassified')
    : [];

  const pasteTags = async () => {
    let clipboardText: string;
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      notify('クリップボードを読み取れませんでした。タグ入力欄に直接貼り付けてください');
      return;
    }

    const parsed = parseTagList(clipboardText);
    if (parsed.length === 0) {
      notify('クリップボードに貼り付けられるタグがありません');
      return;
    }

    for (const { tag, weight } of parsed) {
      dispatch({ type: 'add', target, category, tag, weight });
    }
  };

  return (
    <section className={`card category${suggesting ? ' is-suggesting' : ''}`}>
      <div className="card-head">
        <h3 className="card-title">
          <button
            type="button"
            className="disclosure"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => {
              if (open) setSorting(false);
              toggleOpen();
            }}
          >
            <span className="disclosure-icon" aria-hidden="true" />
            <span className="disclosure-label">{label}</span>
            {open ? (
              <span className="count">
                {enabledCount}/{tags.length}
                {filtering ? ` · 該当 ${visibleTags.length}件` : ''}
              </span>
            ) : (
              <span className="collapsed-summary">
                {filtering ? (
                  <span className="count">該当 {visibleTags.length}件</span>
                ) : (
                  <span className="count">{enabledCount}件ON</span>
                )}
                {summaryTags.length > 0 && <span className="summary-tags"> · {summaryTags.join(', ')}</span>}
                {remainingCount > 0 && <span className="summary-more"> ほか{remainingCount}件</span>}
              </span>
            )}
          </button>
        </h3>
        {open && <div className="head-actions">
          {(canSort || sorting) && !filtering && (
            <button
              type="button"
              className="icon-btn"
              aria-label={sortLabel}
              title={sortLabel}
              aria-pressed={sorting}
              onClick={() => setSorting((v) => !v)}
            >
              {sorting ? <CheckIcon /> : <SortIcon />}
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={toggleAllLabel}
            title={toggleAllLabel}
            disabled={tags.length === 0}
            onClick={() => dispatch({ type: 'setAll', target, category, enabled: !allOn })}
          >
            <ToggleAllIcon enable={!allOn} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="コピー"
            title="コピー"
            disabled={!text}
            onClick={() => onCopy(text, fullLabel)}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="貼り付け"
            title="貼り付け"
            onClick={pasteTags}
          >
            <PasteIcon />
          </button>
        </div>}
      </div>

      <div id={bodyId} hidden={!open}>
        {quickPicks && (
          <div className="quick-picks" role="group" aria-label={`${fullLabel}のよく使うタグ`}>
            {quickPicks.map((pick) => {
              const existing = tags.find((t) => normalize(t.tag) === normalize(pick));
              const on = !!existing && (quickPicksMode === 'one' || existing.enabled);
              return (
                <button
                  key={pick}
                  type="button"
                  className={`btn btn-small${on ? ' btn-primary' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    if (quickPicksMode === 'one') {
                      dispatch({ type: 'pickOne', target, category, group: quickPicks, tag: on ? null : pick });
                    } else if (existing && on) {
                      dispatch({ type: 'remove', target, category, id: existing.id });
                    } else {
                      // 無いなら追加、OFF なら ON に戻す（add は同じタグを重複させず ON にする）
                      dispatch({ type: 'add', target, category, tag: pick });
                    }
                  }}
                >
                  {pick}
                </button>
              );
            })}
          </div>
        )}
        {filtering && tags.length > 0 && visibleTags.length === 0 && (
          <p className="hint">該当なし</p>
        )}
        {visibleTags.length > 0 && (
          <ul className="tag-list" ref={listRef}>
            {visibleTags.map((t, i) => (
              <TagRow
                key={t.id}
                tag={t}
                query={appliedFilter.query}
                sorting={
                  sorting && canSort && !filtering
                    ? {
                        onUp: i > 0 ? () => dispatch({ type: 'move', target, category, id: t.id, delta: -1 }) : null,
                        onDown:
                          i < visibleTags.length - 1
                            ? () => dispatch({ type: 'move', target, category, id: t.id, delta: 1 })
                            : null,
                        onDrag: (clientY) => {
                          const rows = Array.from(listRef.current?.children ?? []);
                          const to = rows.findIndex((row) => {
                            const r = row.getBoundingClientRect();
                            return clientY >= r.top && clientY < r.bottom;
                          });
                          if (to >= 0 && to !== i) dispatch({ type: 'moveTo', target, category, id: t.id, index: to });
                        },
                      }
                    : undefined
                }
                onToggle={() => dispatch({ type: 'toggle', target, category, id: t.id })}
                onWeight={(weight) => dispatch({ type: 'setWeight', target, category, id: t.id, weight })}
                onEdit={(tag) => {
                  if (!tag.trim()) return 'タグを入力してください';
                  if (tags.some((other) => other.id !== t.id && normalize(other.tag) === normalize(tag))) {
                    return '同じタグがこのカテゴリにあります';
                  }
                  dispatch({ type: 'setTag', target, category, id: t.id, tag });
                  return null;
                }}
                onRemove={() => dispatch({ type: 'remove', target, category, id: t.id, undo: true })}
                onRegister={category !== 'unclassified' && !isKnown(t.tag) ? () => onRegister(t, category) : undefined}
                categoryMove={category === 'unclassified' ? (
                  <select
                    className="tag-category-move"
                    aria-label={`${t.tag} の移動先カテゴリ`}
                    value=""
                    onChange={(e) => {
                      const to = destinations.find((key) => key === e.target.value);
                      if (to) dispatch({ type: 'moveFromUnclassified', target, id: t.id, to });
                    }}
                  >
                    <option value="" disabled>移動先</option>
                    {destinations.map((key) => <option key={key} value={key}>{categoryLabel(key)}</option>)}
                  </select>
                ) : undefined}
              />
            ))}
          </ul>
        )}
        {!sorting && (
          <TagInput
            category={category === 'unclassified' ? undefined : category}
            label={fullLabel}
            entries={entries}
            onExpandedChange={setSuggesting}
            interactions={interactions}
            onAdd={(tag, weight) => {
              dispatch({ type: 'add', target, category, tag, weight });
              onAdded?.(tag);
            }}
          />
        )}
      </div>
    </section>
  );
});
