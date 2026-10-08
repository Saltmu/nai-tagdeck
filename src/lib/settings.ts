import type { Settings } from '../types';
import { DEFAULT_CHARACTER_NEGATIVE } from './novelai';

export const DEFAULT_SETTINGS: Settings = {
  weightSyntax: 'numeric',
  characterNegativePrompt: DEFAULT_CHARACTER_NEGATIVE,
};

/** 以前は設定に文字列で持っていたネガティブ。移行用に取り出す（なければ null）。 */
export function legacyNegativePrompt(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>).negativePrompt;
  return typeof value === 'string' ? value : null;
}

/** 保存データを読み込むとき、欠けている項目は既定値で補う（空文字は「ネガティブなし」として残す）。 */
export function normalizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof Settings, unknown>>) : {};
  const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  return {
    weightSyntax: r.weightSyntax === 'brace' ? 'brace' : 'numeric',
    characterNegativePrompt: text(r.characterNegativePrompt, DEFAULT_SETTINGS.characterNegativePrompt),
  };
}
