import type { CategoryKey, DictEntry } from '../types';

/** 全角/半角・大小文字・カタカナ/ひらがな・アンダースコアの違いを吸収する。 */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function aliasTokens(alias: string): string[] {
  return alias
    .split(/[\s,、，|/・]+/)
    .map(normalize)
    .filter(Boolean);
}

export function tagWords(normalizedTag: string): string[] {
  return normalizedTag.split(/[ #]/).filter(Boolean);
}

export type MatchKind = 'tag' | 'alias' | 'word';

export interface Suggestion {
  entry: DictEntry;
  matchedBy: MatchKind;
}

const RANK: Record<MatchKind, number> = { tag: 0, alias: 1, word: 2 };

export interface IndexedEntry {
  entry: DictEntry;
  rawTag: string;
  rawAlias: string;
  tag: string;
  tagWords: string[];
  alias: string;
  aliasTokens: string[];
}

interface SuggestIndex {
  length: number;
  entries: IndexedEntry[];
  byCategory: Map<CategoryKey, Suggestion[]>;
}

const entryCache = new WeakMap<DictEntry, IndexedEntry>();
const indexCache = new WeakMap<readonly DictEntry[], SuggestIndex>();

function getIndexedEntry(entry: DictEntry): IndexedEntry {
  const cached = entryCache.get(entry);
  if (cached && cached.rawTag === entry.tag && cached.rawAlias === entry.alias) return cached;
  const tag = normalize(entry.tag);
  const alias = normalize(entry.alias);
  const indexed: IndexedEntry = {
    entry,
    rawTag: entry.tag,
    rawAlias: entry.alias,
    tag,
    tagWords: tagWords(tag),
    alias,
    aliasTokens: aliasTokens(entry.alias),
  };
  entryCache.set(entry, indexed);
  return indexed;
}

function getSuggestIndex(entries: readonly DictEntry[]): SuggestIndex {
  const cached = indexCache.get(entries);
  if (cached && cached.length === entries.length) return cached;
  const indexed = entries.map(getIndexedEntry);
  const index: SuggestIndex = {
    length: entries.length,
    entries: indexed,
    byCategory: new Map(),
  };
  indexCache.set(entries, index);
  return index;
}

/** サジェスト用の事前正規化インデックスを共有する（単語情報の再計算を避ける）。 */
export function getIndexedEntries(entries: readonly DictEntry[]): readonly IndexedEntry[] {
  return getSuggestIndex(entries).entries;
}

function matchEntry(item: IndexedEntry, q: string): MatchKind | null {
  if (item.tag.startsWith(q)) return 'tag';
  if (item.alias.startsWith(q) || item.aliasTokens.some((a) => a.startsWith(q))) {
    return 'alias';
  }
  // "hair" で "long hair" も、"hug" で "source#hug" も引けるよう、2語目以降の前方一致を最後に回す
  if (item.tagWords.some((w) => w.startsWith(q))) return 'word';
  return null;
}

export interface SuggestOptions {
  limit?: number;
  /** このカテゴリのエントリを先に並べる。 */
  category?: CategoryKey;
  /** 空欄では指定カテゴリの全登録タグを件数制限なしで返す。 */
  showCategoryOnEmpty?: boolean;
}

export function suggest(
  entries: readonly DictEntry[],
  query: string,
  { limit = 8, category, showCategoryOnEmpty = false }: SuggestOptions = {},
): Suggestion[] {
  const q = normalize(query);
  const index = getSuggestIndex(entries);
  if (!q) {
    if (!showCategoryOnEmpty || !category) return [];
    let cached = index.byCategory.get(category);
    if (!cached) {
      cached = entries
        .filter((entry) => entry.category === category)
        .sort((a, b) => a.sort_order - b.sort_order || a.tag.localeCompare(b.tag))
        .map((entry) => ({ entry, matchedBy: 'tag' as const }));
      index.byCategory.set(category, cached);
    }
    return cached.slice();
  }

  const hits: Array<{ entry: DictEntry; matchedBy: MatchKind; exact: boolean }> = [];
  for (const item of index.entries) {
    const matchedBy = matchEntry(item, q);
    if (matchedBy) hits.push({ entry: item.entry, matchedBy, exact: item.tag === q });
  }

  hits.sort((a, b) => {
    // 打ったとおりのタグを最初に出す
    const byExact = Number(b.exact) - Number(a.exact);
    if (byExact !== 0) return byExact;
    const byRank = RANK[a.matchedBy] - RANK[b.matchedBy];
    if (byRank !== 0) return byRank;
    if (category) {
      const byCat = Number(b.entry.category === category) - Number(a.entry.category === category);
      if (byCat !== 0) return byCat;
    }
    const bySort = a.entry.sort_order - b.entry.sort_order;
    if (bySort !== 0) return bySort;
    return a.entry.tag.length - b.entry.tag.length || a.entry.tag.localeCompare(b.entry.tag);
  });
  return hits.slice(0, limit).map(({ entry, matchedBy }) => ({ entry, matchedBy }));
}

/** 辞書画面の検索用（部分一致）。 */
export function matchesFilter(entry: DictEntry, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const item = getIndexedEntry(entry);
  return item.tag.includes(q) || item.alias.includes(q);
}

/** 辞書画面の一覧絞り込み（事前正規化インデックスを使って query の正規化を1回に抑える）。 */
export function filterEntries(
  entries: readonly DictEntry[],
  query: string,
  category: CategoryKey | 'all' = 'all',
): DictEntry[] {
  const q = normalize(query);
  const index = getSuggestIndex(entries);
  const out: DictEntry[] = [];
  for (const item of index.entries) {
    if (category !== 'all' && item.entry.category !== category) continue;
    if (!q || item.tag.includes(q) || item.alias.includes(q)) out.push(item.entry);
  }
  return out;
}
