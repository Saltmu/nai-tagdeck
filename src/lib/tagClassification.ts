import type { CategoryKey, DictEntry, PromptCategoryKey } from '../types';
import { getIndexedEntries } from './suggest';
import { normalize, tagWords } from './tagText';

export type PromptTagCategory = Exclude<PromptCategoryKey, 'unclassified'>;

export const VECTOR_TOP_K = 3;
export const VECTOR_MIN_SCORE = 0.55;
export const VECTOR_MIN_MARGIN = 0.25;

export interface TagVectorConfig {
  topK?: number;
  minScore?: number;
  minMargin?: number;
}

interface IndexedVector {
  category: PromptTagCategory;
  tag: string;
  /** L2 正規化済みの単語ベクトル。 */
  weights: ReadonlyMap<string, number>;
}

export interface TagVectorIndex {
  readonly byTag: ReadonlyMap<string, ReadonlySet<CategoryKey>>;
  readonly wordWeights: ReadonlyMap<string, number>;
  readonly vectors: readonly IndexedVector[];
  readonly byWord: ReadonlyMap<string, readonly number[]>;
}

export interface VectorPrediction {
  category: PromptTagCategory;
  score: number;
  margin: number;
}

export interface TagRoutingResult {
  category: PromptCategoryKey;
  suggestedCategory: PromptTagCategory | null;
}

const TIE_EPSILON = 1e-12;

export function dictionaryCategories(entries: readonly DictEntry[]): Map<string, Set<CategoryKey>> {
  const byTag = new Map<string, Set<CategoryKey>>();
  for (const entry of entries) {
    const key = normalize(entry.tag);
    const categories = byTag.get(key) ?? new Set<CategoryKey>();
    categories.add(entry.category);
    byTag.set(key, categories);
  }
  return byTag;
}

/** タグ名が一致し、編集対象で使えるカテゴリが1つだけならそのカテゴリに入れる。 */
export function classifyTag(
  tag: string,
  byTag: ReadonlyMap<string, ReadonlySet<CategoryKey>>,
  allowed: readonly PromptCategoryKey[],
): PromptCategoryKey {
  const matches = byTag.get(normalize(tag));
  if (!matches) return 'unclassified';
  const candidates = allowed.filter((key) => key !== 'unclassified' && matches.has(key));
  return candidates.length === 1 ? candidates[0]! : 'unclassified';
}

/**
 * 単語列を TF × 語重みの L2 正規化ベクトルにする。
 * 実行時の索引と Leave-One-Out 評価で同じ正規化を使う。
 */
export function weightedUnitVector(
  words: readonly string[],
  weightOf: (word: string) => number,
): Map<string, number> | null {
  if (words.length === 0) return null;
  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const weighted = new Map<string, number>();
  let normSq = 0;
  for (const [word, tf] of counts) {
    const value = tf * weightOf(word);
    weighted.set(word, value);
    normSq += value * value;
  }
  if (normSq === 0) return null;
  const norm = Math.sqrt(normSq);
  for (const [word, value] of weighted) {
    weighted.set(word, value / norm);
  }
  return weighted;
}

function unitVector(words: readonly string[], wordWeights: ReadonlyMap<string, number>): Map<string, number> | null {
  // 辞書にない語は 1 カテゴリ相当の重み（1）で保持し、一致率の過大評価を防ぐ
  return weightedUnitVector(words, (word) => wordWeights.get(word) ?? 1);
}

/** 正規化済み疎ベクトル同士の内積。両方が単位ベクトルならコサイン類似度になる。 */
export function sparseCosine(query: ReadonlyMap<string, number>, doc: ReadonlyMap<string, number>): number {
  let dot = 0;
  for (const [word, qVal] of query) {
    const dVal = doc.get(word);
    if (dVal !== undefined) dot += qVal * dVal;
  }
  return dot;
}

/**
 * 辞書インデックスの単語情報を再利用し、カテゴリ数による重み付き単語ベクトルと逆索引を作る。
 * 辞書の登録・変更・削除時は新しい entries で作り直す。
 */
export function createTagVectorIndex(entries: readonly DictEntry[]): TagVectorIndex {
  const indexed = getIndexedEntries(entries);
  const byTag = new Map<string, Set<CategoryKey>>();
  const wordCategories = new Map<string, Set<PromptTagCategory>>();

  for (const item of indexed) {
    const categories = byTag.get(item.tag) ?? new Set<CategoryKey>();
    categories.add(item.entry.category);
    byTag.set(item.tag, categories);

    if (item.entry.category === 'negative') continue;
    for (const word of item.tagWords) {
      const seen = wordCategories.get(word) ?? new Set<PromptTagCategory>();
      seen.add(item.entry.category);
      wordCategories.set(word, seen);
    }
  }

  const wordWeights = new Map<string, number>();
  for (const [word, categories] of wordCategories) {
    wordWeights.set(word, 1 / categories.size);
  }

  const vectors: IndexedVector[] = [];
  const byWord = new Map<string, number[]>();

  for (const item of indexed) {
    if (item.entry.category === 'negative') continue;
    const weights = unitVector(item.tagWords, wordWeights);
    if (!weights) continue;
    const vectorIndex = vectors.length;
    vectors.push({ category: item.entry.category, tag: item.tag, weights });
    for (const word of weights.keys()) {
      const postings = byWord.get(word);
      if (postings) postings.push(vectorIndex);
      else byWord.set(word, [vectorIndex]);
    }
  }

  return { byTag, wordWeights, vectors, byWord };
}

export function selectBestCategory(
  similarities: Array<{ category: PromptTagCategory; sim: number }>,
  topK: number,
  minScore: number,
  minMargin: number,
): VectorPrediction | null {
  if (similarities.length === 0) return null;
  similarities.sort((a, b) => b.sim - a.sim);

  // 上位 K 件の境界で同率の類似度が並んだ場合でも辞書の並び順に左右されないよう均等に按分する
  const cutoffIndex = Math.min(topK, similarities.length) - 1;
  const cutoffSim = similarities[cutoffIndex]!.sim;
  const scores = new Map<PromptTagCategory, number>();
  let aboveCount = 0;
  let tiedCount = 0;

  for (const item of similarities) {
    if (item.sim > cutoffSim + TIE_EPSILON) {
      aboveCount++;
      scores.set(item.category, (scores.get(item.category) ?? 0) + item.sim);
    } else if (Math.abs(item.sim - cutoffSim) <= TIE_EPSILON) {
      tiedCount++;
    } else {
      break;
    }
  }

  const remainingSlots = topK - aboveCount;
  if (remainingSlots > 0 && tiedCount > 0) {
    const share = Math.min(1, remainingSlots / tiedCount);
    for (let i = aboveCount; i < aboveCount + tiedCount; i++) {
      const item = similarities[i]!;
      scores.set(item.category, (scores.get(item.category) ?? 0) + item.sim * share);
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;

  const [topCategory, topScore] = ranked[0]!;
  const secondScore = ranked[1]?.[1] ?? 0;
  const margin = topScore - secondScore;

  if (topScore < minScore || margin < minMargin) return null;
  return { category: topCategory, score: topScore, margin };
}

/**
 * 辞書未登録タグを単語ベクトルのコサイン類似度で推定する。
 * 辞書に登録済みのタグや、共通語がない・根拠が不十分なタグは null を返す。
 */
export function predictTagCategory(
  tag: string,
  index: TagVectorIndex,
  allowed: readonly PromptCategoryKey[],
  config: TagVectorConfig = {},
): VectorPrediction | null {
  const normalized = normalize(tag);
  if (!normalized || index.byTag.has(normalized)) return null;

  const queryVector = unitVector(tagWords(normalized), index.wordWeights);
  if (!queryVector) return null;

  const allowedSet = new Set<PromptTagCategory>();
  for (const key of allowed) {
    if (key !== 'unclassified') allowedSet.add(key);
  }
  if (allowedSet.size === 0) return null;

  const candidateIndices = new Set<number>();
  for (const word of queryVector.keys()) {
    const postings = index.byWord.get(word);
    if (!postings) continue;
    for (const idx of postings) {
      if (allowedSet.has(index.vectors[idx]!.category)) candidateIndices.add(idx);
    }
  }
  if (candidateIndices.size === 0) return null;

  const similarities: Array<{ category: PromptTagCategory; sim: number }> = [];
  for (const idx of candidateIndices) {
    const doc = index.vectors[idx]!;
    const dot = sparseCosine(queryVector, doc.weights);
    if (dot > 0) similarities.push({ category: doc.category, sim: dot });
  }

  return selectBestCategory(
    similarities,
    config.topK ?? VECTOR_TOP_K,
    config.minScore ?? VECTOR_MIN_SCORE,
    config.minMargin ?? VECTOR_MIN_MARGIN,
  );
}

/**
 * 編集画面上部のタグ追加欄で直接入力・貼り付けしたタグの分類先と候補を決める。
 * 辞書完全一致（同名で複数カテゴリに登録されたタグを含む）は既存の分類ルールを維持する。
 */
export function classifyEditorTag(
  tag: string,
  index: TagVectorIndex,
  allowed: readonly PromptCategoryKey[],
  mode: 'auto' | 'suggest',
  config?: TagVectorConfig,
): TagRoutingResult {
  const normalized = normalize(tag);
  if (index.byTag.has(normalized)) {
    return { category: classifyTag(tag, index.byTag, allowed), suggestedCategory: null };
  }
  const prediction = predictTagCategory(tag, index, allowed, config);
  if (!prediction) return { category: 'unclassified', suggestedCategory: null };
  if (mode === 'auto') return { category: prediction.category, suggestedCategory: null };
  return { category: 'unclassified', suggestedCategory: prediction.category };
}
