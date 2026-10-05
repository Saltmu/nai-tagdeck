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

export type MatchKind = 'tag' | 'alias' | 'word';

export interface Suggestion {
  entry: DictEntry;
  matchedBy: MatchKind;
}

const RANK: Record<MatchKind, number> = { tag: 0, alias: 1, word: 2 };

function matchEntry(entry: DictEntry, q: string): MatchKind | null {
  const tag = normalize(entry.tag);
  if (tag.startsWith(q)) return 'tag';
  if (normalize(entry.alias).startsWith(q) || aliasTokens(entry.alias).some((a) => a.startsWith(q))) {
    return 'alias';
  }
  // "hair" で "long hair" も引けるよう、2語目以降の前方一致を最後に回す
  if (tag.split(' ').some((w) => w.startsWith(q))) return 'word';
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
  if (!q) {
    if (!showCategoryOnEmpty || !category) return [];
    return entries
      .filter((entry) => entry.category === category)
      .sort((a, b) => a.sort_order - b.sort_order || a.tag.localeCompare(b.tag))
      .map((entry) => ({ entry, matchedBy: 'tag' }));
  }

  const hits: Suggestion[] = [];
  for (const entry of entries) {
    const matchedBy = matchEntry(entry, q);
    if (matchedBy) hits.push({ entry, matchedBy });
  }

  hits.sort((a, b) => {
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
  return hits.slice(0, limit);
}

/** 辞書画面の検索用（部分一致）。 */
export function matchesFilter(entry: DictEntry, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return normalize(entry.tag).includes(q) || normalize(entry.alias).includes(q);
}
