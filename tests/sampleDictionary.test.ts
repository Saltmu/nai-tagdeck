import { describe, expect, it } from 'vitest';
import { restoreInitialDictionary, sampleDictionary } from '../src/lib/sampleDictionary';
import { normalize } from '../src/lib/tagText';
import type { DictEntry } from '../src/types';
import { tagsFromText } from '../src/lib/workspace';
import { DEFAULT_NEGATIVE } from '../src/lib/novelai';

describe('初期辞書の復元', () => {
  it('空の辞書にすべての初期タグと体型タグを追加する', () => {
    const entries = restoreInitialDictionary([]);
    expect(entries).toHaveLength(sampleDictionary().length);
    for (const tag of ['lean muscular', 'muscular', 'slim', 'skinny', 'plump', 'curvy', 'wide hips', 'narrow waist']) {
      expect(entries.find((entry) => entry.tag === tag)).toMatchObject({ category: 'appearance', default_weight: 1 });
    }
    expect(new Set(entries.map((entry) => normalize(entry.tag))).size).toBe(entries.length);
  });

  it('同名タグはカテゴリが異なっても重複させず、既存の編集内容を保持する', () => {
    const custom: DictEntry = {
      id: 'custom-muscle', tag: ' LEAN_MUSCULAR ', category: 'pose', alias: '自分用の体型',
      default_weight: 1.35, sort_order: 999, updated_at: '2026-01-01T00:00:00.000Z',
    };
    const original = [{ ...custom }];
    const restored = restoreInitialDictionary(original);
    expect(restored.filter((entry) => normalize(entry.tag) === 'lean muscular')).toEqual([custom]);
    expect(original).toEqual([custom]);
    expect(restored).toHaveLength(sampleDictionary().length);
  });

  it('追加した独自タグを残し、削除した初期タグを復元する', () => {
    const initial = sampleDictionary();
    const custom: DictEntry = { ...initial[0]!, id: 'custom', tag: 'my custom tag' };
    const restored = restoreInitialDictionary([...initial.filter((entry) => entry.tag !== 'muscular'), custom]);
    expect(restored).toContainEqual(custom);
    expect(restored.some((entry) => entry.tag === 'muscular')).toBe(true);
    expect(restored).toHaveLength(initial.length + 1);
  });

  it('繰り返し復元しても件数・ID・更新日時が変わらない', () => {
    const restored = restoreInitialDictionary([]);
    expect(restoreInitialDictionary(restored)).toEqual(restored);
  });

  it('背景・場所と時間・天候を分け、既存の背景・天候タグも初期辞書では分類し直す', () => {
    const entries = sampleDictionary();
    for (const tag of ['simple background', 'white background', 'indoors', 'outdoors', 'bedroom', 'classroom', 'forest', 'beach']) {
      expect(entries.find((entry) => entry.tag === tag)?.category).toBe('background');
    }
    for (const tag of ['day', 'night', 'sunset', 'cloudy sky', 'rain', 'snow']) {
      expect(entries.find((entry) => entry.tag === tag)?.category).toBe('weather');
    }
  });

  it('以前のカテゴリで登録した背景・天候タグは復元時に編集内容を保持する', () => {
    const oldEntries = sampleDictionary().filter((entry) => ['rain', 'white background'].includes(entry.tag))
      .map((entry): DictEntry => ({ ...entry, category: entry.tag === 'rain' ? 'effect' : 'composition' }));
    const restored = restoreInitialDictionary(oldEntries);
    for (const entry of oldEntries) {
      expect(restored.filter((item) => item.tag === entry.tag)).toEqual([entry]);
    }
  });
});

describe('初期辞書のタグ', () => {
  it('カンマ区切りの複合タグを持たず、european と表記する', () => {
    const entries = sampleDictionary();
    expect(entries.some((entry) => entry.tag.includes(','))).toBe(false);
    expect(entries.some((entry) => entry.tag === 'europian')).toBe(false);
    expect(entries.find((entry) => entry.tag === 'european')).toMatchObject({ category: 'appearance', alias: '白人 はくじん' });
    expect(entries.find((entry) => entry.tag === 'hetero')?.alias).toContain('だんじょ');
    for (const tag of ['1girl', '1boy', "adam's apple", 'larynx', 'flat chest', 'male face']) {
      expect(entries.some((entry) => entry.tag === tag), tag).toBe(true);
    }
  });
});

describe('初期辞書のネガティブ', () => {
  it('既定のネガティブのタグをすべて含む（ネガティブかエフェクトとして）', () => {
    const entries = sampleDictionary();
    for (const tag of tagsFromText(DEFAULT_NEGATIVE).map((t) => t.tag)) {
      const entry = entries.find((e) => normalize(e.tag) === normalize(tag));
      expect(entry?.category, tag).toMatch(/^(negative|effect)$/);
    }
    expect(entries.find((e) => e.tag === 'nsfw')?.category).toBe('negative');
  });
});
