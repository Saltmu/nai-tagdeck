/**
 * NovelAI Diffusion V5 の生成リクエスト。V5 は V4 と同じ形式（v4_prompt）を使う。
 * 値の根拠と未確認の点は docs/novelai-api.md を参照。
 */

export const GENERATE_URL = 'https://image.novelai.net/ai/generate-image';
export const NAI_MODEL = 'nai-diffusion-5-full';

/** Opus プランで Anlas を消費しない条件（最新の条件は公式で確認すること）。 */
export const FREE_LIMITS = { maxPixels: 1024 * 1024, maxSteps: 28, nSamples: 1 } as const;

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

interface V4Caption {
  base_caption: string;
  char_captions: Array<{ char_caption: string; centers: Array<{ x: number; y: number }> }>;
}

export interface GenerateRequest {
  input: string;
  model: string;
  action: 'generate';
  parameters: Record<string, unknown> & {
    v4_prompt: { caption: V4Caption; use_coords: boolean; use_order: boolean };
    v4_negative_prompt: { caption: V4Caption; use_coords: boolean; use_order: boolean };
  };
}

const CENTER = { x: 0.5, y: 0.5 };

/**
 * ネガティブプロンプトは使わない方針なので空で送る。
 * v4_prompt / v4_negative_prompt を省くと 500 になるため、常に両方入れる。
 */
export function buildGenerateRequest(
  prompt: string,
  characterPrompts: readonly string[],
  params: GenerationParams,
): GenerateRequest {
  const caption = (base: string, chars: readonly string[]): V4Caption => ({
    base_caption: base,
    char_captions: chars.map((c) => ({ char_caption: c, centers: [CENTER] })),
  });

  return {
    input: prompt,
    model: NAI_MODEL,
    action: 'generate',
    parameters: {
      params_version: 4,
      width: params.width,
      height: params.height,
      steps: params.steps,
      scale: params.scale,
      sampler: params.sampler,
      noise_schedule: params.noiseSchedule,
      seed: params.seed,
      extra_noise_seed: params.seed,
      n_samples: FREE_LIMITS.nSamples,
      cfg_rescale: 0,
      ucPreset: 3,
      qualityToggle: false,
      sm: false,
      sm_dyn: false,
      dynamic_thresholding: false,
      legacy: false,
      legacy_v3_extend: false,
      add_original_image: false,
      prompt,
      negative_prompt: '',
      // 座標指定はしない（AI に配置を任せる）
      v4_prompt: { caption: caption(prompt, characterPrompts), use_coords: false, use_order: true },
      v4_negative_prompt: {
        caption: caption('', characterPrompts.map(() => '')),
        use_coords: false,
        use_order: false,
      },
    },
  };
}
