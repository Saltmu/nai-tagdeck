import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { CategoryKey, DictEntry, PromptCategoryKey, TargetId, WeightSyntax, WorkTag, WorkspaceCategoryKey } from '../types';
import { BASE, type WorkspaceAction } from '../lib/workspace';
import { categoryLabel, CHARACTER_CATEGORY_KEYS, PROMPT_CATEGORY_KEYS } from '../lib/categories';
import { buildCategoryPrompt, parseTagList } from '../lib/prompt';
import { useCategoryOpen } from '../hooks/useCategoryOpen';
import { normalize } from '../lib/suggest';
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
}: Props) {
  const [open, toggleOpen] = useCategoryOpen(target, category);
  const [sorting, setSorting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const canSort = tags.length > 1;
  const listRef = useRef<HTMLUListElement>(null);
  const tagsRef = useRef(tags);
  useLayoutEffect(() => {
    tagsRef.current = tags;
  });
  const bodyId = useId();
  const label = title ?? categoryLabel(category);
  const fullLabel = scopeLabel ? `${scopeLabel} / ${label}` : label;
  const enabledTags = tags.filter((t) => t.enabled);
  const enabledCount = enabledTags.length;
  const summaryTags = enabledTags.slice(0, 2).map((t) => t.tag);
  const remainingCount = enabledCount - summaryTags.length;
  const allOn = tags.length > 0 && enabledCount === tags.length;
  const sortLabel = sorting ? '完了' : '並べ替え';
  const toggleAllLabel = allOn ? '全OFF' : '全ON';
  const text = open ? buildCategoryPrompt(tags, syntax) : '';
  const destinations = useMemo(
    () =>
      category === 'unclassified'
        ? (target === BASE ? PROMPT_CATEGORY_KEYS : CHARACTER_CATEGORY_KEYS).filter((key) => key !== 'unclassified')
        : undefined,
    [category, target],
  );

  const handleToggle = useCallback(
    (id: string) => dispatch({ type: 'toggle', target, category, id }),
    [dispatch, target, category],
  );
  const handleWeight = useCallback(
    (id: string, weight: number) => dispatch({ type: 'setWeight', target, category, id, weight }),
    [dispatch, target, category],
  );
  const handleEdit = useCallback(
    (id: string, nextTag: string) => {
      if (!nextTag.trim()) return 'タグを入力してください';
      if (tagsRef.current.some((other) => other.id !== id && normalize(other.tag) === normalize(nextTag))) {
        return '同じタグがこのカテゴリにあります';
      }
      dispatch({ type: 'setTag', target, category, id, tag: nextTag });
      return null;
    },
    [dispatch, target, category],
  );
  const handleRemove = useCallback(
    (id: string) => dispatch({ type: 'remove', target, category, id, undo: true }),
    [dispatch, target, category],
  );
  const handleRegister = useCallback(
    (tag: WorkTag) => {
      if (category !== 'unclassified') onRegister(tag, category);
    },
    [onRegister, category],
  );
  const handleMoveCategory = useCallback(
    (id: string, to: PromptCategoryKey) => dispatch({ type: 'moveFromUnclassified', target, id, to }),
    [dispatch, target],
  );
  const handleMove = useCallback(
    (id: string, delta: -1 | 1) => dispatch({ type: 'move', target, category, id, delta }),
    [dispatch, target, category],
  );
  const handleDrag = useCallback(
    (id: string, clientY: number) => {
      const rows = Array.from(listRef.current?.children ?? []);
      const to = rows.findIndex((row) => {
        const r = row.getBoundingClientRect();
        return clientY >= r.top && clientY < r.bottom;
      });
      const from = tagsRef.current.findIndex((t) => t.id === id);
      if (to >= 0 && from >= 0 && to !== from) dispatch({ type: 'moveTo', target, category, id, index: to });
    },
    [dispatch, target, category],
  );
  const handleAdd = useCallback(
    (tag: string, weight: number) => {
      dispatch({ type: 'add', target, category, tag, weight });
      onAdded?.(tag);
    },
    [dispatch, target, category, onAdded],
  );

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
              <span className="count">{enabledCount}/{tags.length}</span>
            ) : (
              <span className="collapsed-summary">
                <span className="count">{enabledCount}件ON</span>
                {summaryTags.length > 0 && <span className="summary-tags"> · {summaryTags.join(', ')}</span>}
                {remainingCount > 0 && <span className="summary-more"> ほか{remainingCount}件</span>}
              </span>
            )}
          </button>
        </h3>
        {open && <div className="head-actions">
          {(canSort || sorting) && (
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

      {open && (
        <div id={bodyId}>
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
          {tags.length > 0 && (
            <ul className="tag-list" ref={listRef}>
              {tags.map((t, i) => (
                <TagRow
                  key={t.id}
                  tag={t}
                  sorting={sorting && canSort}
                  canMoveUp={i > 0}
                  canMoveDown={i < tags.length - 1}
                  onMove={handleMove}
                  onDrag={handleDrag}
                  onToggle={handleToggle}
                  onWeight={handleWeight}
                  onEdit={handleEdit}
                  onRemove={handleRemove}
                  canRegister={category !== 'unclassified' && !isKnown(t.tag)}
                  onRegister={handleRegister}
                  moveDestinations={destinations}
                  onMoveCategory={destinations ? handleMoveCategory : undefined}
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
              onAdd={handleAdd}
            />
          )}
        </div>
      )}
    </section>
  );
});
