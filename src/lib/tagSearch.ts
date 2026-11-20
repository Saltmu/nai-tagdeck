import type { WorkTag } from '../types';
import { normalize } from './suggest';

/** 表示中のタグを、検索語と ON だけで絞る。 */
export interface TagFilter {
  query: string;
  onlyEnabled: boolean;
}

export function isTagFilterActive(filter: TagFilter): boolean {
  return filter.onlyEnabled || normalize(filter.query).length > 0;
}

/** 正規化（大小文字・全角半角・かな・アンダースコア）後の部分一致。 */
export function tagMatchesQuery(tag: string, query: string): boolean {
  const q = normalize(query);
  return q.length === 0 || normalize(tag).includes(q);
}

export function visibleWorkTags(tags: readonly WorkTag[], filter: TagFilter): WorkTag[] {
  return tags.filter((tag) => (!filter.onlyEnabled || tag.enabled) && tagMatchesQuery(tag.tag, filter.query));
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** 1文字を normalize と同じ規則で畳む。検索語の位置を元の文字列へ戻すために使う。 */
function foldChar(char: string): string {
  return char
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/_/g, ' ');
}

interface NormUnit {
  start: number;
  end: number;
  ch: string;
}

/**
 * normalize と同じ文字列を、元の文字位置つきで作る。
 * 空白の連続と両端の空白は、normalize と同様に1つの空白へ畳んでから除く。
 * 文字の合成などで一致しないときは null。
 */
function normalizedUnits(tag: string): NormUnit[] | null {
  const units: NormUnit[] = [];
  let pending: { start: number; end: number } | null = null;
  const flushSpace = () => {
    if (!pending) return;
    units.push({ start: pending.start, end: pending.end, ch: ' ' });
    pending = null;
  };

  for (let index = 0; index < tag.length; ) {
    const char = String.fromCodePoint(tag.codePointAt(index)!);
    const end = index + char.length;
    const folded = foldChar(char);
    for (const ch of folded) {
      if (/\s/.test(ch)) {
        pending = pending ? { start: pending.start, end } : { start: index, end };
      } else {
        flushSpace();
        units.push({ start: index, end, ch });
      }
    }
    index = end;
  }
  flushSpace();
  while (units[0]?.ch === ' ') units.shift();
  while (units.at(-1)?.ch === ' ') units.pop();
  return units.map((unit) => unit.ch).join('') === normalize(tag) ? units : null;
}

/** 検索語に対応する範囲だけ match にする。空の検索語や不一致は全文を不一致にする。 */
export function highlightTag(tag: string, query: string): HighlightPart[] {
  const q = normalize(query);
  const plain = [{ text: tag, match: false }];
  if (!q || !normalize(tag).includes(q)) return plain;

  const units = normalizedUnits(tag);
  if (!units) return [{ text: tag, match: true }];

  const matched = Array<boolean>(tag.length).fill(false);
  const norm = units.map((unit) => unit.ch).join('');
  let from = 0;
  while (from <= norm.length - q.length) {
    const at = norm.indexOf(q, from);
    if (at < 0) break;
    for (let index = at; index < at + q.length; index += 1) {
      const unit = units[index];
      if (!unit) continue;
      for (let pos = unit.start; pos < unit.end; pos += 1) matched[pos] = true;
    }
    from = at + Math.max(q.length, 1);
  }
  if (!matched.some(Boolean)) return [{ text: tag, match: true }];

  const parts: HighlightPart[] = [];
  let start = 0;
  for (let index = 1; index <= tag.length; index += 1) {
    const marked = matched[start] ?? false;
    if (index === tag.length || matched[index] !== marked) {
      parts.push({ text: tag.slice(start, index), match: marked });
      start = index;
    }
  }
  return parts;
}
