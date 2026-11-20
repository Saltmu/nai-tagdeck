import { describe, expect, it } from 'vitest';
import { filterEntries, matchesFilter, normalize, suggest } from '../src/lib/suggest';
import type { CategoryKey, DictEntry } from '../src/types';

const entry = (tag: string, alias = '', category: CategoryKey = 'appearance', sort_order = 0): DictEntry => ({
  id: tag,
  tag,
  category,
  alias,
  default_weight: 1,
  sort_order,
  updated_at: '',
});

const dict = [
  entry('long hair', 'ロングヘア 長髪 ちょうはつ'),
  entry('blonde hair', '金髪 きんぱつ'),
  entry('blue eyes', '青い目 あおいめ'),
  entry('looking at viewer', 'カメラ目線 めせん', 'pose'),
  entry('Blue_Archive', '', 'subject'),
];

const tags = (q: string, opts = {}) => suggest(dict, q, opts).map((s) => s.entry.tag);

describe('normalize', () => {
  it('カタカナ・全角・大文字・アンダースコアを揃える', () => {
    expect(normalize('ＬＯＮＧ_Hair')).toBe('long hair');
    expect(normalize('ロングヘア')).toBe('ろんぐへあ');
  });
});

describe('suggest', () => {
  it('英語タグの前方一致', () => {
    expect(tags('bl')).toEqual(['blue eyes', 'blonde hair', 'Blue_Archive']);
  });
  it('日本語名・よみで一致する（カタカナ別名もひらがなで引ける）', () => {
    expect(tags('きん')).toEqual(['blonde hair']);
    expect(tags('金')).toEqual(['blonde hair']);
    expect(tags('ろんぐ')).toEqual(['long hair']);
    expect(tags('ちょう')).toEqual(['long hair']);
  });
  it('2語目の前方一致は後ろに並ぶ', () => {
    expect(tags('hair')).toEqual(['long hair', 'blonde hair']);
    expect(tags('lo')).toEqual(['long hair', 'looking at viewer']);
  });
  it('アンダースコアと空白を区別しない', () => {
    expect(tags('blue arc')).toEqual(['Blue_Archive']);
  });
  it('指定カテゴリを先に並べる', () => {
    expect(tags('bl', { category: 'subject' })[0]).toBe('Blue_Archive');
  });
  it('空の入力では何も返さない', () => {
    expect(tags('  ')).toEqual([]);
  });
  it('空欄のカテゴリ候補は、そのカテゴリの登録タグをすべて並び順で返す', () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry(`tag-${i}`, '', 'appearance', 11 - i));
    const original = [...entries];
    entries.push(entry('standing', '', 'pose'));
    const result = suggest(entries, '　 ', { category: 'appearance', showCategoryOnEmpty: true, limit: 2 });
    expect(result.map((s) => s.entry.tag)).toEqual(original.reverse().map((e) => e.tag));
    expect(result).toHaveLength(12);
    expect(entries[0]?.tag).toBe('tag-0');
  });
  it('空欄でもカテゴリが未指定または登録がなければ候補を返さない', () => {
    expect(tags('', { showCategoryOnEmpty: true })).toEqual([]);
    expect(tags('', { category: 'weather', showCategoryOnEmpty: true })).toEqual([]);
  });
  it('カテゴリ全件表示が有効でも、入力後は既存の検索と件数制限を使う', () => {
    expect(tags('bl', { category: 'appearance', showCategoryOnEmpty: true }))
      .toEqual(tags('bl', { category: 'appearance' }));
    expect(tags('bl', { category: 'appearance', showCategoryOnEmpty: true, limit: 1 })).toHaveLength(1);
  });
  it('件数を制限する', () => {
    expect(tags('b', { limit: 1 })).toHaveLength(1);
  });
});

describe('matchesFilter', () => {
  it('タグと別名の部分一致', () => {
    expect(matchesFilter(dict[0]!, 'hair')).toBe(true);
    expect(matchesFilter(dict[0]!, 'へあ')).toBe(true);
    expect(matchesFilter(dict[0]!, 'eyes')).toBe(false);
  });
});

describe('suggest: exact match', () => {
  it('puts the tag typed exactly first, then finds prefixed tags by the part after #', () => {
    const entries = [entry('hugging own legs', '', 'pose', 0), entry('hug', '', 'pose', 5), entry('source#hug', '', 'pose', 6)];
    expect(suggest(entries, 'hug').map((s) => s.entry.tag)).toEqual(['hug', 'hugging own legs', 'source#hug']);
  });

  it('reuses cached index across queries and does not leak mutable category arrays', () => {
    const entries = [entry('long hair', 'ロングヘア', 'appearance', 1), entry('blue eyes', '青い目', 'appearance', 0)];
    const first = suggest(entries, '', { category: 'appearance', showCategoryOnEmpty: true });
    first.pop();
    const second = suggest(entries, '', { category: 'appearance', showCategoryOnEmpty: true });
    expect(second.map((s) => s.entry.tag)).toEqual(['blue eyes', 'long hair']);
    expect(suggest(entries, 'ろんぐ').map((s) => s.entry.tag)).toEqual(['long hair']);
  });
});

describe('filterEntries', () => {
  it('filters by category and normalized tag or alias', () => {
    expect(filterEntries(dict, 'へあ', 'all').map((e) => e.tag)).toEqual(['long hair']);
    expect(filterEntries(dict, 'bl', 'subject').map((e) => e.tag)).toEqual(['Blue_Archive']);
    expect(filterEntries(dict, '', 'pose').map((e) => e.tag)).toEqual(['looking at viewer']);
  });
});
