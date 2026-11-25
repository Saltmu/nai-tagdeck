import { useId, useMemo, useState, type Dispatch } from 'react';
import type { CategoryKey, WeightSyntax, WorkTag } from '../types';
import type { Dictionary } from '../hooks/useDictionary';
import { NEGATIVE, defaultNegativeTags, type WorkspaceAction } from '../lib/workspace';
import { DEFAULT_CHARACTER_NEGATIVE } from '../lib/novelai';
import { normalize } from '../lib/tagText';
import type { TagFilter } from '../lib/tagSearch';
import { CategorySection } from './CategorySection';

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
  aliasMap: ReadonlyMap<string, readonly string[]>;
}

/** ネガティブはカテゴリに分けず、1つの並びで編集する。 */
export function NegativePane({
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
  aliasMap,
}: NegativePaneProps) {
  const id = useId();
  const [characterOpen, setCharacterOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const defaults = useMemo(() => defaultNegativeTags(), []);
  const hasAllDefaults = defaults.every((d) => tags.some((t) => t.enabled && normalize(t.tag) === normalize(d.tag)));

  const addDefaults = () => {
    if (defaults.length === 0) return;
    dispatch({
      type: 'addMany',
      items: defaults.map((d) => ({ target: NEGATIVE, category: 'negative', tag: d.tag, weight: d.weight })),
    });
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
        aliasMap={aliasMap}
      />
      <div className="negative-actions">
        <div className="negative-actions-row">
          <button
            type="button"
            className="btn btn-small"
            disabled={hasAllDefaults}
            aria-describedby={hasAllDefaults ? `${id}-defaults-hint` : undefined}
            onClick={addDefaults}
          >
            既定のタグを追加
          </button>
          <button
            type="button"
            className="help-btn"
            aria-label="既定のタグについての説明"
            title="既定のタグについての説明"
            aria-expanded={helpOpen}
            aria-controls={`${id}-defaults-help`}
            onClick={() => setHelpOpen((value) => !value)}
          >
            ?
          </button>
        </div>
        {helpOpen && (
          <p className="hint" id={`${id}-defaults-help`}>
            既定は公式UIの UC プリセット「heavy」と同じタグです。足りないものだけ追加し、OFF のものは ON に戻します。NSFW を生成するときは nsfw を OFF にしてください。
          </p>
        )}
        {hasAllDefaults && (
          <p className="hint" id={`${id}-defaults-hint`} role="note">
            既定のタグはすべて追加済みです
          </p>
        )}
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
