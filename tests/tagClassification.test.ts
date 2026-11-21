import { describe, expect, it } from 'vitest';
import { CHARACTER_CATEGORY_KEYS, PROMPT_CATEGORY_KEYS } from '../src/lib/categories';
import { sampleDictionary } from '../src/lib/sampleDictionary';
import {
  classifyEditorTag,
  createTagVectorIndex,
  evaluateTagVectorClassification,
  predictTagCategory,
} from '../src/lib/tagClassification';
import type { DictEntry } from '../src/types';

function entry(tag: string, category: DictEntry['category'], id = `${category}:${tag}`): DictEntry {
  return { id, tag, category, alias: '', default_weight: 1, sort_order: 0, updated_at: '' };
}

describe('単語ベクトルによる未登録タグ分類', () => {
  it('同梱辞書で未登録の asymmetrical bomber jacket をキャラは自動分類し、ベースは候補として返す', () => {
    const index = createTagVectorIndex(sampleDictionary());

    const characterResult = classifyEditorTag('asymmetrical bomber jacket', index, CHARACTER_CATEGORY_KEYS, 'auto');
    expect(characterResult).toEqual({ category: 'outfit', suggestedCategory: null });

    const baseResult = classifyEditorTag('asymmetrical bomber jacket', index, PROMPT_CATEGORY_KEYS, 'suggest');
    expect(baseResult).toEqual({ category: 'unclassified', suggestedCategory: 'outfit' });
  });

  it('共通語がないタグやキャラに存在しないカテゴリのみの語は未分類・候補なしにする', () => {
    const index = createTagVectorIndex(sampleDictionary());

    expect(classifyEditorTag('completely unknown xyzzy', index, PROMPT_CATEGORY_KEYS, 'suggest')).toEqual({
      category: 'unclassified',
      suggestedCategory: null,
    });
    expect(classifyEditorTag('completely unknown xyzzy', index, CHARACTER_CATEGORY_KEYS, 'auto')).toEqual({
      category: 'unclassified',
      suggestedCategory: null,
    });
    // 背景・天候のタグと語を共有しても、キャラに存在しないカテゴリへは振り分けない
    expect(classifyEditorTag('abandoned train station', index, CHARACTER_CATEGORY_KEYS, 'auto')).toEqual({
      category: 'unclassified',
      suggestedCategory: null,
    });
    expect(classifyEditorTag('rain soaked alley', index, CHARACTER_CATEGORY_KEYS, 'auto')).toEqual({
      category: 'unclassified',
      suggestedCategory: null,
    });
    expect(classifyEditorTag('abandoned train station', index, PROMPT_CATEGORY_KEYS, 'suggest')).toEqual({
      category: 'unclassified',
      suggestedCategory: 'background',
    });
  });

  it('辞書の完全一致（一意・同名複数カテゴリ・対象外カテゴリ）は既存の分類を維持する', () => {
    const entries = [
      entry('blue jacket', 'outfit'),
      entry('sunny park', 'background'),
      entry('ambiguous jacket', 'appearance'),
      entry('ambiguous jacket', 'outfit'),
      entry('open jacket', 'outfit'),
      entry('lowres', 'negative'),
    ];
    const index = createTagVectorIndex(entries);

    expect(classifyEditorTag('BLUE_JACKET', index, CHARACTER_CATEGORY_KEYS, 'auto')).toEqual({
      category: 'outfit',
      suggestedCategory: null,
    });
    expect(classifyEditorTag('sunny park', index, CHARACTER_CATEGORY_KEYS, 'auto')).toEqual({
      category: 'unclassified',
      suggestedCategory: null,
    });
    // 同名で複数カテゴリに登録されているタグは、他の類似タグがあっても未分類・候補なしを維持する
    expect(classifyEditorTag('ambiguous jacket', index, CHARACTER_CATEGORY_KEYS, 'auto')).toEqual({
      category: 'unclassified',
      suggestedCategory: null,
    });
    expect(classifyEditorTag('ambiguous jacket', index, PROMPT_CATEGORY_KEYS, 'suggest')).toEqual({
      category: 'unclassified',
      suggestedCategory: null,
    });
    expect(classifyEditorTag('lowres', index, PROMPT_CATEGORY_KEYS, 'suggest')).toEqual({
      category: 'unclassified',
      suggestedCategory: null,
    });
  });

  it('複数カテゴリに出る語は重みを下げ、特定カテゴリに出る語を優先する', () => {
    const entries = [
      entry('blue eyes', 'appearance'),
      entry('blue sky', 'weather'),
      entry('blue ocean', 'background'),
      entry('jacket', 'outfit'),
    ];
    const index = createTagVectorIndex(entries);

    expect(index.wordWeights.get('blue')).toBeCloseTo(1 / 3);
    expect(index.wordWeights.get('jacket')).toBe(1);

    // "blue" は3カテゴリに出るため重みが下がり、衣装固有の "jacket" が勝つ
    const prediction = predictTagCategory('blue bomber jacket', index, PROMPT_CATEGORY_KEYS);
    expect(prediction?.category).toBe('outfit');
  });

  it('同率の類似度が複数カテゴリに分かれる場合、辞書の並び順にかかわらず未分類にする', () => {
    const entriesA = [
      entry('red a1', 'appearance'),
      entry('red a2', 'appearance'),
      entry('red a3', 'appearance'),
      entry('red a4', 'appearance'),
      entry('red o1', 'outfit'),
      entry('red o2', 'outfit'),
      entry('red o3', 'outfit'),
      entry('red o4', 'outfit'),
    ];
    const entriesB = [...entriesA].reverse();

    expect(predictTagCategory('red unknown', createTagVectorIndex(entriesA), CHARACTER_CATEGORY_KEYS)).toBeNull();
    expect(predictTagCategory('red unknown', createTagVectorIndex(entriesB), CHARACTER_CATEGORY_KEYS)).toBeNull();
  });

  it('辞書の登録・変更・削除に応じて索引を作り直すと次の判定に反映される', () => {
    const baseEntries = [entry('cape', 'outfit', 'e1')];
    expect(
      classifyEditorTag('velvet winter cape', createTagVectorIndex(baseEntries), CHARACTER_CATEGORY_KEYS, 'auto'),
    ).toEqual({ category: 'outfit', suggestedCategory: null });

    // カテゴリ変更
    const updatedEntries = [entry('cape', 'appearance', 'e1')];
    expect(
      classifyEditorTag('velvet winter cape', createTagVectorIndex(updatedEntries), CHARACTER_CATEGORY_KEYS, 'auto'),
    ).toEqual({ category: 'appearance', suggestedCategory: null });

    // 削除
    expect(
      classifyEditorTag('velvet winter cape', createTagVectorIndex([]), CHARACTER_CATEGORY_KEYS, 'auto'),
    ).toEqual({ category: 'unclassified', suggestedCategory: null });

    // 新規登録
    const addedEntries = [entry('hooded cape', 'outfit', 'e2'), entry('long cape', 'outfit', 'e3')];
    expect(
      classifyEditorTag('velvet winter cape', createTagVectorIndex(addedEntries), CHARACTER_CATEGORY_KEYS, 'auto'),
    ).toEqual({ category: 'outfit', suggestedCategory: null });
  });

  it('同梱辞書の Leave-One-Out 評価を再実行でき、ベース・キャラの件数と精度を算出できる', () => {
    const entries = sampleDictionary();
    const base = evaluateTagVectorClassification(entries, PROMPT_CATEGORY_KEYS);
    const character = evaluateTagVectorClassification(entries, CHARACTER_CATEGORY_KEYS);

    expect(base.correct + base.wrong + base.unclassified).toBe(base.total);
    expect(character.correct + character.wrong + character.unclassified).toBe(character.total);
    expect(base.total).toBeGreaterThan(600);
    expect(character.total).toBeGreaterThan(400);
    expect(base.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(character.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(base.misclassified).toHaveLength(base.wrong);
    expect(character.misclassified).toHaveLength(character.wrong);
  });

  it('同名異表記の辞書エントリが複数カテゴリにある場合も、評価時の重み計算が本番予測と一致する', () => {
    const entries = [
      entry('red jacket', 'outfit', 'e1'),
      entry('red_jacket', 'appearance', 'e2'),
      entry('jacket', 'outfit', 'e3'),
    ];
    const allowed = ['outfit', 'appearance', 'unclassified'] as const;

    const evaluated = evaluateTagVectorClassification(entries, allowed);
    const prodPrediction = predictTagCategory('red jacket', createTagVectorIndex(entries.slice(2)), allowed);

    expect(prodPrediction?.category).toBe('outfit');
    // red jacket（衣装）は正解、red_jacket（外見）は衣装と誤分類、jacket は共通語なしのため未分類になる
    expect(evaluated.total).toBe(3);
    expect(evaluated.correct).toBe(1);
    expect(evaluated.wrong).toBe(1);
    expect(evaluated.unclassified).toBe(1);
    expect(evaluated.misclassified).toHaveLength(1);
    expect(evaluated.misclassified[0]).toMatchObject({
      tag: 'red_jacket',
      expected: 'appearance',
      predicted: 'outfit',
    });
  });
});
