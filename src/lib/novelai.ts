import { unzipSync } from 'fflate';

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

// ---- 送信と応答の解釈 ----

export class NovelAIError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'NovelAIError';
  }
}

export interface ImageResult {
  blob: Blob;
  /** JSON 応答にシードが含まれていればその値。 */
  seed?: number;
}

/** 先頭のバイト列から画像の種類を判定する。 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8) return 'image/jpeg';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]*,/, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toImage(bytes: Uint8Array, seed?: number): ImageResult | null {
  const type = sniffImageType(bytes);
  return type ? { blob: new Blob([bytes as BlobPart], { type }), seed } : null;
}

/** 応答は ZIP・JSON（base64）・画像そのもののどれでも受け付ける。 */
export function extractImages(buffer: ArrayBuffer): ImageResult[] {
  const bytes = new Uint8Array(buffer);
  let images: Array<ImageResult | null>;

  if (isZip(bytes)) {
    const files = unzipSync(bytes);
    images = Object.keys(files)
      .sort()
      .map((name) => toImage(files[name]!));
  } else if (sniffImageType(bytes)) {
    images = [toImage(bytes)];
  } else {
    const data = JSON.parse(new TextDecoder().decode(bytes)) as {
      images?: Array<{ image?: string; seed?: number }>;
    };
    images = (data.images ?? []).map((img) =>
      typeof img.image === 'string' ? toImage(base64ToBytes(img.image), img.seed) : null,
    );
  }

  const found = images.filter((i): i is ImageResult => i !== null);
  if (found.length === 0) throw new NovelAIError(0, '応答に画像が含まれていませんでした');
  return found;
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const data = JSON.parse(text) as { message?: unknown };
    if (typeof data.message === 'string' && data.message) return data.message;
  } catch {
    // JSON でなければ本文をそのまま使う
  }
  return text.slice(0, 300);
}

/**
 * 公式 Web UI と同じく multipart/form-data の `request` パートに JSON を入れて送る。
 * トークンは Authorization ヘッダーにだけ載せ、URL には入れない。
 */
export async function requestImages(
  token: string,
  body: GenerateRequest,
  signal?: AbortSignal,
): Promise<ImageResult[]> {
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify(body)], { type: 'application/json' }), 'blob');

  const res = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new NovelAIError(res.status, await readErrorMessage(res));
  return extractImages(await res.arrayBuffer());
}

/** 画面に出すエラー文。 */
export function describeError(error: unknown): string {
  if (error instanceof NovelAIError) {
    const detail = error.message ? `（${error.message}）` : '';
    switch (error.status) {
      case 0:
        return error.message;
      case 400:
        return `リクエストの内容が受け付けられませんでした${detail}`;
      case 401:
        return 'トークンが無効です。設定でトークンを確認してください';
      case 402:
        return `Anlas が足りないか、プランの範囲外です${detail}`;
      case 429:
        return '同時に生成できる数の上限です。前の生成が終わってから、もう一度押してください';
      default:
        return error.status >= 500
          ? `NovelAI 側でエラーが起きました（${error.status}）${detail}`
          : `生成できませんでした（${error.status}）${detail}`;
    }
  }
  if (error instanceof TypeError) return 'NovelAI に接続できませんでした。通信状態を確認してください';
  if (error instanceof SyntaxError) return '応答を読み取れませんでした';
  return `生成できませんでした: ${String(error)}`;
}
