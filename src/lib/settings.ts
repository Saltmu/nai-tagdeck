import type { Settings } from '../types';
import { DEFAULT_CHARACTER_NEGATIVE, DEFAULT_NEGATIVE } from './novelai';

export const DEFAULT_SETTINGS: Settings = {
  weightSyntax: 'numeric',
  negativePrompt: DEFAULT_NEGATIVE,
  characterNegativePrompt: DEFAULT_CHARACTER_NEGATIVE,
};

/** 保存データを読み込むとき、欠けている項目は既定値で補う（空文字は「ネガティブなし」として残す）。 */
export function normalizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof Settings, unknown>>) : {};
  const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  return {
    weightSyntax: r.weightSyntax === 'brace' ? 'brace' : 'numeric',
    negativePrompt: text(r.negativePrompt, DEFAULT_SETTINGS.negativePrompt),
    characterNegativePrompt: text(r.characterNegativePrompt, DEFAULT_SETTINGS.characterNegativePrompt),
  };
}
