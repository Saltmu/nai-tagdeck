import { unzipSync } from 'fflate';
import { prefixFurryDataset } from './prompt';
import { validateToken } from './token';

/**
 * NovelAI Diffusion V5 の生成リクエスト。公式 Web UI が送っている内容（2026-10-05 に取得）に合わせている。
 * 値の根拠と未確認の点は docs/novelai-api.md を参照。
 */

export const GENERATE_URL = 'https://image.novelai.net/ai/generate-image';
export const NAI_MODEL = 'nai-diffusion-5-full';
export const REQUEST_TIMEOUT_MS = 120_000;

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
  /** 0〜1。0 はリスケールなし。 */
  cfgRescale: number;
  dynamicThresholding: boolean;
}

export const DEFAULT_PARAMS: Omit<GenerationParams, 'seed'> = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  cfgRescale: 0,
  dynamicThresholding: false,
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
  /** 未指定のキャラは、誰かが座標を持つときだけ中央 (0.5, 0.5) にする。 */
  center?: { x: number; y: number };
}

export type GenerationMode = 'anime' | 'furry';

export interface GenerateInput {
  prompt: string;
  negative: string;
  characters: readonly CharacterInput[];
  params: GenerationParams;
  mode?: GenerationMode;
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

// 誰も位置を持たないときは use_coords: false。そのとき公式UIは中心を (0, 0) で送っている。
// 誰かが位置を持つときは use_coords: true。指定のないキャラは中央 (0.5, 0.5)。
const NO_POSITION: Point = { x: 0, y: 0 };

/**
 * 公式UIは品質タグと UC プリセットの文面をクライアント側で展開してから送るので、
 * こちらも展開済みの文字列を渡す（品質タグはタグ編集画面で、ネガティブは設定で持つ）。
 * v4_prompt / v4_negative_prompt を省くと 500 になるため、常に両方入れる。
 */
export function buildGenerateRequest({ prompt, negative, characters, params, mode = 'anime' }: GenerateInput): GenerateRequest {
  // V5 のモード切替は専用 API パラメータではなく、ベースプロンプト先頭のタグで指定する。
  const basePrompt = mode === 'furry' ? prefixFurryDataset(prompt) : prompt;
  const useCoords = characters.some((c) => c.center !== undefined);
  const pointOf = (c: CharacterInput): Point => c.center ?? (useCoords ? { x: 0.5, y: 0.5 } : NO_POSITION);
  const caption = (base: string, chars: readonly CharacterInput[], text: (c: CharacterInput) => string): V4Caption => ({
    base_caption: base,
    char_captions: chars.map((c) => ({ char_caption: text(c), centers: [pointOf(c)] })),
  });

  return {
    input: basePrompt,
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
      dynamic_thresholding: params.dynamicThresholding,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: true,
      cfg_rescale: params.cfgRescale,
      legacy_v3_extend: false,
      use_coords: useCoords,
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
        center: pointOf(c),
        enabled: true,
      })),
      v4_prompt: {
        caption: caption(basePrompt, characters, (c) => c.prompt),
        use_coords: useCoords,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: caption(negative, characters, (c) => c.negative),
        legacy_uc: false,
      },
      negative_prompt: negative,
    },
  };
}

// ---- 送信と応答の解釈 ----

export interface NovelAIErrorOptions {
  retryAfterSeconds?: number;
  correlationId?: string;
}

export class NovelAIError extends Error {
  readonly retryAfterSeconds?: number;
  readonly correlationId?: string;

  constructor(
    readonly status: number,
    message: string,
    options?: NovelAIErrorOptions,
  ) {
    super(message);
    this.name = 'NovelAIError';
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.correlationId = options?.correlationId;
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
  let bin: string;
  try {
    bin = atob(b64.replace(/^data:[^,]*,/, ''));
  } catch {
    throw new NovelAIError(0, '応答の画像データを読み取れませんでした');
  }
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
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch {
      throw new NovelAIError(0, '応答の ZIP データを展開できませんでした');
    }
    images = Object.keys(files)
      .sort()
      .map((name) => toImage(files[name]!));
  } else if (sniffImageType(bytes)) {
    images = [toImage(bytes)];
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new NovelAIError(0, '応答を読み取れませんでした');
    }
    const rawImages =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { images?: unknown }).images)
        ? (parsed as { images: unknown[] }).images
        : [];
    images = rawImages.map((img) => {
      if (!img || typeof img !== 'object') return null;
      const { image, seed } = img as { image?: unknown; seed?: unknown };
      return typeof image === 'string'
        ? toImage(base64ToBytes(image), typeof seed === 'number' ? seed : undefined)
        : null;
    });
  }

  const found = images.filter((i): i is ImageResult => i !== null);
  if (found.length === 0) throw new NovelAIError(0, '応答に画像が含まれていませんでした');
  return found;
}

const CORRELATION_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** NovelAI の 500 問い合わせ用 `x-correlation-id`（英数字6文字）。 */
export function createCorrelationId(): string {
  const length = 6;
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CORRELATION_ALPHABET[bytes[i]! % CORRELATION_ALPHABET.length];
  }
  return out;
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.ceil((timestamp - now) / 1000));
}

function extractErrorField(data: Record<string, unknown>): string | null {
  for (const key of ['message', 'error', 'detail'] as const) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const nestedError = data.error;
  if (nestedError && typeof nestedError === 'object') {
    const message = (nestedError as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  if (Array.isArray(data.detail)) {
    const messages = data.detail
      .map((item) => (item && typeof item === 'object' ? (item as { msg?: unknown }).msg : null))
      .filter((msg): msg is string => typeof msg === 'string' && msg.trim().length > 0)
      .map((msg) => msg.trim());
    if (messages.length > 0) return messages.join(', ');
  }
  return null;
}

async function readErrorMessage(res: Response, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw signal.reason ?? createTimeoutError();
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    if (isTimeoutError(err)) throw err;
    return '';
  }
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const extracted = extractErrorField(data as Record<string, unknown>);
      if (extracted) return extracted;
    }
  } catch {
    // JSON でなければ本文を使う
  }
  const trimmed = text.trim();
  const contentType = res.headers?.get('content-type') ?? '';
  if (contentType.includes('text/html') || trimmed.startsWith('<')) return '';
  return trimmed.slice(0, 300);
}

function createTimeoutError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'TimeoutError'
  );
}

function createRequestSignal(
  userSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (!(timeoutMs > 0)) return { signal: userSignal, cleanup: () => {} };

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!userSignal) return { signal: timeoutSignal, cleanup: () => {} };
    if (typeof AbortSignal.any === 'function') {
      return { signal: AbortSignal.any([userSignal, timeoutSignal]), cleanup: () => {} };
    }
  }

  const controller = new AbortController();
  const onUserAbort = () => controller.abort(userSignal?.reason);
  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
      return { signal: controller.signal, cleanup: () => {} };
    }
    userSignal.addEventListener('abort', onUserAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(createTimeoutError()), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      userSignal?.removeEventListener('abort', onUserAbort);
    },
  };
}

/**
 * 公式 Web UI と同じく multipart/form-data の `request` パートに JSON を入れて送る。
 * トークンは Authorization ヘッダーにだけ載せ、URL には入れない。
 */
export async function requestImages(
  token: string,
  body: GenerateRequest,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<ImageResult[]> {
  const tokenError = validateToken(token);
  if (tokenError) throw new NovelAIError(0, `トークンの形式が正しくありません（${tokenError}）`);

  const correlationId = createCorrelationId();
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify(body)], { type: 'application/json' }), 'blob');

  const { signal: requestSignal, cleanup } = createRequestSignal(signal, timeoutMs);
  try {
    const res = await fetch(GENERATE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-correlation-id': correlationId,
      },
      body: form,
      signal: requestSignal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) {
      const message = await readErrorMessage(res, requestSignal);
      if (requestSignal?.aborted) throw requestSignal.reason ?? createTimeoutError();
      throw new NovelAIError(res.status, message, {
        retryAfterSeconds: parseRetryAfter(res.headers?.get('retry-after') ?? null),
        correlationId,
      });
    }
    const buffer = await res.arrayBuffer();
    if (requestSignal?.aborted) throw requestSignal.reason ?? createTimeoutError();
    return extractImages(buffer);
  } catch (err) {
    if (requestSignal?.aborted && !signal?.aborted && isTimeoutError(requestSignal.reason)) {
      throw requestSignal.reason;
    }
    throw err;
  } finally {
    cleanup();
  }
}

/** 画面に出すエラー文。 */
export function describeError(error: unknown): string {
  if (isTimeoutError(error)) {
    return '生成がタイムアウトしました。時間をおいてもう一度お試しください';
  }
  if (error instanceof NovelAIError) {
    const detail = error.message ? `（${error.message}）` : '';
    const corr = error.correlationId ? ` [ID: ${error.correlationId}]` : '';
    switch (error.status) {
      case 0:
        return error.message;
      case 400:
        return `リクエストの内容が受け付けられませんでした${detail}`;
      case 401:
        return 'トークンが無効です。設定でトークンを確認してください';
      case 402:
        return `Anlas が足りないか、プランの範囲外です${detail}`;
      case 403:
        return `アクセスが拒否されました。アカウントやプランの状態、トークンの権限を確認してください${detail}`;
      case 429:
        return error.retryAfterSeconds && error.retryAfterSeconds > 0
          ? `リクエストが多すぎるか、同時に生成できる数の上限です。${error.retryAfterSeconds}秒ほど待ってから、もう一度お試しください`
          : '同時に生成できる数の上限です。前の生成が終わってから、もう一度押してください';
      case 502:
      case 503:
      case 504:
        return `NovelAI のサーバーが一時的に応答できません（${error.status}）。時間をおいてもう一度お試しください${detail}${corr}`;
      default:
        return error.status >= 500
          ? `NovelAI 側でエラーが起きました（${error.status}）${detail}${corr}`
          : `生成できませんでした（${error.status}）${detail}`;
    }
  }
  if (error instanceof TypeError) return 'NovelAI に接続できませんでした。通信状態を確認してください';
  if (error instanceof SyntaxError) return '応答を読み取れませんでした';
  return `生成できませんでした: ${String(error)}`;
}
