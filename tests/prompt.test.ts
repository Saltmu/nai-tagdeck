import { describe, expect, it } from 'vitest';
import {
  buildCategoryPrompt,
  buildCharacterPrompts,
  buildPrompt,
  clampWeight,
  formatTag,
  parseTagList,
} from '../src/lib/prompt';
import { emptyGroups, newCharacter } from '../src/lib/workspace';
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
  it('マイナスと 0 は brace 指定でも数値の記法で出す', () => {
    expect(formatTag('hat', -1, 'numeric')).toBe('-1::hat::');
    expect(formatTag('hat', -1, 'brace')).toBe('-1::hat::');
    expect(formatTag('hat', 0, 'brace')).toBe('0::hat::');
  });
  it('空白だけのタグは出力しない', () => {
    expect(formatTag('  ', 1.2, 'numeric')).toBe('');
  });
  it('括弧が極端に多くなる重みは数値記法に戻す', () => {
    expect(formatTag('a', 0.01, 'brace')).toBe('0.01::a::');
    expect(formatTag('a', 0.05, 'brace').startsWith('[')).toBe(true);
    expect(formatTag('a', 3, 'brace').startsWith('{')).toBe(true);
  });
});

describe('clampWeight', () => {
  it('範囲外と非数を丸める', () => {
    expect(clampWeight(0)).toBe(0);
    expect(clampWeight(-10)).toBe(-3);
    expect(clampWeight(10)).toBe(3);
    expect(clampWeight(Number.NaN)).toBe(1);
    expect(clampWeight(1.234)).toBe(1.23);
  });
});

describe('buildPrompt', () => {
  it('保存された15人からチェック済みの6人だけを生成プロンプトにする', () => {
    const characters = Array.from({ length: 15 }, (_, i) => {
      const character = newCharacter(i);
      character.tags.subject = [tag(`person-${i}`)];
      character.enabled = i >= 9;
      return character;
    });
    expect(buildCharacterPrompts(characters, 'numeric').map((c) => c.prompt))
      .toEqual(Array.from({ length: 6 }, (_, i) => `person-${i + 9}`));
    expect(buildCharacterPrompts(characters.map((c) => ({ ...c, enabled: true })), 'numeric')).toHaveLength(6);
  });

  it('背景・天候はベースのプロンプトに出力し、キャラクターには出力しない', () => {
    const groups = emptyGroups();
    groups.subject = [tag('1girl')];
    groups.background = [tag('forest')];
    groups.weather = [tag('night'), tag('rain', false)];
    expect(buildPrompt(groups, 'numeric')).toBe('1girl, forest, night');
    const character = newCharacter(0);
    character.tags.subject = [tag('girl')];
    character.tags.background = groups.background;
    character.tags.weather = groups.weather;
    expect(buildCharacterPrompts([character], 'numeric')[0]?.prompt).toBe('girl');
  });

  it('ON のタグだけを ", " でつなぐ', () => {
    expect(buildCategoryPrompt([tag('a'), tag('b', false), tag('c', true, 1.5)], 'numeric')).toBe(
      'a, 1.5::c::',
    );
  });
  it('カテゴリ順に連結し、空カテゴリは飛ばす', () => {
    const groups = emptyGroups();
    groups.composition = [tag('upper body')];
    groups.quality = [tag('masterpiece'), tag('off', false)];
    expect(buildPrompt(groups, 'numeric')).toBe('masterpiece, upper body');
    groups.style = [tag('watercolor (medium)')];
    groups.subject = [tag('1girl')];
    expect(buildPrompt(groups, 'numeric')).toBe('masterpiece, watercolor (medium), 1girl, upper body');
  });
  it('キャラクターは ON でタグがあるものだけ、キャラ用カテゴリの順に出す', () => {
    const c1 = newCharacter(0);
    c1.tags.appearance = [tag('red hair')];
    c1.tags.subject = [tag('girl')];
    c1.tags.quality = [tag('ignored')]; // キャラ用カテゴリではないので出さない
    const c2 = { ...newCharacter(1), enabled: false };
    c2.tags.subject = [tag('boy')];
    const c3 = newCharacter(2);
    c3.tags.subject = [tag('other', false)];
    expect(buildCharacterPrompts([c1, c2, c3], 'numeric')).toEqual([
      { id: c1.id, name: 'キャラ1', prompt: 'girl, red hair' },
    ]);
  });
  it('個別ネガティブと座標は指定があるキャラだけに載せる', () => {
    const c = newCharacter(0);
    c.tags.subject = [tag('girl')];
    c.negative = '';
    c.center = { x: 0.2, y: 0.5 };
    expect(buildCharacterPrompts([c], 'numeric')).toEqual([
      { id: c.id, name: c.name, prompt: 'girl', negative: '', center: { x: 0.2, y: 0.5 } },
    ]);
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
  it('マイナスの重みを読む', () => {
    expect(parseTagList('-1::hat::, -0.5::blur, noise::')).toEqual([
      { tag: 'hat', weight: -1 },
      { tag: 'blur', weight: -0.5 },
      { tag: 'noise', weight: -0.5 },
    ]);
  });
  it('出力した記法を読み戻せる', () => {
    for (const syntax of ['numeric', 'brace'] as const) {
      const text = formatTag('x', 1.1, syntax);
      expect(parseTagList(text)).toEqual([{ tag: 'x', weight: 1.1 }]);
    }
  });
  it('括弧と数値重みの混在を読む', () => {
    expect(parseTagList('{1.2::tag::}')).toEqual([{ tag: 'tag', weight: 1.26 }]);
    expect(parseTagList('1.2::{blue eyes}::')).toEqual([{ tag: 'blue eyes', weight: 1.26 }]);
    expect(parseTagList('{{1.2::tag::}}')).toEqual([{ tag: 'tag', weight: 1.32 }]);
    expect(parseTagList('{1.2::a, b::}')).toEqual([
      { tag: 'a', weight: 1.26 },
      { tag: 'b', weight: 1.26 },
    ]);
  });
  it('向きの違う括弧を入れ子にしても、外側の重みを後続タグへ残す', () => {
    expect(parseTagList('{[a], b}, c')).toEqual([
      { tag: 'a', weight: 1 },
      { tag: 'b', weight: 1.05 },
      { tag: 'c', weight: 1 },
    ]);
    expect(parseTagList('[{a}, b], c')).toEqual([
      { tag: 'a', weight: 1 },
      { tag: 'b', weight: 0.95 },
      { tag: 'c', weight: 1 },
    ]);
    expect(parseTagList('{[a]}, b')).toEqual([
      { tag: 'a', weight: 1 },
      { tag: 'b', weight: 1 },
    ]);
  });
  it('余った閉じ括弧は後続のタグへ重みを波及させない', () => {
    expect(parseTagList('foo}, bar')).toEqual([
      { tag: 'foo', weight: 1 },
      { tag: 'bar', weight: 1 },
    ]);
    expect(parseTagList('foo], bar, {baz}')).toEqual([
      { tag: 'foo', weight: 1 },
      { tag: 'bar', weight: 1 },
      { tag: 'baz', weight: 1.05 },
    ]);
    expect(parseTagList('{{a}}}, b')).toEqual([
      { tag: 'a', weight: 1.1 },
      { tag: 'b', weight: 1 },
    ]);
  });
});
