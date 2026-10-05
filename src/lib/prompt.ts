import type { WeightSyntax, WorkTag, Workspace } from '../types';
import { CATEGORY_KEYS } from './categories';

export const WEIGHT_MIN = 0.1;
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
  if (syntax === 'numeric') return `${formatWeight(w)}::${t}::`;
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

export function buildPrompt(workspace: Workspace, syntax: WeightSyntax): string {
  return CATEGORY_KEYS.map((key) => buildCategoryPrompt(workspace[key] ?? [], syntax))
    .filter(Boolean)
    .join(', ');
}

export interface ParsedTag {
  tag: string;
  weight: number;
}

/**
 * カンマ・改行区切りのプロンプトをタグに分解する。公式UIから貼り付けたときのため、
 * `1.2::a, b::` のような重みのグループと `{a}` / `[[b]]` の括弧も読み取る。
 */
export function parseTagList(text: string): ParsedTag[] {
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
    if (s) out.push({ tag: s, weight: clampWeight(weight) });
  }
  return out;
}
