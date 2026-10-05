import { describe, expect, it } from 'vitest';
import { matchesFilter, normalize, suggest } from '../src/lib/suggest';
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
