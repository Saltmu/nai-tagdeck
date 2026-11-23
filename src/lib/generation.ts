import { DEFAULT_PARAMS, FREE_LIMITS, isFreeGeneration, type GenerationMode, type GenerationParams } from './novelai';

export const GENERATION_MODES = [
  { value: 'anime', label: 'アニメ' },
  { value: 'furry', label: 'ケモノ' },
] as const;

export function modeLabel(mode: string): string {
  return GENERATION_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/** どれも Anlas を消費しない範囲（1024×1024 相当以下）のサイズだけを用意する。 */
export const SIZE_PRESETS = [
  { key: 'portrait', label: '縦 832×1216', width: 832, height: 1216 },
  { key: 'landscape', label: '横 1216×832', width: 1216, height: 832 },
  { key: 'square', label: '正方形 1024×1024', width: 1024, height: 1024 },
  { key: 'tall', label: '縦長 768×1344', width: 768, height: 1344 },
  { key: 'wide', label: '横長 1344×768', width: 1344, height: 768 },
] as const;

export type SizeKey = (typeof SIZE_PRESETS)[number]['key'];

// V5 で使える値の一覧は公開されていないため、公式UIの既定値を先頭にして V4.5 までの値を並べる
export const SAMPLERS = [
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
] as const;

export function samplerLabel(sampler: string): string {
  return SAMPLERS.find((s) => s.value === sampler)?.label ?? sampler;
}

export const NOISE_SCHEDULES = ['karras', 'exponential', 'polyexponential'] as const;

export const STEPS_MIN = 1;
export const SCALE_MIN = 0;
export const SCALE_MAX = 10;
export const CFG_RESCALE_MAX = 1;
export const SEED_MAX = 4_294_967_295;

export interface GenerationSettings {
  mode: GenerationMode;
  size: SizeKey;
  steps: number;
  scale: number;
  sampler: string;
  noiseSchedule: string;
  /** null ならランダム。 */
  seed: number | null;
  cfgRescale: number;
  dynamicThresholding: boolean;
}

export const DEFAULT_GENERATION: GenerationSettings = {
  mode: 'anime',
  size: 'portrait',
  steps: DEFAULT_PARAMS.steps,
  scale: DEFAULT_PARAMS.scale,
  sampler: DEFAULT_PARAMS.sampler,
  noiseSchedule: DEFAULT_PARAMS.noiseSchedule,
  seed: null,
  cfgRescale: DEFAULT_PARAMS.cfgRescale,
  dynamicThresholding: DEFAULT_PARAMS.dynamicThresholding,
};

export function isDefaultGeneration(g: GenerationSettings): boolean {
  return (
    g.mode === DEFAULT_GENERATION.mode &&
    g.size === DEFAULT_GENERATION.size &&
    g.steps === DEFAULT_GENERATION.steps &&
    g.scale === DEFAULT_GENERATION.scale &&
    g.sampler === DEFAULT_GENERATION.sampler &&
    g.noiseSchedule === DEFAULT_GENERATION.noiseSchedule &&
    g.seed === DEFAULT_GENERATION.seed &&
    g.cfgRescale === DEFAULT_GENERATION.cfgRescale &&
    g.dynamicThresholding === DEFAULT_GENERATION.dynamicThresholding
  );
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function normalizeSteps(n: unknown): number {
  return Math.round(clamp(n, STEPS_MIN, FREE_LIMITS.maxSteps, DEFAULT_GENERATION.steps));
}

export function normalizeScale(n: unknown): number {
  return Math.round(clamp(n, SCALE_MIN, SCALE_MAX, DEFAULT_GENERATION.scale) * 10) / 10;
}

export function normalizeCfgRescale(n: unknown): number {
  return Math.round(clamp(n, 0, CFG_RESCALE_MAX, DEFAULT_GENERATION.cfgRescale) * 100) / 100;
}

export function normalizeSeed(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.trunc(Math.min(SEED_MAX, Math.max(0, n)));
}

export function normalizeGeneration(raw: unknown): GenerationSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    mode: pick(r.mode, GENERATION_MODES.map((m) => m.value), DEFAULT_GENERATION.mode),
    size: pick(r.size, SIZE_PRESETS.map((s) => s.key), DEFAULT_GENERATION.size),
    steps: normalizeSteps(r.steps),
    scale: normalizeScale(r.scale),
    sampler: pick(r.sampler, SAMPLERS.map((s) => s.value), DEFAULT_GENERATION.sampler),
    noiseSchedule: pick(r.noiseSchedule, NOISE_SCHEDULES, DEFAULT_GENERATION.noiseSchedule),
    seed: normalizeSeed(r.seed),
    cfgRescale: normalizeCfgRescale(r.cfgRescale),
    dynamicThresholding: r.dynamicThresholding === true,
  };
}

export function sizeOf(key: SizeKey): { width: number; height: number } {
  const preset = SIZE_PRESETS.find((s) => s.key === key) ?? SIZE_PRESETS[0];
  return { width: preset.width, height: preset.height };
}

export function toParams(g: GenerationSettings, seed: number): GenerationParams {
  const params = {
    ...sizeOf(g.size),
    steps: normalizeSteps(g.steps),
    scale: normalizeScale(g.scale),
    sampler: g.sampler,
    noiseSchedule: g.noiseSchedule,
    seed,
    cfgRescale: normalizeCfgRescale(g.cfgRescale),
    dynamicThresholding: g.dynamicThresholding === true,
  };
  // UI 側で範囲を絞っているが、念のため送信直前にも確かめる
  if (!isFreeGeneration(params)) throw new Error('Anlas を消費する設定になっています');
  return params;
}
