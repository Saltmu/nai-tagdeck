import { useMemo } from 'react';

interface Props {
  page: number;
  pageCount: number;
  disabled: boolean;
  onChangePage: (next: number) => void;
}

const PAGE_WINDOW = 5;

export function DictionaryPager({ page, pageCount, disabled, onChangePage }: Props) {
  // ページ番号は現在ページを中心に最大 5 件だけ並べる（|<< < 1 2 3 4 5 > >>|）
  const pageNumbers = useMemo(() => {
    if (pageCount <= PAGE_WINDOW) return Array.from({ length: pageCount }, (_, i) => i);
    const start = Math.min(Math.max(0, page - Math.floor(PAGE_WINDOW / 2)), pageCount - PAGE_WINDOW);
    return Array.from({ length: PAGE_WINDOW }, (_, i) => start + i);
  }, [page, pageCount]);

  return (
    <nav className="dict-pager" aria-label="ページ">
      <button type="button" className="btn" aria-label="最初のページへ" disabled={page === 0 || disabled} onClick={() => onChangePage(0)}>
        {'|<<'}
      </button>
      <button type="button" className="btn" aria-label="前のページへ" disabled={page === 0 || disabled} onClick={() => onChangePage(page - 1)}>
        {'<'}
      </button>
      {pageNumbers.map((n) => (
        <button
          key={n}
          type="button"
          className="btn"
          aria-label={`ページ ${n + 1} へ`}
          aria-current={n === page ? 'page' : undefined}
          disabled={n === page || disabled}
          onClick={() => onChangePage(n)}
        >
          {n + 1}
        </button>
      ))}
      <button type="button" className="btn" aria-label="次のページへ" disabled={page >= pageCount - 1 || disabled} onClick={() => onChangePage(page + 1)}>
        {'>'}
      </button>
      <button type="button" className="btn" aria-label="最後のページへ" disabled={page >= pageCount - 1 || disabled} onClick={() => onChangePage(pageCount - 1)}>
        {'>>|'}
      </button>
    </nav>
  );
}
