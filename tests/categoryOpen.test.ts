import { describe, expect, it, vi } from 'vitest';
import { loadCategoryOpen, saveCategoriesOpen, saveCategoryOpen, subscribeCategoryOpen } from '../src/lib/categoryOpen';

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

  it('localStorage を読めなくても例外にせず、画面へ開閉を伝える', () => {
    const seen: boolean[] = [];
    const stop = subscribeCategoryOpen((change) => {
      if (change.target === 'base' && change.categories.includes('appearance')) seen.push(change.open);
    });
    vi.stubGlobal('window', { get localStorage() { throw new Error('denied'); } });
    try {
      expect(() => saveCategoryOpen('base', 'appearance', false)).not.toThrow();
      expect(seen).toEqual([false]);
    } finally {
      stop();
      vi.unstubAllGlobals();
    }
  });

  it('書き込みがすべて失敗しても、保存結果とは別に画面へ開閉を伝える', () => {
    const seen: Array<{ categories: readonly string[]; open: boolean }> = [];
    const stop = subscribeCategoryOpen((change) => {
      if (change.target === 'base') seen.push({ categories: [...change.categories], open: change.open });
    });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error('quota'); },
      },
    });
    try {
      expect(() => saveCategoriesOpen('base', ['appearance', 'outfit'], false)).not.toThrow();
      expect(loadCategoryOpen('base', 'appearance')).toBe(true);
      expect(loadCategoryOpen('base', 'outfit')).toBe(true);
      expect(seen).toEqual([{ categories: ['appearance', 'outfit'], open: false }]);
    } finally {
      stop();
      vi.unstubAllGlobals();
    }
  });
});
