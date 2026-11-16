import { describe, expect, it } from 'vitest';
import {
  findDuplicate,
  fromCSV,
  fromJSON,
  mergeEntries,
  parseCSVRows,
  toCSV,
  toJSON,
} from '../src/lib/io';
import type { DictEntry } from '../src/types';

const e = (id: string, tag: string, extra: Partial<DictEntry> = {}): DictEntry => ({
  id,
  tag,
  category: 'quality',
  alias: '',
  default_weight: 1,
  sort_order: 0,
  updated_at: '2026-01-01T00:00:00.000Z',
  ...extra,
});

describe('JSON', () => {
  it('旧カテゴリのキーと表示名を衣装として読み込む', () => {
    const entries = [e('open', 'open jacket', { category: 'outfit', alias: '前開き' })];
    const json = toJSON(entries).replace('"category": "outfit"', '"category": "dress_state"');
    const csv = toCSV(entries).replace(',outfit,', ',着衣状態,');
    expect(fromJSON(json)).toEqual({ entries, errors: [] });
    expect(fromCSV(csv)).toEqual({ entries, errors: [] });
  });

  it('背景・場所と時間・天候をJSON/CSVで読み戻せる', () => {
    const entries = [e('bg', 'forest', { category: 'background' }), e('time', 'night', { category: 'weather' })];
    expect(fromJSON(toJSON(entries))).toEqual({ entries, errors: [] });
    expect(fromCSV(toCSV(entries))).toEqual({ entries, errors: [] });
    expect(fromCSV('category,tag\n背景・場所,forest\n時間・天候,night\n').entries.map((entry) => entry.category))
      .toEqual(['background', 'weather']);
  });

  it('書き出した内容を読み戻せる', () => {
    const entries = [e('1', 'masterpiece', { alias: '傑作' }), e('2', 'solo', { category: 'subject' })];
    expect(fromJSON(toJSON(entries))).toEqual({ entries, errors: [] });
  });
  it('配列だけの JSON も受け付け、カテゴリは表示名でもよい', () => {
    const r = fromJSON('[{"tag":"smile","category":"外見"}]');
    expect(r.errors).toEqual([]);
    expect(r.entries[0]).toMatchObject({ tag: 'smile', category: 'appearance', default_weight: 1 });
  });
  it('不正な行はエラーにして残りは読む', () => {
    const r = fromJSON('{"entries":[{"tag":"","category":"quality"},{"tag":"a","category":"x"},{"tag":"b","category":"pose"}]}');
    expect(r.entries.map((x) => x.tag)).toEqual(['b']);
    expect(r.errors).toHaveLength(2);
  });
  it('壊れた JSON', () => {
    expect(fromJSON('{').errors).toHaveLength(1);
  });
});

describe('CSV', () => {
  it('引用符・カンマ・改行を含むセルを往復できる', () => {
    const entries = [e('1', 'a, "b"', { alias: '行1\n行2' })];
    expect(fromCSV(toCSV(entries))).toEqual({ entries, errors: [] });
  });
  it('BOM と CRLF を扱う', () => {
    expect(parseCSVRows('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('列の順番が違っても、足りない列があっても読める', () => {
    const r = fromCSV('category,tag\nポーズ,standing\n');
    expect(r.errors).toEqual([]);
    expect(r.entries[0]).toMatchObject({ tag: 'standing', category: 'pose', alias: '', sort_order: 0 });
  });
  it('見出しがなければエラー', () => {
    expect(fromCSV('a,b\n').errors).toHaveLength(1);
  });
});

describe('mergeEntries', () => {
  const existing = [e('1', 'masterpiece'), e('2', 'solo', { category: 'subject' })];

  it('merge: 同じカテゴリ＋タグは上書きし、id は既存を保つ', () => {
    const merged = mergeEntries(existing, [e('x', 'Masterpiece', { alias: '傑作' }), e('3', 'smile')], 'merge');
    expect(merged.map((m) => [m.id, m.tag])).toEqual([
      ['1', 'Masterpiece'],
      ['3', 'smile'],
      ['2', 'solo'],
    ]);
  });
  it('merge: id が一致すればタグ名の変更として扱う', () => {
    const merged = mergeEntries(existing, [e('1', 'best quality')], 'merge');
    expect(merged.map((m) => m.tag)).toEqual(['best quality', 'solo']);
  });
  it('replace: 取り込んだ内容だけにする', () => {
    expect(mergeEntries(existing, [e('9', 'z')], 'replace').map((m) => m.id)).toEqual(['9']);
  });
});

describe('findDuplicate', () => {
  it('自分以外の同じカテゴリ＋タグを見つける', () => {
    const list = [e('1', 'solo')];
    expect(findDuplicate(list, { id: '2', tag: 'SOLO', category: 'quality' })?.id).toBe('1');
    expect(findDuplicate(list, { id: '1', tag: 'solo', category: 'quality' })).toBeUndefined();
    expect(findDuplicate(list, { id: '2', tag: 'solo', category: 'pose' })).toBeUndefined();
  });
});
