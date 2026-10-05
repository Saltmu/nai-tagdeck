import { useCallback, useMemo, type Dispatch } from 'react';
import type { CategoryKey, WeightSyntax, WorkTag, Workspace } from '../types';
import type { Dictionary } from '../hooks/useDictionary';
import type { WorkspaceAction } from '../lib/workspace';
import { CATEGORIES } from '../lib/categories';
import { normalize } from '../lib/suggest';
import { newId } from '../lib/id';
import { CategorySection } from './CategorySection';

interface Props {
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  loaded: boolean;
  prompt: string;
  dictionary: Dictionary;
  syntax: WeightSyntax;
  onSyntaxChange: (syntax: WeightSyntax) => void;
  onCopy: (text: string, label: string) => void;
  notify: (message: string) => void;
}

export function Editor({
  workspace,
  dispatch,
  loaded,
  prompt,
  dictionary,
  syntax,
  onSyntaxChange,
  onCopy,
  notify,
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

  return (
    <div className="editor" aria-busy={!loaded}>
      <section className="card preview" aria-labelledby="preview-heading">
        <div className="card-head">
          <h2 id="preview-heading" className="card-title">
            プロンプト
          </h2>
          <label className="inline-field">
            <span>強調の記法</span>
            <select value={syntax} onChange={(e) => onSyntaxChange(e.target.value as WeightSyntax)}>
              <option value="numeric">1.2::tag::（V4）</option>
              <option value="brace">{'{tag} / [tag]'}</option>
            </select>
          </label>
        </div>
        <output className={`preview-text${prompt ? '' : ' is-empty'}`}>
          {prompt || 'ONのタグがありません'}
        </output>
      </section>

      <div className="category-grid">
        {CATEGORIES.map((c) => (
          <CategorySection
            key={c.key}
            category={c.key}
            label={c.label}
            tags={workspace[c.key]}
            dispatch={dispatch}
            entries={dictionary.entries}
            syntax={syntax}
            isKnown={isKnown}
            onCopy={onCopy}
            onRegister={register}
          />
        ))}
      </div>
    </div>
  );
}
