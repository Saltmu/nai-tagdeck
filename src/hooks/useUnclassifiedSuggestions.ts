import { useMemo } from 'react';
import type { PromptCategoryKey, WorkTag } from '../types';
import { normalize } from '../lib/tagText';
import { predictTagCategory, type TagVectorIndex } from '../lib/tagClassification';
import type { BaseCategorySuggestion } from '../components/CategorySection';

/**
 * 未分類タグへ、現在の辞書と単語ベクトルから推定した候補カテゴリを結び付ける。
 * 上部入力欄は自動振り分けになったため、候補は入力時の記録ではなく
 * 現在の未分類一覧からその都度計算する。PNG 取り込みやプリセット復元で
 * 未分類に入ったタグにも付く。行が置き換われば計算し直すので、古い候補は引き継がない。
 * 辞書に登録済みのタグ（同名で複数カテゴリに登録されたものを含む）や
 * 根拠が不十分なタグには候補を付けない。
 */
export function useUnclassifiedSuggestions(
  unclassified: readonly WorkTag[],
  index: TagVectorIndex,
  allowed: readonly PromptCategoryKey[],
) {
  const suggestions = useMemo<Record<string, BaseCategorySuggestion>>(() => {
    const next: Record<string, BaseCategorySuggestion> = {};
    for (const tag of unclassified) {
      const prediction = predictTagCategory(tag.tag, index, allowed);
      if (prediction) next[tag.id] = { tag: normalize(tag.tag), category: prediction.category };
    }
    return next;
  }, [unclassified, index, allowed]);
  return { suggestions };
}
