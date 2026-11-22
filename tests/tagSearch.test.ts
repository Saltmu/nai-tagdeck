import { describe, expect, it } from 'vitest';
import {
  aliasMatchesQuery,
  buildTagAliasMap,
  highlightTag,
  isTagFilterActive,
  tagMatchesQuery,
  visibleWorkTags,
} from '../src/lib/tagSearch';
import type { WorkTag } from '../src/types';

const tag = (id: string, name: string, enabled = true): WorkTag => ({ id, tag: name, enabled, weight: 1 });

describe('タグ検索', () => {
  it('大小文字・全角・かな・アンダースコアの違いを吸収して部分一致する', () => {
    expect(tagMatchesQuery('long_hair', 'LONG HAIR')).toBe(true);
    expect(tagMatchesQuery('Ｌｏｎｇ hair', 'long')).toBe(true);
    expect(tagMatchesQuery('ロングヘア', 'ろんぐ')).toBe(true);
    expect(tagMatchesQuery('ｱｲｽ', 'あいす')).toBe(true);
    expect(tagMatchesQuery('hat', 'cat')).toBe(false);
    expect(tagMatchesQuery('hat', '   ')).toBe(true);
    expect(isTagFilterActive({ query: '  ', onlyEnabled: false })).toBe(false);
    expect(isTagFilterActive({ query: '', onlyEnabled: true })).toBe(true);
  });

  it('ON と検索語の両方に合うタグだけを残す', () => {
    const tags = [tag('a', 'long hair'), tag('b', 'short hair', false), tag('c', 'hat')];
    expect(visibleWorkTags(tags, { query: 'hair', onlyEnabled: false }).map((item) => item.id)).toEqual(['a', 'b']);
    expect(visibleWorkTags(tags, { query: 'hair', onlyEnabled: true }).map((item) => item.id)).toEqual(['a']);
    expect(visibleWorkTags(tags, { query: '', onlyEnabled: true }).map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('一致した範囲だけを元の表記のまま印にする', () => {
    expect(highlightTag('School Uniform', 'uniform')).toEqual([
      { text: 'School ', match: false },
      { text: 'Uniform', match: true },
    ]);
    expect(highlightTag('long__hair', 'hair')).toEqual([
      { text: 'long__', match: false },
      { text: 'hair', match: true },
    ]);
    expect(highlightTag('long_hair', 'long hair')).toEqual([{ text: 'long_hair', match: true }]);
    expect(highlightTag('ロング', 'ろんぐ')).toEqual([{ text: 'ロング', match: true }]);
    expect(highlightTag('ｱｲｽ', 'あいす')).toEqual([{ text: 'ｱｲｽ', match: true }]);
    expect(highlightTag('red hair and long hair', 'hair')).toEqual([
      { text: 'red ', match: false },
      { text: 'hair', match: true },
      { text: ' and long ', match: false },
      { text: 'hair', match: true },
    ]);
    expect(highlightTag('hat', 'cat')).toEqual([{ text: 'hat', match: false }]);
    expect(highlightTag('hat', '')).toEqual([{ text: 'hat', match: false }]);
    expect(highlightTag('赤いﾊﾞﾗ', 'ばら')).toEqual([
      { text: '赤い', match: false },
      { text: 'ﾊﾞﾗ', match: true },
    ]);
    expect(highlightTag('🌸花束', '花')).toEqual([
      { text: '🌸', match: false },
      { text: '花', match: true },
      { text: '束', match: false },
    ]);
    expect(highlightTag('ΟΣ flower', 'ος')).toEqual([
      { text: 'ΟΣ', match: true },
      { text: ' flower', match: false },
    ]);
    expect(highlightTag('xΣ', 'ς')).toEqual([
      { text: 'x', match: false },
      { text: 'Σ', match: true },
    ]);
  });

  it('辞書の日本語エイリアス（よみ含む）でも追加済みタグを絞り込める', () => {
    const aliasMap = buildTagAliasMap([
      { tag: 'blonde_hair', alias: '金髪 きんぱつ' },
      { tag: 'blonde hair', alias: 'ブロンド' },
      { tag: 'blue_eyes', alias: '青い目' },
      { tag: 'hat', alias: '   ' },
    ]);

    expect(aliasMap.get('blonde hair')).toEqual(['金髪 きんぱつ', 'ブロンド']);
    expect(aliasMap.has('hat')).toBe(false);
    expect(aliasMatchesQuery(aliasMap.get('blonde hair'), 'ぶろんど')).toBe(true);
    expect(tagMatchesQuery('blonde hair', 'きんぱつ', aliasMap.get('blonde hair'))).toBe(true);

    const tags = [tag('a', 'blonde hair'), tag('b', 'blue eyes', false), tag('c', 'hat')];
    expect(visibleWorkTags(tags, { query: '金髪', onlyEnabled: false }, aliasMap).map((item) => item.id)).toEqual(['a']);
    expect(visibleWorkTags(tags, { query: '目', onlyEnabled: false }, aliasMap).map((item) => item.id)).toEqual(['b']);
    expect(visibleWorkTags(tags, { query: '目', onlyEnabled: true }, aliasMap).map((item) => item.id)).toEqual([]);
  });
});
