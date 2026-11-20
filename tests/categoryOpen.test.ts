import { describe, expect, it } from 'vitest';
import { loadCategoryOpen, saveCategoriesOpen, saveCategoryOpen } from '../src/lib/categoryOpen';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('カテゴリの開閉状態', () => {
  it('未保存のカテゴリは開き、閉じた状態と再度開いた状態を読み戻せる', () => {
    const storage = memoryStorage();
    expect(loadCategoryOpen('base', 'appearance', storage)).toBe(true);
    saveCategoryOpen('base', 'appearance', false, storage);
    expect(loadCategoryOpen('base', 'appearance', storage)).toBe(false);
    saveCategoryOpen('base', 'appearance', true, storage);
    expect(loadCategoryOpen('base', 'appearance', storage)).toBe(true);
  });

  it('ベース・キャラクター・カテゴリごとに独立して保存する', () => {
    const storage = memoryStorage();
    saveCategoryOpen('base', 'appearance', false, storage);
    saveCategoryOpen('character-1', 'outfit', false, storage);
    expect(loadCategoryOpen('base', 'appearance', storage)).toBe(false);
    expect(loadCategoryOpen('base', 'outfit', storage)).toBe(true);
    expect(loadCategoryOpen('character-1', 'appearance', storage)).toBe(true);
    expect(loadCategoryOpen('character-1', 'outfit', storage)).toBe(false);
    expect(loadCategoryOpen('character-2', 'outfit', storage)).toBe(true);
  });

  it('新しい背景・天候カテゴリも保存できる', () => {
    const storage = memoryStorage();
    saveCategoryOpen('base', 'background', false, storage);
    saveCategoryOpen('base', 'weather', false, storage);
    expect(loadCategoryOpen('base', 'background', storage)).toBe(false);
    expect(loadCategoryOpen('base', 'weather', storage)).toBe(false);
  });

  it('同じ欄のカテゴリをまとめて開閉し、他の欄は変えない', () => {
    const storage = memoryStorage();
    saveCategoriesOpen('base', ['appearance', 'outfit'], false, storage);
    expect(loadCategoryOpen('base', 'appearance', storage)).toBe(false);
    expect(loadCategoryOpen('base', 'outfit', storage)).toBe(false);
    expect(loadCategoryOpen('base', 'pose', storage)).toBe(true);
    expect(loadCategoryOpen('character-1', 'appearance', storage)).toBe(true);
    saveCategoriesOpen('base', ['appearance'], true, storage);
    expect(loadCategoryOpen('base', 'appearance', storage)).toBe(true);
    expect(loadCategoryOpen('base', 'outfit', storage)).toBe(false);
  });

  it('保存内容が不正でも初期状態で表示し、ストレージが使えなくても例外を出さない', () => {
    const invalidStorage = { getItem: () => 'invalid', setItem: () => {} };
    expect(loadCategoryOpen('base', 'appearance', invalidStorage)).toBe(true);
    const unavailableStorage = {
      getItem: (): string | null => { throw new Error('unavailable'); },
      setItem: () => { throw new Error('unavailable'); },
    };
    expect(loadCategoryOpen('base', 'appearance', unavailableStorage)).toBe(true);
    expect(() => saveCategoryOpen('base', 'appearance', false, unavailableStorage)).not.toThrow();
    expect(() => saveCategoriesOpen('base', ['appearance', 'outfit'], false, unavailableStorage)).not.toThrow();
  });
});
