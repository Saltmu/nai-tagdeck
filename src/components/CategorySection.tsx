import { memo, useId, useRef, useState, type Dispatch } from 'react';
import type { CategoryKey, DictEntry, TargetId, WeightSyntax, WorkTag } from '../types';
import type { WorkspaceAction } from '../lib/workspace';
import { categoryLabel } from '../lib/categories';
import { buildCategoryPrompt } from '../lib/prompt';
import { useCategoryOpen } from '../hooks/useCategoryOpen';
import { normalize } from '../lib/suggest';
import { TagRow } from './TagRow';
import { TagInput } from './TagInput';

interface Props {
  target: TargetId;
  /** コピー時のトーストや入力欄のラベルに使う（例: 「キャラ1 / 外見」）。 */
  scopeLabel?: string;
  category: CategoryKey;
  tags: WorkTag[];
  dispatch: Dispatch<WorkspaceAction>;
  entries: DictEntry[];
  syntax: WeightSyntax;
  isKnown: (tag: string) => boolean;
  onCopy: (text: string, label: string) => void;
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
  const bodyId = useId();
  const label = title ?? categoryLabel(category);
  const fullLabel = scopeLabel ? `${scopeLabel} / ${label}` : label;
  const enabledCount = tags.filter((t) => t.enabled).length;
  const allOn = tags.length > 0 && enabledCount === tags.length;
  const text = buildCategoryPrompt(tags, syntax);

  return (
    <section className={`card category${suggesting ? ' is-suggesting' : ''}`}>
      <div className="card-head">
        <h3 className="card-title">
          <button
            type="button"
            className="disclosure"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggleOpen}
          >
            <span className="disclosure-icon" aria-hidden="true" />
            {label}
            <span className="count">
              {enabledCount}/{tags.length}
            </span>
          </button>
        </h3>
        <div className="head-actions">
          {(canSort || sorting) && (
            <button
              type="button"
              className={`btn btn-small${sorting ? ' btn-primary' : ''}`}
              aria-pressed={sorting}
              onClick={() => setSorting((v) => !v)}
            >
              {sorting ? '完了' : '並べ替え'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-small"
            disabled={tags.length === 0}
            onClick={() => dispatch({ type: 'setAll', target, category, enabled: !allOn })}
          >
            {allOn ? '全OFF' : '全ON'}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!text}
            onClick={() => onCopy(text, fullLabel)}
          >
            コピー
          </button>
        </div>
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
        {tags.length > 0 && (
          <ul className="tag-list" ref={listRef}>
            {tags.map((t, i) => (
              <TagRow
                key={t.id}
                tag={t}
                sorting={
                  sorting && canSort
                    ? {
                        onUp: i > 0 ? () => dispatch({ type: 'move', target, category, id: t.id, delta: -1 }) : null,
                        onDown:
                          i < tags.length - 1
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
                onRegister={isKnown(t.tag) ? undefined : () => onRegister(t, category)}
              />
            ))}
          </ul>
        )}
        {!sorting && (
          <TagInput
            category={category}
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
