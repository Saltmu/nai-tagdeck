import type { DictEntry, PromptCategoryKey } from '../types';
import { getIndexedEntries } from './suggest';
import {
  VECTOR_MIN_MARGIN,
  VECTOR_MIN_SCORE,
  VECTOR_TOP_K,
  selectBestCategory,
  sparseCosine,
  weightedUnitVector,
  type PromptTagCategory,
  type TagVectorConfig,
} from './tagClassification';

export interface MisclassifiedEntry {
  tag: string;
  expected: PromptTagCategory;
  predicted: PromptTagCategory;
  score: number;
  margin: number;
}

export interface ClassificationEvaluation {
  total: number;
  correct: number;
  wrong: number;
  unclassified: number;
  accuracy: number;
  misclassified: MisclassifiedEntry[];
}

/**
 * 辞書の対象タグを1件ずつ隠して単語ベクトル分類の精度を評価する（Leave-One-Out）。
 * ベクトルの正規化とスコア集計は実行時分類と同じヘルパーを使う。
 */
export function evaluateTagVectorClassification(
  entries: readonly DictEntry[],
  allowed: readonly PromptCategoryKey[],
  config?: TagVectorConfig,
): ClassificationEvaluation {
  const allowedSet = new Set<PromptTagCategory>();
  for (const key of allowed) {
    if (key !== 'unclassified') allowedSet.add(key);
  }

  const indexed = getIndexedEntries(entries);
  const nonNegative = indexed.filter((item) => item.entry.category !== 'negative');
  const wordCatCounts = new Map<string, Map<PromptTagCategory, number>>();
  const byNormalizedTag = new Map<string, Array<{ category: PromptTagCategory; words: Set<string> }>>();
  for (const item of nonNegative) {
    const cat = item.entry.category as PromptTagCategory;
    const uniqueWords = new Set(item.tagWords);
    const sameTag = byNormalizedTag.get(item.tag);
    if (sameTag) sameTag.push({ category: cat, words: uniqueWords });
    else byNormalizedTag.set(item.tag, [{ category: cat, words: uniqueWords }]);

    for (const word of uniqueWords) {
      let counts = wordCatCounts.get(word);
      if (!counts) {
        counts = new Map();
        wordCatCounts.set(word, counts);
      }
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
  }

  const targets = nonNegative.filter((item) => allowedSet.has(item.entry.category as PromptTagCategory));
  const postings = new Map<string, number[]>();
  targets.forEach((item, idx) => {
    for (const word of new Set(item.tagWords)) {
      const list = postings.get(word);
      if (list) list.push(idx);
      else postings.set(word, [idx]);
    }
  });

  const topK = config?.topK ?? VECTOR_TOP_K;
  const minScore = config?.minScore ?? VECTOR_MIN_SCORE;
  const minMargin = config?.minMargin ?? VECTOR_MIN_MARGIN;

  let correct = 0;
  let wrong = 0;
  let unclassified = 0;
  const misclassified: MisclassifiedEntry[] = [];

  for (let i = 0; i < targets.length; i++) {
    const hidden = targets[i]!;
    const expected = hidden.entry.category as PromptTagCategory;
    // 本番判定では同名タグが辞書に存在しない前提になるため、正規化名が一致する全エントリを重み計算からも除外する
    const heldOutEntries = byNormalizedTag.get(hidden.tag) ?? [];
    const heldOutWordCounts = new Map<string, Map<PromptTagCategory, number>>();
    for (const entry of heldOutEntries) {
      for (const word of entry.words) {
        let counts = heldOutWordCounts.get(word);
        if (!counts) {
          counts = new Map();
          heldOutWordCounts.set(word, counts);
        }
        counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
      }
    }

    const weightOf = (word: string): number => {
      const counts = wordCatCounts.get(word);
      if (!counts) return 1;
      const excluded = heldOutWordCounts.get(word);
      let categories = counts.size;
      if (excluded) {
        for (const [cat, removed] of excluded) {
          if ((counts.get(cat) ?? 0) <= removed) categories--;
        }
      }
      return categories <= 1 ? 1 : 1 / categories;
    };

    const queryVec = weightedUnitVector(hidden.tagWords, weightOf);
    if (!queryVec) {
      unclassified++;
      continue;
    }

    const candidates = new Set<number>();
    for (const word of queryVec.keys()) {
      const list = postings.get(word);
      if (!list) continue;
      for (const idx of list) {
        if (idx !== i && targets[idx]!.tag !== hidden.tag) candidates.add(idx);
      }
    }

    if (candidates.size === 0) {
      unclassified++;
      continue;
    }

    const sims: Array<{ category: PromptTagCategory; sim: number }> = [];
    for (const idx of candidates) {
      const doc = targets[idx]!;
      const docVec = weightedUnitVector(doc.tagWords, weightOf);
      if (!docVec) continue;
      const dot = sparseCosine(queryVec, docVec);
      if (dot > 0) sims.push({ category: doc.entry.category as PromptTagCategory, sim: dot });
    }

    const prediction = selectBestCategory(sims, topK, minScore, minMargin);
    if (!prediction) {
      unclassified++;
    } else if (prediction.category === expected) {
      correct++;
    } else {
      wrong++;
      misclassified.push({
        tag: hidden.entry.tag,
        expected,
        predicted: prediction.category,
        score: prediction.score,
        margin: prediction.margin,
      });
    }
  }

  const classified = correct + wrong;
  return {
    total: targets.length,
    correct,
    wrong,
    unclassified,
    accuracy: classified > 0 ? correct / classified : 0,
    misclassified,
  };
}
