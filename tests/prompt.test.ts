import { describe, expect, it } from 'vitest';
import {
  buildCategoryPrompt,
  buildPrompt,
  clampWeight,
  formatTag,
  parseTagList,
} from '../src/lib/prompt';
import { emptyWorkspace } from '../src/lib/workspace';
import type { WorkTag } from '../src/types';

const tag = (t: string, enabled = true, weight = 1): WorkTag => ({ id: t, tag: t, enabled, weight });

describe('formatTag', () => {
  it('重み 1 はそのまま', () => {
    expect(formatTag('solo', 1, 'numeric')).toBe('solo');
    expect(formatTag('solo', 1, 'brace')).toBe('solo');
  });
  it('numeric は V4 記法にする', () => {
    expect(formatTag('blue eyes', 1.2, 'numeric')).toBe('1.2::blue eyes::');
    expect(formatTag('hat', 0.5, 'numeric')).toBe('0.5::hat::');
  });
  it('brace は 1.05 倍ごとに括弧を重ねる', () => {
    expect(formatTag('a', 1.05, 'brace')).toBe('{a}');
    expect(formatTag('a', 1.1, 'brace')).toBe('{{a}}');
    expect(formatTag('a', 0.95, 'brace')).toBe('[a]');
    expect(formatTag('a', 1.01, 'brace')).toBe('a');
  });
  it('空白だけのタグは出力しない', () => {
    expect(formatTag('  ', 1.2, 'numeric')).toBe('');
  });
});

describe('clampWeight', () => {
  it('範囲外と非数を丸める', () => {
    expect(clampWeight(0)).toBe(0.1);
    expect(clampWeight(10)).toBe(3);
    expect(clampWeight(Number.NaN)).toBe(1);
    expect(clampWeight(1.234)).toBe(1.23);
  });
});

describe('buildPrompt', () => {
  it('ON のタグだけを ", " でつなぐ', () => {
    expect(buildCategoryPrompt([tag('a'), tag('b', false), tag('c', true, 1.5)], 'numeric')).toBe(
      'a, 1.5::c::',
    );
  });
  it('カテゴリ順に連結し、空カテゴリは飛ばす', () => {
    const ws = emptyWorkspace();
    ws.composition = [tag('upper body')];
    ws.quality = [tag('masterpiece'), tag('off', false)];
    expect(buildPrompt(ws, 'numeric')).toBe('masterpiece, upper body');
  });
});

describe('parseTagList', () => {
  it('カンマと改行で分割する', () => {
    expect(parseTagList('a, b\nc,, ')).toEqual([
      { tag: 'a', weight: 1 },
      { tag: 'b', weight: 1 },
      { tag: 'c', weight: 1 },
    ]);
  });
  it('V4 の重みグループを読む', () => {
    expect(parseTagList('1.2::a, b::, c')).toEqual([
      { tag: 'a', weight: 1.2 },
      { tag: 'b', weight: 1.2 },
      { tag: 'c', weight: 1 },
    ]);
  });
  it('括弧の強調を読む（グループ含む）', () => {
    expect(parseTagList('{{a}}, [b], {c, d}, e')).toEqual([
      { tag: 'a', weight: 1.1 },
      { tag: 'b', weight: 0.95 },
      { tag: 'c', weight: 1.05 },
      { tag: 'd', weight: 1.05 },
      { tag: 'e', weight: 1 },
    ]);
  });
  it('出力した記法を読み戻せる', () => {
    for (const syntax of ['numeric', 'brace'] as const) {
      const text = formatTag('x', 1.1, syntax);
      expect(parseTagList(text)).toEqual([{ tag: 'x', weight: 1.1 }]);
    }
  });
});
