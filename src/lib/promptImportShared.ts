import type { Workspace } from '../types';
import type { GenerationSettings } from './generation';
import { newId } from './id';
import type { GenerationMode } from './novelai';
import { normalize } from './tagText';

/** `readPromptImport` が返す生成設定のうち、適用対象になる項目。 */
export interface PromptImportGeneration {
  values: Partial<GenerationSettings>;
  labels: string[];
  skipped: string[];
}

export interface PromptImport {
  base: Workspace['base'];
  furDataset?: string;
  characters: Workspace['characters'];
  negative?: Workspace['negative'];
  characterNegative?: string;
  generation: PromptImportGeneration;
  notes: string[];
}

export function importedBaseForMode(result: Pick<PromptImport, 'base' | 'furDataset'>, mode: GenerationMode): Workspace['base'] {
  if (!result.furDataset || mode === 'furry') return result.base;
  const key = normalize(result.furDataset);
  const exists = Object.values(result.base).some((tags) => tags.some((t) => normalize(t.tag) === key));
  if (exists) return result.base;
  // 品質カテゴリは PROMPT_CATEGORY_KEYS の先頭なので、分類済みタグがあっても送信時の先頭に保てる
  return {
    ...result.base,
    quality: [{ id: newId(), enabled: true, tag: result.furDataset, weight: 1 }, ...result.base.quality],
  };
}
