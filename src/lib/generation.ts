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

export type PresetSizeKey = (typeof SIZE_PRESETS)[number]['key'];

export type SizeKey = PresetSizeKey | 'custom';

/** よく使う無料枠拡張候補。すべて 64 の倍数かつ 1,048,576 px 以下。 */
export const CUSTOM_SIZE_SUGGESTIONS = [
  { width: 896, height: 1152 },
  { width: 1152, height: 896 },
  { width: 640, height: 1536 },
  { width: 1536, height: 640 },
  { width: 768, height: 1280 },
  { width: 1280, height: 768 },
] as const;

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
  /** size === 'custom' のときのみ保持する。64 の倍数かつ無料枠内。 */
  customWidth?: number;
  customHeight?: number;
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
    g.customWidth === undefined &&
    g.customHeight === undefined &&
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

/** 64 の倍数・[minSide, maxSide]・maxPixels 以下を満たす寸法か。 */
export function isValidFreeSize(width: unknown, height: unknown): boolean {
  const validSide = (side: unknown): side is number =>
    typeof side === 'number' &&
    Number.isFinite(side) &&
    Number.isInteger(side) &&
    side >= FREE_LIMITS.minSide &&
    side <= FREE_LIMITS.maxSide &&
    side % FREE_LIMITS.sizeStep === 0;
  return validSide(width) && validSide(height) && width * height <= FREE_LIMITS.maxPixels;
}

function roundStep(n: number): number {
  const step = FREE_LIMITS.sizeStep;
  return Math.round(n / step) * step;
}

function clampSide(n: number): number {
  return Math.min(FREE_LIMITS.maxSide, Math.max(FREE_LIMITS.minSide, n));
}

/**
 * 不正値・非 64 倍数・無料枠超過データを安全に補正する。
 * 64 の倍数丸め・辺クランプ後、画素数が超えるなら縦横比を保ちつつ縮小して
 * 64 の倍数に切り下げ、それでも収まらなければ既定サイズへフォールバックする。
 */
export function fitFreeSize(width: unknown, height: unknown): { width: number; height: number } {
  const fallback = { width: SIZE_PRESETS[0]!.width, height: SIZE_PRESETS[0]!.height };
  const w = typeof width === 'number' && Number.isFinite(width) ? clampSide(roundStep(width)) : fallback.width;
  const h = typeof height === 'number' && Number.isFinite(height) ? clampSide(roundStep(height)) : fallback.height;
  if (w * h <= FREE_LIMITS.maxPixels) return { width: w, height: h };
  const scale = Math.sqrt(FREE_LIMITS.maxPixels / (w * h));
  const step = FREE_LIMITS.sizeStep;
  const shrunkW = Math.max(FREE_LIMITS.minSide, Math.floor((w * scale) / step) * step);
  const shrunkH = Math.max(FREE_LIMITS.minSide, Math.floor((h * scale) / step) * step);
  if (shrunkW * shrunkH <= FREE_LIMITS.maxPixels && shrunkW >= FREE_LIMITS.minSide && shrunkH >= FREE_LIMITS.minSide) {
    return { width: shrunkW, height: shrunkH };
  }
  return fallback;
}

/**
 * UI で片辺を編集したときに使う。編集した辺を優先して 64 の倍数へ丸め・クランプし、
 * 無料枠を超える場合のみもう一方の辺を自動調整する。
 */
export function adjustCustomWidth(nextWidth: number, currentHeight: number): { width: number; height: number } {
  const width = clampSide(roundStep(Number.isFinite(nextWidth) ? nextWidth : FREE_LIMITS.minSide));
  const height = clampSide(roundStep(Number.isFinite(currentHeight) ? currentHeight : SIZE_PRESETS[0]!.height));
  if (width * height <= FREE_LIMITS.maxPixels) return { width, height };
  const adjusted = Math.max(
    FREE_LIMITS.minSide,
    Math.floor(FREE_LIMITS.maxPixels / width / FREE_LIMITS.sizeStep) * FREE_LIMITS.sizeStep,
  );
  return { width, height: Math.min(FREE_LIMITS.maxSide, adjusted) };
}

export function adjustCustomHeight(currentWidth: number, nextHeight: number): { width: number; height: number } {
  const height = clampSide(roundStep(Number.isFinite(nextHeight) ? nextHeight : FREE_LIMITS.minSide));
  const width = clampSide(roundStep(Number.isFinite(currentWidth) ? currentWidth : SIZE_PRESETS[0]!.width));
  if (width * height <= FREE_LIMITS.maxPixels) return { width, height };
  const adjusted = Math.max(
    FREE_LIMITS.minSide,
    Math.floor(FREE_LIMITS.maxPixels / height / FREE_LIMITS.sizeStep) * FREE_LIMITS.sizeStep,
  );
  return { width: Math.min(FREE_LIMITS.maxSide, adjusted), height };
}

export type SizeInput = Pick<GenerationSettings, 'size' | 'customWidth' | 'customHeight'>;

/** 生成設定から実効の寸法を返す。プリセット時はプリセット寸法、カスタム時は補正済みのカスタム寸法。 */
export function resolveSize(g: SizeInput): { width: number; height: number } {
  if (g.size === 'custom') return fitFreeSize(g.customWidth, g.customHeight);
  const preset = SIZE_PRESETS.find((s) => s.key === g.size) ?? SIZE_PRESETS[0]!;
  return { width: preset.width, height: preset.height };
}

/** 生成設定のサイズ表示。プリセット時はプリセットラベル、カスタム時は `カスタム WxH`。 */
export function sizeLabel(g: SizeInput): string {
  if (g.size === 'custom') {
    const { width, height } = resolveSize(g);
    return `カスタム ${width}×${height}`;
  }
  return SIZE_PRESETS.find((s) => s.key === g.size)?.label ?? g.size;
}

/**
 * ピクトグラムと生成パネルのサイズ選択で共通の変更パッチ。
 * カスタムは現在の実効寸法で入る。どちらを操作しても同じ状態が変わる。
 */
export function sizeChangePatch(g: SizeInput, next: SizeKey): Partial<GenerationSettings> {
  if (next === 'custom') {
    const { width, height } = resolveSize(g);
    return { size: 'custom', customWidth: width, customHeight: height };
  }
  return { size: next };
}

export function normalizeGeneration(raw: unknown): GenerationSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  const size = pick(r.size, [...SIZE_PRESETS.map((s) => s.key), 'custom' as const], DEFAULT_GENERATION.size);
  const base: GenerationSettings = {
    mode: pick(r.mode, GENERATION_MODES.map((m) => m.value), DEFAULT_GENERATION.mode),
    size,
    steps: normalizeSteps(r.steps),
    scale: normalizeScale(r.scale),
    sampler: pick(r.sampler, SAMPLERS.map((s) => s.value), DEFAULT_GENERATION.sampler),
    noiseSchedule: pick(r.noiseSchedule, NOISE_SCHEDULES, DEFAULT_GENERATION.noiseSchedule),
    seed: normalizeSeed(r.seed),
    cfgRescale: normalizeCfgRescale(r.cfgRescale),
    dynamicThresholding: r.dynamicThresholding === true,
  };
  if (size === 'custom') {
    const fitted = fitFreeSize(r.customWidth, r.customHeight);
    base.customWidth = fitted.width;
    base.customHeight = fitted.height;
  }
  return base;
}

export interface GenerationDiff {
  before: Partial<GenerationSettings>;
  after: Partial<GenerationSettings>;
}

/**
 * 現在の生成設定と部分パッチの差分を算出する。
 * サイズがプリセット⇔カスタム間で変わる場合は customWidth / customHeight も比較対象に含める。
 * 差分が 1 件もなければ undefined を返す。
 */
export function diffGenerationSettings(
  current: GenerationSettings,
  patch: Partial<GenerationSettings>,
): GenerationDiff | undefined {
  const keys = new Set(Object.keys(patch) as (keyof GenerationSettings)[]);
  if (
    patch.size !== undefined &&
    patch.size !== current.size &&
    (patch.size === 'custom' || current.size === 'custom')
  ) {
    keys.add('customWidth');
    keys.add('customHeight');
  }
  const next = normalizeGeneration({ ...current, ...patch });
  const before: Partial<GenerationSettings> = {};
  const after: Partial<GenerationSettings> = {};
  const assign = <K extends keyof GenerationSettings>(
    dst: Partial<GenerationSettings>,
    k: K,
    v: GenerationSettings[K],
  ) => {
    dst[k] = v;
  };
  let changed = false;
  for (const key of keys) {
    const prevValue = current[key];
    const nextValue = next[key];
    if (Object.is(prevValue, nextValue)) continue;
    assign(before, key, prevValue);
    assign(after, key, nextValue);
    changed = true;
  }
  return changed ? { before, after } : undefined;
}

export function sizeOf(key: SizeKey | SizeInput): { width: number; height: number } {
  if (typeof key === 'object') return resolveSize(key);
  if (key === 'custom') return { width: SIZE_PRESETS[0]!.width, height: SIZE_PRESETS[0]!.height };
  const preset = SIZE_PRESETS.find((s) => s.key === key) ?? SIZE_PRESETS[0]!;
  return { width: preset.width, height: preset.height };
}

export function toParams(g: GenerationSettings, seed: number): GenerationParams {
  // 送信直前の安全網：正規化済みの設定は無料枠内のはずだが、未正規化の
  // カスタム寸法が渡された場合は fit せず、isFreeGeneration で確実に拒否する。
  const dims = g.size === 'custom'
    ? {
        width: g.customWidth ?? SIZE_PRESETS[0]!.width,
        height: g.customHeight ?? SIZE_PRESETS[0]!.height,
      }
    : sizeOf(g.size);
  const params = {
    ...dims,
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
