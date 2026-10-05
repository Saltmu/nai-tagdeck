import { useMemo, useState, type ChangeEvent } from 'react';
import type { CategoryKey, DictEntry } from '../types';
import type { Dictionary } from '../hooks/useDictionary';
import { CATEGORIES, categoryLabel, isCategoryKey } from '../lib/categories';
import { findDuplicate, parseImportFile, toCSV, toJSON, type ImportMode, type ImportResult } from '../lib/io';
import { formatWeight, isNeutralWeight } from '../lib/prompt';
import { matchesFilter } from '../lib/suggest';
import { dateStamp, downloadText } from '../lib/browser';
import { newId } from '../lib/id';
import { EntryForm } from './EntryForm';
import { ImportPanel } from './ImportPanel';

interface Props {
  dictionary: Dictionary;
  notify: (message: string) => void;
}

const MAX_SHOWN = 300;
const NEW = '__new__';

function blankEntry(category: CategoryKey): DictEntry {
  return { id: newId(), tag: '', category, alias: '', default_weight: 1, sort_order: 0, updated_at: '' };
}

export function DictionaryView({ dictionary, notify }: Props) {
  const { entries, loaded, save, remove, importEntries, restoreInitial } = dictionary;
  const [query, setQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<CategoryKey | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ fileName: string; result: ImportResult } | null>(null);
  const [restoring, setRestoring] = useState(false);

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) => (filterCategory === 'all' || e.category === filterCategory) && matchesFilter(e, query),
      ),
    [entries, filterCategory, query],
  );
  const shown = filtered.slice(0, MAX_SHOWN);

  const handleSave = async (entry: DictEntry): Promise<string | null> => {
    const dup = findDuplicate(entries, entry);
    if (dup) return `「${dup.tag}」は ${categoryLabel(dup.category)} に登録済みです`;
    try {
      await save(entry);
    } catch (e) {
      return `保存できませんでした: ${String(e)}`;
    }
    setEditingId(null);
    notify(`「${entry.tag}」を保存しました`);
    return null;
  };

  const handleDelete = async (entry: DictEntry) => {
    if (!window.confirm(`「${entry.tag}」を辞書から削除しますか？`)) return;
    await remove(entry.id);
    notify(`「${entry.tag}」を削除しました`);
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
    else downloadText(name, '﻿' + toCSV(entries), 'text/csv');
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="カテゴリで絞り込む"
            value={filterCategory}
            onChange={(e) => setFilterCategory(isCategoryKey(e.target.value) ? e.target.value : 'all')}
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
            onSave={handleSave}
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
        <section className="card dict-list-card" aria-label="辞書の一覧">
          <p className="dict-count">
            {filtered.length}件 / 全{entries.length}件
            {filtered.length > MAX_SHOWN && `（先頭 ${MAX_SHOWN}件を表示。絞り込んでください）`}
          </p>
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
        </section>
      )}
    </div>
  );
}
