import type { CategoryKey, DictEntry, PromptCategoryKey } from '../types';
import { normalize } from './suggest';

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
