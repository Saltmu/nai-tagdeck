import type { Character, PromptCategoryKey, TagGroups, WeightSyntax, WorkTag } from '../types';
import { CHARACTER_CATEGORY_KEYS, PROMPT_CATEGORY_KEYS } from './categories';
import { MAX_ENABLED_CHARACTERS } from './characterLimits';

/** マイナスは V4.5 以降の「取り除く」指定（例: `-1::hat::`）。 */
export const WEIGHT_MIN = -3;
export const WEIGHT_MAX = 3;
export const WEIGHT_STEP = 0.05;
const BRACE_RATIO = 1.05;

export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 1;
  const clamped = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight));
  return Math.round(clamped * 100) / 100;
}

export function isNeutralWeight(weight: number): boolean {
  return Math.abs(weight - 1) < 1e-9;
}

export function formatWeight(weight: number): string {
  return String(Math.round(weight * 100) / 100);
}

export function formatTag(tag: string, weight: number, syntax: WeightSyntax): string {
  const t = tag.trim();
  if (!t) return '';
  const w = clampWeight(weight);
  if (isNeutralWeight(w)) return t;
  // 0 以下は括弧で表せないので、brace 指定でも数値の記法で出す
  if (syntax === 'numeric' || w <= 0) return `${formatWeight(w)}::${t}::`;
  const n = Math.round(Math.log(w) / Math.log(BRACE_RATIO));
  if (n === 0) return t;
  const [open, close] = n > 0 ? ['{', '}'] : ['[', ']'];
  const k = Math.abs(n);
  return open.repeat(k) + t + close.repeat(k);
}

export function buildCategoryPrompt(tags: readonly WorkTag[], syntax: WeightSyntax): string {
  return tags
    .filter((t) => t.enabled)
    .map((t) => formatTag(t.tag, t.weight, syntax))
    .filter(Boolean)
    .join(', ');
}

/** ベースでもキャラクターでも、カテゴリ順に連結する。 */
export function buildPrompt(
  groups: TagGroups,
  syntax: WeightSyntax,
  keys: readonly PromptCategoryKey[] = PROMPT_CATEGORY_KEYS,
): string {
  return keys
    .map((key) => buildCategoryPrompt(groups[key] ?? [], syntax))
    .filter(Boolean)
    .join(', ');
}

export interface CharacterPrompt {
  id: string;
  name: string;
  prompt: string;
}

/** ON のキャラクターのうち、出力するタグがあるものだけを返す。 */
export function buildCharacterPrompts(
  characters: readonly Character[],
  syntax: WeightSyntax,
  keys: readonly PromptCategoryKey[] = CHARACTER_CATEGORY_KEYS,
): CharacterPrompt[] {
  return characters.filter((c) => c.enabled).slice(0, MAX_ENABLED_CHARACTERS).flatMap((c) => {
    const prompt = buildPrompt(c.tags, syntax, keys);
    return prompt ? [{ id: c.id, name: c.name, prompt }] : [];
  });
}

export interface ParsedTag {
  tag: string;
  weight: number;
}

/**
 * カンマ・改行区切りのプロンプトをタグに分解する。公式UIから貼り付けたときのため、
 * `1.2::a, b::` のような重みのグループと `{a}` / `[[b]]` の括弧も読み取る。
 */
export function parseTagList(text: string, onWeightAdjusted?: (tag: string, weight: number, adjusted: number) => void): ParsedTag[] {
  const out: ParsedTag[] = [];
  let groupWeight: number | null = null;
  let braceDepth = 0;

  for (const raw of text.split(/[,\n]/)) {
    let s = raw.trim();
    if (!s) continue;

    let base: number = groupWeight ?? 1;
    const open = /^(-?\d+(?:\.\d+)?)::(.*)$/.exec(s);
    if (open) {
      base = Number.parseFloat(open[1] ?? '1');
      groupWeight = base;
      s = (open[2] ?? '').trim();
    }
    let closesGroup = false;
    if (s.endsWith('::')) {
      s = s.slice(0, -2).trim();
      closesGroup = true;
    }

    while (s.startsWith('{') || s.startsWith('[')) {
      braceDepth += s.startsWith('{') ? 1 : -1;
      s = s.slice(1).trimStart();
    }
    let closing = 0;
    while (s.endsWith('}') || s.endsWith(']')) {
      closing += s.endsWith('}') ? -1 : 1;
      s = s.slice(0, -1).trimEnd();
    }

    const weight = base * Math.pow(BRACE_RATIO, braceDepth);
    braceDepth += closing;
    if (closesGroup) groupWeight = null;
    if (s) {
      const adjusted = clampWeight(weight);
      if (Math.abs(weight - adjusted) > 1e-9) onWeightAdjusted?.(s, weight, adjusted);
      out.push({ tag: s, weight: adjusted });
    }
  }
  return out;
}
