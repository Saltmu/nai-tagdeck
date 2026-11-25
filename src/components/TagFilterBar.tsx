import { useId, useRef, useState } from 'react';
import type { TagFilter } from '../lib/tagSearch';
import { EditorActions } from './EditorActions';
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
    <div className="tag-filter">
      <div className="tag-list-heading">
        <h2>タグ一覧</h2>
        <span className="tag-filter-count" aria-live="polite">
          {matchCount === null ? '' : `該当 ${matchCount}件`}
        </span>
        <div className="tag-list-actions">
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
          <EditorActions
            label={filter.onlyEnabled ? '表示切替（ONのみ）' : '表示切替'}
            active={filter.onlyEnabled}
            actions={[
              { label: 'ONのみ', pressed: filter.onlyEnabled, run: () => onOnlyEnabledChange(!filter.onlyEnabled) },
              { label: 'すべて開く', run: onExpandAll },
              { label: 'すべて閉じる', run: onCollapseAll },
            ]}
          />
        </div>
      </div>
      {searchOpen && (
        <input
          id={searchId}
          type="search"
          className="tag-filter-search"
          placeholder="追加済みタグを検索"
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
