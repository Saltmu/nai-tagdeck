import type { Settings } from '../types';
import { DEFAULT_CHARACTER_NEGATIVE } from './novelai';

export const DEFAULT_SETTINGS: Settings = {
  weightSyntax: 'numeric',
  characterNegativePrompt: DEFAULT_CHARACTER_NEGATIVE,
  theme: 'system',
};

export function isDefaultSettings(s: Settings): boolean {
  return (
    s.weightSyntax === DEFAULT_SETTINGS.weightSyntax &&
    s.characterNegativePrompt === DEFAULT_SETTINGS.characterNegativePrompt &&
    s.theme === DEFAULT_SETTINGS.theme
  );
}

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
    // theme を持たない旧データ・旧バックアップは 'system' へフォールバックする。
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
  };
}
