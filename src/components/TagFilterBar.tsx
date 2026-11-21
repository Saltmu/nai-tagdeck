import { useId, useRef, useState } from 'react';
import type { TagFilter } from '../lib/tagSearch';
import { CloseIcon, SearchIcon } from './icons';

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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchId = useId();
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchButtonLabel = searchOpen ? 'タグ検索を閉じる' : 'タグ検索を開く';

  function closeSearch() {
    setSearchOpen(false);
    onQueryChange('');
    searchButton.current?.focus();
  }

  return (
    <div className="toolbar-row tag-filter" role="group" aria-label="表示中のタグ">
      <button
        ref={searchButton}
        type="button"
        className="icon-btn"
        aria-label={searchButtonLabel}
        title={searchButtonLabel}
        aria-expanded={searchOpen}
        aria-controls={searchOpen ? searchId : undefined}
        onClick={searchOpen ? closeSearch : () => setSearchOpen(true)}
      >
        {searchOpen ? <CloseIcon /> : <SearchIcon />}
      </button>
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
      {searchOpen && (
        <input
          id={searchId}
          type="search"
          className="tag-filter-search"
          placeholder="タグを検索"
          aria-label="タグを検索"
          value={filter.query}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              closeSearch();
            }
          }}
        />
      )}
    </div>
  );
}
