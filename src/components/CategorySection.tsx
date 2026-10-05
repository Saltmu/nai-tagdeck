import { memo, useId, useState, type Dispatch } from 'react';
import type { CategoryKey, DictEntry, TargetId, WeightSyntax, WorkTag } from '../types';
import type { WorkspaceAction } from '../lib/workspace';
import { categoryLabel } from '../lib/categories';
import { buildCategoryPrompt } from '../lib/prompt';
import { useCategoryOpen } from '../hooks/useCategoryOpen';
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
}: Props) {
  const [open, toggleOpen] = useCategoryOpen(target, category);
  const [sorting, setSorting] = useState(false);
  const canSort = tags.length > 1;
  const bodyId = useId();
  const label = categoryLabel(category);
  const fullLabel = scopeLabel ? `${scopeLabel} / ${label}` : label;
  const enabledCount = tags.filter((t) => t.enabled).length;
  const allOn = tags.length > 0 && enabledCount === tags.length;
  const text = buildCategoryPrompt(tags, syntax);

  return (
    <section className="card category">
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
        {tags.length > 0 && (
          <ul className="tag-list">
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
                      }
                    : undefined
                }
                onToggle={() => dispatch({ type: 'toggle', target, category, id: t.id })}
                onWeight={(weight) => dispatch({ type: 'setWeight', target, category, id: t.id, weight })}
                onRemove={() => dispatch({ type: 'remove', target, category, id: t.id })}
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
            onAdd={(tag, weight) => dispatch({ type: 'add', target, category, tag, weight })}
          />
        )}
      </div>
    </section>
  );
});
