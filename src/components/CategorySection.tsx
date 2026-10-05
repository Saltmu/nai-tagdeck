import { memo, useId, useState, type Dispatch } from 'react';
import type { CategoryKey, DictEntry, WeightSyntax, WorkTag } from '../types';
import type { WorkspaceAction } from '../lib/workspace';
import { buildCategoryPrompt } from '../lib/prompt';
import { TagRow } from './TagRow';
import { TagInput } from './TagInput';

interface Props {
  category: CategoryKey;
  label: string;
  tags: WorkTag[];
  dispatch: Dispatch<WorkspaceAction>;
  entries: DictEntry[];
  syntax: WeightSyntax;
  isKnown: (tag: string) => boolean;
  onCopy: (text: string, label: string) => void;
  onRegister: (tag: WorkTag, category: CategoryKey) => void;
}

export const CategorySection = memo(function CategorySection({
  category,
  label,
  tags,
  dispatch,
  entries,
  syntax,
  isKnown,
  onCopy,
  onRegister,
}: Props) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const enabledCount = tags.filter((t) => t.enabled).length;
  const allOn = tags.length > 0 && enabledCount === tags.length;
  const text = buildCategoryPrompt(tags, syntax);

  return (
    <section className="card category">
      <div className="card-head">
        <h2 className="card-title">
          <button
            type="button"
            className="disclosure"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="disclosure-icon" aria-hidden="true" />
            {label}
            <span className="count">
              {enabledCount}/{tags.length}
            </span>
          </button>
        </h2>
        <div className="head-actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={tags.length === 0}
            onClick={() => dispatch({ type: 'setAll', category, enabled: !allOn })}
          >
            {allOn ? '全OFF' : '全ON'}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!text}
            onClick={() => onCopy(text, label)}
          >
            コピー
          </button>
        </div>
      </div>

      <div id={bodyId} hidden={!open}>
        {tags.length > 0 && (
          <ul className="tag-list">
            {tags.map((t) => (
              <TagRow
                key={t.id}
                tag={t}
                category={category}
                dispatch={dispatch}
                known={isKnown(t.tag)}
                onRegister={onRegister}
              />
            ))}
          </ul>
        )}
        <TagInput
          category={category}
          label={label}
          entries={entries}
          onAdd={(tag, weight) => dispatch({ type: 'add', category, tag, weight })}
        />
      </div>
    </section>
  );
});
