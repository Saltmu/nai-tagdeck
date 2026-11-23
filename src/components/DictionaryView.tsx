import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { CategoryKey, DictEntry } from '../types';
import type { Dictionary } from '../hooks/useDictionary';
import { CATEGORIES, categoryLabel, isCategoryKey } from '../lib/categories';
import { findDuplicate, parseImportFile, toCSV, toJSON, UTF8_BOM, type ImportMode, type ImportResult } from '../lib/io';
import { formatWeight, isNeutralWeight } from '../lib/prompt';
import { filterEntries } from '../lib/suggest';
import { normalize } from '../lib/tagText';
import { dateStamp, downloadText } from '../lib/browser';
import { newId } from '../lib/id';
import { EntryForm } from './EntryForm';
import { ImportPanel } from './ImportPanel';
import { useDialogs } from './Dialogs';

interface Props {
  dictionary: Dictionary;
  notify: (message: string) => void;
}

const PAGE_SIZE = 300;
const NEW = '__new__';

function blankEntry(category: CategoryKey): DictEntry {
  return { id: newId(), tag: '', category, alias: '', default_weight: 1, sort_order: 0, updated_at: '' };
}

export function DictionaryView({ dictionary, notify }: Props) {
  const dialogs = useDialogs();
  const { entries, loaded, save, saveMany, remove, importEntries, restoreInitial } = dictionary;
  const [query, setQuery] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [filterCategory, setFilterCategory] = useState<CategoryKey | 'all'>('all');
  const [pageIndex, setPageIndex] = useState(0);
  const queryComposing = useRef(false);
  const confirmingFilter = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ fileName: string; result: ImportResult } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const listRef = useRef<HTMLElement>(null);
  const scrollToList = useRef(false);

  const filtered = useMemo(
    () => filterEntries(entries, query, filterCategory),
    [entries, filterCategory, query],
  );
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const editedIndex = editingId && editingId !== NEW ? filtered.findIndex((entry) => entry.id === editingId) : -1;
  // 辞書の更新で編集中の行が別ページへ動いても、その行を表示したままにする。ページを外すと入力が消える。
  const editedPage = editedIndex >= 0 ? Math.floor(editedIndex / PAGE_SIZE) : null;
  const clampedPage = pageCount === 0 ? 0 : Math.min(pageIndex, pageCount - 1);
  const page = editedPage ?? clampedPage;
  const pageStart = page * PAGE_SIZE;
  const shown = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const hasPager = filtered.length > PAGE_SIZE;

  useEffect(() => {
    if (pageIndex !== page) setPageIndex(page);
  }, [page, pageIndex]);

  useLayoutEffect(() => {
    if (!scrollToList.current) return;
    scrollToList.current = false;
    const list = listRef.current;
    if (!list) return;
    // ページ送りのボタンは一覧の末尾にもある。フォーカスを残すと画面がそこへ戻る。
    // 一覧へ移すと、次の Tab は行の前にあるページ操作に入る。
    list.focus({ preventScroll: true });
    list.scrollIntoView({ block: 'start' });
  });

  const editLeavesFirstPage = (nextQuery: string, nextCategory: CategoryKey | 'all') => {
    if (!editingId || editingId === NEW) return false;
    return !filterEntries(entries, nextQuery, nextCategory)
      .slice(0, PAGE_SIZE)
      .some((entry) => entry.id === editingId);
  };

  const applyListFilter = async (nextQuery: string, nextCategory: CategoryKey | 'all') => {
    if (nextQuery === query && nextCategory === filterCategory) {
      setQueryDraft(query);
      return;
    }
    // 保存の完了前に破棄させない。書き込みは続いている。
    if (savingEdit && editLeavesFirstPage(nextQuery, nextCategory)) {
      setQueryDraft(query);
      return;
    }
    if (editLeavesFirstPage(nextQuery, nextCategory)) {
      if (confirmingFilter.current) return;
      confirmingFilter.current = true;
      const ok = await dialogs.confirm('編集中の内容を破棄して絞り込みを変えますか？', {
        okLabel: '破棄して絞り込む',
        danger: true,
      });
      confirmingFilter.current = false;
      if (!ok) {
        setQueryDraft(query);
        return;
      }
      setEditingId(null);
    }
    setQuery(nextQuery);
    setQueryDraft(nextQuery);
    setFilterCategory(nextCategory);
    setPageIndex(0);
  };

  const showPage = async (next: number) => {
    if (next === page || savingEdit) return;
    if (editingId && editingId !== NEW) {
      const ok = await dialogs.confirm('編集中の内容を破棄してページを移動しますか？', {
        okLabel: '破棄して移動',
        danger: true,
      });
      if (!ok) return;
      setEditingId(null);
    }
    scrollToList.current = true;
    setPageIndex(next);
  };

  const pageNav = (label: string) => (
    <nav className="dict-pager" aria-label={label}>
      <button type="button" className="btn" disabled={page === 0 || savingEdit} onClick={() => void showPage(page - 1)}>
        前を表示
      </button>
      <button type="button" className="btn" disabled={page >= pageCount - 1 || savingEdit} onClick={() => void showPage(page + 1)}>
        さらに表示
      </button>
    </nav>
  );

  const handleSave = async (entry: DictEntry): Promise<string | null> => {
    const dup = findDuplicate(entries, entry);
    if (dup) return `「${dup.tag}」は ${categoryLabel(dup.category)} に登録済みです`;
    setSavingEdit(true);
    try {
      await save(entry);
    } catch (e) {
      return `保存できませんでした: ${String(e)}`;
    } finally {
      setSavingEdit(false);
    }
    setEditingId(null);
    notify(`「${entry.tag}」を保存しました`);
    return null;
  };

  const handleDelete = async (entry: DictEntry) => {
    if (!(await dialogs.confirm(`「${entry.tag}」を辞書から削除しますか？`, { okLabel: '削除', danger: true }))) return;
    await remove(entry.id);
    notify(`「${entry.tag}」を削除しました`);
  };

  const handleCreate = async (entry: DictEntry): Promise<string | null> => {
    const seen = new Set<string>();
    const incoming = entry.tag.split(',').flatMap((raw): DictEntry[] => {
      const tag = raw.trim();
      const key = normalize(tag);
      if (!tag || seen.has(key)) return [];
      seen.add(key);
      return [{ ...entry, id: newId(), tag }];
    });
    if (incoming.length === 0) return 'タグを入力してください';
    for (const item of incoming) {
      const dup = findDuplicate(entries, item);
      if (dup) return `「${dup.tag}」は ${categoryLabel(dup.category)} に登録済みです`;
    }
    try {
      await saveMany(incoming);
    } catch (e) {
      return `保存できませんでした: ${String(e)}`;
    }
    setEditingId(null);
    notify(incoming.length === 1 ? `「${incoming[0]!.tag}」を保存しました` : `${incoming.length}件のタグを登録しました`);
    return null;
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 同じファイルを選び直せるように
    if (!file) return;
    const text = await file.text();
    setPendingImport({ fileName: file.name, result: parseImportFile(file.name, text) });
  };

  const handleImport = async (mode: ImportMode) => {
    if (!pendingImport) return;
    const total = await importEntries(pendingImport.result.entries, mode);
    setPendingImport(null);
    notify(`読み込みました（辞書は ${total}件）`);
  };

  const exportAs = (format: 'json' | 'csv') => {
    const name = `nai-tagdeck-dictionary-${dateStamp()}.${format}`;
    if (format === 'json') downloadText(name, toJSON(entries), 'application/json');
    // Excel で文字化けしないよう BOM を付ける
    else downloadText(name, UTF8_BOM + toCSV(entries), 'text/csv');
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const total = await restoreInitial();
      notify(`初期カテゴリを復元しました（辞書は ${total}件）`);
    } catch (e) {
      notify(`初期カテゴリを復元できませんでした: ${String(e)}`);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="dictionary">
      <section className="card dict-toolbar" aria-label="辞書の操作">
        <div className="toolbar-row">
          <input
            type="search"
            className="grow"
            placeholder="タグ・日本語名で絞り込み"
            aria-label="辞書を絞り込む"
            value={queryDraft}
            onCompositionStart={() => {
              queryComposing.current = true;
            }}
            onCompositionEnd={(e) => {
              queryComposing.current = false;
              const next = e.currentTarget.value;
              setQueryDraft(next);
              void applyListFilter(next, filterCategory);
            }}
            onChange={(e) => {
              const next = e.target.value;
              setQueryDraft(next);
              // 変換中の中間文字列では破棄確認を出さない。確定は compositionend で行う。
              const native = e.nativeEvent;
              if (queryComposing.current || ('isComposing' in native && native.isComposing)) return;
              void applyListFilter(next, filterCategory);
            }}
          />
          <select
            aria-label="カテゴリで絞り込む"
            value={filterCategory}
            onChange={(e) => {
              const next = isCategoryKey(e.target.value) ? e.target.value : 'all';
              if (editLeavesFirstPage(query, next)) e.currentTarget.value = filterCategory;
              void applyListFilter(query, next);
            }}
          >
            <option value="all">すべてのカテゴリ</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar-row">
          <button type="button" className="btn btn-primary" onClick={() => setEditingId(NEW)}>
            ＋ 新規登録
          </button>
          <span className="spacer" />
          <button type="button" className="btn" disabled={!loaded || restoring || !!dictionary.error} onClick={handleRestore}>
            {restoring ? '復元中…' : '初期カテゴリを復元'}
          </button>
          <button type="button" className="btn" disabled={entries.length === 0} onClick={() => exportAs('json')}>
            JSON書き出し
          </button>
          <button type="button" className="btn" disabled={entries.length === 0} onClick={() => exportAs('csv')}>
            CSV書き出し
          </button>
          <label className="btn file-btn">
            読み込み
            <input
              type="file"
              className="visually-hidden"
              accept=".json,.csv,application/json,text/csv"
              onChange={handleFile}
            />
          </label>
        </div>
        <p className="hint">初期カテゴリのタグを補います。同名タグは既存のカテゴリ・日本語名・重み・並び順を保持します。</p>
      </section>

      {pendingImport && (
        <ImportPanel
          fileName={pendingImport.fileName}
          result={pendingImport.result}
          existingCount={entries.length}
          onImport={handleImport}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {editingId === NEW && (
        <section className="card" aria-label="新規登録">
          <EntryForm
            initial={blankEntry(filterCategory === 'all' ? 'quality' : filterCategory)}
            submitLabel="登録"
            multiple
            onSave={handleCreate}
            onCancel={() => setEditingId(null)}
          />
        </section>
      )}

      {loaded && entries.length === 0 ? (
        <section className="card empty-state">
          <p>辞書が空です。タグを登録するか、JSON/CSV を読み込んでください。</p>
          <button
            type="button"
            className="btn"
            disabled={restoring || !!dictionary.error}
            onClick={handleRestore}
          >
            初期タグを読み込む
          </button>
        </section>
      ) : (
        <section ref={listRef} className="card dict-list-card" aria-label="辞書の一覧" tabIndex={-1}>
          <p className="dict-count">
            {filtered.length}件 / 全{entries.length}件
            {hasPager && `（${pageStart + 1}〜${pageStart + shown.length}件目）`}
          </p>
          {hasPager && pageNav('一覧の上のページ')}
          <ul className="dict-list">
            {shown.map((entry) =>
              editingId === entry.id ? (
                <li key={entry.id} className="dict-item is-editing">
                  <EntryForm
                    initial={entry}
                    submitLabel="保存"
                    onSave={handleSave}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <li key={entry.id} className="dict-item">
                  <div className="dict-main">
                    <span className="dict-tag">{entry.tag}</span>
                    {entry.alias && <span className="dict-alias">{entry.alias}</span>}
                  </div>
                  <div className="dict-meta">
                    <span className="chip">{categoryLabel(entry.category)}</span>
                    {!isNeutralWeight(entry.default_weight) && (
                      <span className="chip chip-weight">×{formatWeight(entry.default_weight)}</span>
                    )}
                  </div>
                  <div className="dict-actions">
                    <button type="button" className="btn btn-small" onClick={() => setEditingId(entry.id)}>
                      編集
                    </button>
                    <button type="button" className="btn btn-small btn-danger" onClick={() => handleDelete(entry)}>
                      削除
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
          {hasPager && pageNav('一覧の下のページ')}
        </section>
      )}
    </div>
  );
}
