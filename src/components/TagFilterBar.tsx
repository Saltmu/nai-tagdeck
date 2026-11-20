import type { TagFilter } from '../lib/tagSearch';

interface Props {
  filter: TagFilter;
  /** 絞り込み中の該当件数。絞り込んでいないときは null。 */
  matchCount: number | null;
  onQueryChange: (query: string) => void;
  onOnlyEnabledChange: (onlyEnabled: boolean) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

/** 今開いている欄（ベース・キャラクター・ネガティブ）のタグ表示を切り替える。 */
export function TagFilterBar({
  filter,
  matchCount,
  onQueryChange,
  onOnlyEnabledChange,
  onExpandAll,
  onCollapseAll,
}: Props) {
  return (
    <div className="toolbar-row tag-filter" role="group" aria-label="表示中のタグ">
      <input
        type="search"
        className="grow"
        placeholder="タグを検索"
        aria-label="タグを検索"
        value={filter.query}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <button
        type="button"
        className={`btn btn-small${filter.onlyEnabled ? ' btn-primary' : ''}`}
        aria-pressed={filter.onlyEnabled}
        onClick={() => onOnlyEnabledChange(!filter.onlyEnabled)}
      >
        ONのみ
      </button>
      <button type="button" className="btn btn-small" onClick={onExpandAll}>
        すべて開く
      </button>
      <button type="button" className="btn btn-small" onClick={onCollapseAll}>
        すべて閉じる
      </button>
      <span className="tag-filter-count" aria-live="polite">
        {matchCount === null ? '' : `該当 ${matchCount}件`}
      </span>
    </div>
  );
}
