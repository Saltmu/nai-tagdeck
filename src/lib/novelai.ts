/**
 * NovelAI Diffusion V5 の生成リクエスト。公式 Web UI が送っている内容（2026-10-05 に取得）に合わせている。
 * 値の根拠と未確認の点は docs/novelai-api.md を参照。
 */

export const GENERATE_URL = 'https://image.novelai.net/ai/generate-image';
export const NAI_MODEL = 'nai-diffusion-5-full';

/** Opus プランで Anlas を消費しない条件（最新の条件は公式で確認すること）。 */
export const FREE_LIMITS = { maxPixels: 1024 * 1024, maxSteps: 28, nSamples: 1 } as const;

/**
 * 公式UIの UC プリセット「heavy」の文面。ネガティブの既定値として使い、設定で編集できる。
 * NSFW を生成するときは先頭の `nsfw, ` を消して使う。
 */
export const DEFAULT_NEGATIVE =
  'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, ' +
  'very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, ' +
  'too many watermarks, negative space, blank page';

/** 公式UIがキャラクターごとに付けているネガティブ。 */
export const DEFAULT_CHARACTER_NEGATIVE = 'lowres, aliasing, ';

export interface GenerationParams {
  width: number;
  height: number;
  steps: number;
  scale: number;
  sampler: string;
  noiseSchedule: string;
  seed: number;
}

export const DEFAULT_PARAMS: Omit<GenerationParams, 'seed'> = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
};

export function isFreeGeneration(p: Pick<GenerationParams, 'width' | 'height' | 'steps'>): boolean {
  return p.width * p.height <= FREE_LIMITS.maxPixels && p.steps <= FREE_LIMITS.maxSteps;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4_294_967_295);
}

export interface CharacterInput {
  prompt: string;
  negative: string;
}

export interface GenerateInput {
  prompt: string;
  negative: string;
  characters: readonly CharacterInput[];
  params: GenerationParams;
}

type Point = { x: number; y: number };

interface V4Caption {
  base_caption: string;
  char_captions: Array<{ char_caption: string; centers: Point[] }>;
}

export interface GenerateRequest {
  input: string;
  model: string;
  action: 'generate';
  use_new_shared_trial: boolean;
  parameters: Record<string, unknown> & {
    characterPrompts: Array<{ prompt: string; uc: string; center: Point; enabled: boolean }>;
    v4_prompt: { caption: V4Caption; use_coords: boolean; use_order: boolean };
    v4_negative_prompt: { caption: V4Caption; legacy_uc: boolean };
  };
}

// 座標指定はしない（use_coords: false）。そのとき公式UIは中心を (0, 0) で送っている。
const NO_POSITION: Point = { x: 0, y: 0 };

/**
 * 公式UIは品質タグと UC プリセットの文面をクライアント側で展開してから送るので、
 * こちらも展開済みの文字列を渡す（品質タグはタグ編集画面で、ネガティブは設定で持つ）。
 * v4_prompt / v4_negative_prompt を省くと 500 になるため、常に両方入れる。
 */
export function buildGenerateRequest({ prompt, negative, characters, params }: GenerateInput): GenerateRequest {
  const caption = (base: string, chars: readonly string[]): V4Caption => ({
    base_caption: base,
    char_captions: chars.map((c) => ({ char_caption: c, centers: [NO_POSITION] })),
  });

  return {
    input: prompt,
    model: NAI_MODEL,
    action: 'generate',
    use_new_shared_trial: true,
    parameters: {
      params_version: 4,
      width: params.width,
      height: params.height,
      scale: params.scale,
      sampler: params.sampler,
      steps: params.steps,
      n_samples: FREE_LIMITS.nSamples,
      seed: params.seed,
      noise_schedule: params.noiseSchedule,
      autoSmea: false,
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: true,
      cfg_rescale: 0,
      legacy_v3_extend: false,
      use_coords: false,
      legacy_uc: false,
      normalize_reference_strength_multiple: true,
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true,
      straight_alpha: true,
      // PNG なら生成情報が画像に埋め込まれ、公式UIに読み込ませて設定を再現できる
      image_format: 'png',
      characterPrompts: characters.map((c) => ({
        prompt: c.prompt,
        uc: c.negative,
        center: NO_POSITION,
        enabled: true,
      })),
      v4_prompt: {
        caption: caption(prompt, characters.map((c) => c.prompt)),
        use_coords: false,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: caption(negative, characters.map((c) => c.negative)),
        legacy_uc: false,
      },
      negative_prompt: negative,
    },
  };
}
