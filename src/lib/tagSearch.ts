import type { DictEntry, WorkTag } from '../types';
import { splitInteraction } from './interaction';
import { normalize } from './tagText';

/** 表示中のタグを、検索語と ON だけで絞る。 */
export interface TagFilter {
  query: string;
  onlyEnabled: boolean;
}

export function isTagFilterActive(filter: TagFilter): boolean {
  return filter.onlyEnabled || normalize(filter.query).length > 0;
}

/** 辞書エントリから、正規化タグ名ごとの日本語エイリアス一覧を引ける索引を作る。 */
export function buildTagAliasMap(entries: readonly Pick<DictEntry, 'tag' | 'alias'>[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of entries) {
    const alias = entry.alias.trim();
    if (!alias) continue;
    const key = normalize(entry.tag);
    if (!key) continue;
    const list = map.get(key);
    if (!list) {
      map.set(key, [alias]);
    } else if (!list.includes(alias)) {
      list.push(alias);
    }
  }
  return map;
}

/** エイリアス（日本語名・よみ）のいずれかが検索語に部分一致するか。 */
export function aliasMatchesQuery(aliases: string | readonly string[] | undefined, query: string): boolean {
  const q = normalize(query);
  if (q.length === 0 || !aliases) return false;
  const list = typeof aliases === 'string' ? [aliases] : aliases;
  return list.some((alias) => normalize(alias).includes(q));
}

/** タグ名に対応する辞書エイリアスを引く。インタラクション接頭辞（source# 等）付きなら本体でも引く。 */
export function resolveTagAliases(
  tag: string,
  aliasMap: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
  const exact = aliasMap.get(normalize(tag));
  if (exact) return exact;
  const { interaction, body } = splitInteraction(tag);
  if (!interaction) return undefined;
  const bodyKey = normalize(body);
  return bodyKey ? aliasMap.get(bodyKey) : undefined;
}

/** 正規化（大小文字・全角半角・かな・アンダースコア）後の部分一致。エイリアスも検索対象にする。 */
export function tagMatchesQuery(tag: string, query: string, aliases?: string | readonly string[]): boolean {
  const q = normalize(query);
  return q.length === 0 || normalize(tag).includes(q) || aliasMatchesQuery(aliases, query);
}

export function visibleWorkTags(
  tags: readonly WorkTag[],
  filter: TagFilter,
  aliasMap?: ReadonlyMap<string, readonly string[]>,
): WorkTag[] {
  return tags.filter(
    (tag) =>
      (!filter.onlyEnabled || tag.enabled) &&
      tagMatchesQuery(tag.tag, filter.query, aliasMap ? resolveTagAliases(tag.tag, aliasMap) : undefined),
  );
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

interface NormUnit {
  /** 元の文字列上の UTF-16 位置。合成された文字はまとめて一つの範囲にする。 */
  start: number;
  end: number;
  /** 正規化後の1文字。絵文字など、複数の UTF-16 符号単位になることがある。 */
  ch: string;
}

function codePointEnd(text: string, index: number): number {
  const code = text.codePointAt(index);
  if (code === undefined) return Math.min(text.length, index + 1);
  return index + (code > 0xffff ? 2 : 1);
}

/**
 * NFKC で隣の文字と合成される範囲（半角カナ＋濁点など）を、元の位置つきで取り出す。
 * 次の文字を足しても正規化結果がつながらなくなるまで範囲を伸ばす。
 */
function nfkcUnits(text: string): NormUnit[] {
  const units: NormUnit[] = [];
  let index = 0;
  while (index < text.length) {
    let end = codePointEnd(text, index);
    let norm = text.slice(index, end).normalize('NFKC');
    while (end < text.length) {
      const nextEnd = codePointEnd(text, end);
      const nextNorm = text.slice(end, nextEnd).normalize('NFKC');
      const combined = text.slice(index, nextEnd).normalize('NFKC');
      if (combined === norm + nextNorm) break;
      end = nextEnd;
      norm = combined;
    }
    for (let offset = 0; offset < norm.length; ) {
      const charEnd = codePointEnd(norm, offset);
      units.push({ start: index, end, ch: norm.slice(offset, charEnd) });
      offset = charEnd;
    }
    index = end;
  }
  return units;
}

/**
 * 文字列全体の toLowerCase を、各文字の元の位置へ割り当てる。
 * 語末の Σ は全体では ς になり、1文字ずつだと σ になる。
 * 長さが一致しない変換には対応できない。
 */
function lowerUnits(units: NormUnit[]): NormUnit[] | null {
  const text = units.map((unit) => unit.ch).join('');
  const lower = text.toLowerCase();
  const perChar: NormUnit[] = [];
  for (const unit of units) {
    const folded = unit.ch.toLowerCase();
    for (let offset = 0; offset < folded.length; ) {
      const charEnd = codePointEnd(folded, offset);
      perChar.push({ start: unit.start, end: unit.end, ch: folded.slice(offset, charEnd) });
      offset = charEnd;
    }
  }
  if (perChar.map((unit) => unit.ch).join('').length !== lower.length) return null;
  let offset = 0;
  return perChar.map((unit) => {
    const ch = lower.slice(offset, offset + unit.ch.length);
    offset += unit.ch.length;
    return ch === unit.ch ? unit : { ...unit, ch };
  });
}

/** 小文字化のあと、normalize と同じかなとアンダースコアの規則を適用する。 */
function foldKanaAndUnderscore(unit: NormUnit): NormUnit[] {
  const folded = unit.ch
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/_/g, ' ');
  const units: NormUnit[] = [];
  for (let offset = 0; offset < folded.length; ) {
    const charEnd = codePointEnd(folded, offset);
    units.push({ start: unit.start, end: unit.end, ch: folded.slice(offset, charEnd) });
    offset = charEnd;
  }
  return units;
}

/**
 * normalize と同じ文字列を、元の文字位置つきで作る。
 * 空白の連続と両端の空白は、normalize と同様に1つの空白へ畳んでから除く。
 * 対応を取れないときは null。
 */
function normalizedUnits(tag: string): NormUnit[] | null {
  const units: NormUnit[] = [];
  let pending: { start: number; end: number } | null = null;
  const flushSpace = () => {
    if (!pending) return;
    units.push({ start: pending.start, end: pending.end, ch: ' ' });
    pending = null;
  };

  const lowered = lowerUnits(nfkcUnits(tag));
  if (!lowered) return null;
  for (const unit of lowered.flatMap(foldKanaAndUnderscore)) {
    if (/\s/u.test(unit.ch)) {
      pending = pending ? { start: pending.start, end: unit.end } : { start: unit.start, end: unit.end };
    } else {
      flushSpace();
      units.push(unit);
    }
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
  if (!units) return normalize(tag) === q ? [{ text: tag, match: true }] : plain;

  const norm = units.map((unit) => unit.ch).join('');
  // indexOf は UTF-16 の位置を返す。units の添字とは、絵文字のように1文字が2符号単位のときずれる。
  const unitAt: number[] = [];
  units.forEach((unit, index) => {
    for (let offset = 0; offset < unit.ch.length; offset += 1) unitAt.push(index);
  });
  const matched = Array<boolean>(tag.length).fill(false);
  let from = 0;
  let found = false;
  while (from <= norm.length - q.length) {
    const at = norm.indexOf(q, from);
    if (at < 0) break;
    const startUnit = unitAt[at];
    const endUnit = unitAt[at + q.length - 1];
    if (startUnit === undefined || endUnit === undefined) break;
    for (let index = startUnit; index <= endUnit; index += 1) {
      const unit = units[index];
      if (!unit) continue;
      for (let pos = unit.start; pos < unit.end; pos += 1) matched[pos] = true;
    }
    found = true;
    from = at + q.length;
  }
  if (!found) return plain;

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
