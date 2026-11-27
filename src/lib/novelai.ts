import { unzipSync } from 'fflate';
import { prefixFurryDataset } from './prompt';
import { validateToken } from './token';

/**
 * NovelAI Diffusion V5 の生成リクエスト。公式 Web UI が送っている内容（2026-10-05 に取得）に合わせている。
 * 値の根拠と未確認の点は docs/novelai-api.md を参照。
 */

export const GENERATE_URL = 'https://image.novelai.net/ai/generate-image';
export const NAI_MODEL = 'nai-diffusion-5-full';
export const NAI_INPAINT_MODEL = 'nai-diffusion-5-full-inpainting';
export const REQUEST_TIMEOUT_MS = 120_000;

/** Anlas 残高の取得先。旧ホスト `api.novelai.net` は 400 になるため使わない。 */
export const SUBSCRIPTION_URL = 'https://image.novelai.net/user/subscription';
/** 残高取得のタイムアウト（生成の 120 秒より短くする）。 */
export const SUBSCRIPTION_TIMEOUT_MS = 30_000;

/** Opus プランで Anlas を消費しない条件（最新の条件は公式で確認すること）。 */
export const FREE_LIMITS = {
  maxPixels: 1024 * 1024,
  maxSteps: 28,
  nSamples: 1,
  /** サイズは 64 の倍数で指定する。 */
  sizeStep: 64,
  minSide: 64,
  maxSide: 2048,
} as const;

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

export function isFreeGeneration(p: Pick<GenerationParams, 'width' | 'height' | 'steps'>): boolean {
  return (
    isValidFreeSize(p.width, p.height) &&
    Number.isFinite(p.steps) &&
    Number.isInteger(p.steps) &&
    p.steps >= 1 &&
    p.steps <= FREE_LIMITS.maxSteps
  );
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

export type PreciseReferenceType = 'character' | 'style' | 'outfit';

export const PRECISE_REFERENCE_STRENGTH_MIN = 0.1;
export const PRECISE_REFERENCE_STRENGTH_MAX = 5;
export const PRECISE_REFERENCE_STRENGTH_STEP = 0.05;
export const DEFAULT_PRECISE_REFERENCE_STRENGTH = 1;

export const INPAINT_STRENGTH_MIN = 0.01;
export const INPAINT_STRENGTH_MAX = 1;
export const INPAINT_STRENGTH_STEP = 0.01;
/** #172 で実測した公式 Web UI のインペイント強度（`inpaintImg2ImgStrength`）既定値。 */
export const DEFAULT_INPAINT_STRENGTH = 1;

// #172 で実測した公式 Web UI のインペイント固定パラメータ
const INPAINT_BASE_STRENGTH = 0.7;
const INPAINT_NOISE = 0;

export interface PreciseReferenceInput {
  /** raw base64（data URL 接頭辞なし）。 */
  imageBase64: string;
  type: PreciseReferenceType;
  /** 0.1〜5.0。0 は不可とし、無効化は UI 側の enabled で行う。 */
  strength: number;
}

export interface InpaintInput {
  /** 64 の倍数・無料枠内へ正規化済みのベース画像（raw base64）。 */
  imageBase64: string;
  /** 2 値化済みのマスク画像（raw base64）。 */
  maskBase64: string;
  /** 正規化後のベース画像寸法（generation.size より優先して parameters.width/height に使う）。 */
  width: number;
  height: number;
  /** 0.01〜1.0（#172 の実測に合わせ `inpaintImg2ImgStrength` に送る）。 */
  strength: number;
  addOriginalImage: boolean;
}

export interface GenerateInput {
  prompt: string;
  negative: string;
  characters: readonly CharacterInput[];
  params: GenerationParams;
  mode?: GenerationMode;
  references?: readonly PreciseReferenceInput[];
  inpaint?: InpaintInput;
}

type Point = { x: number; y: number };

interface V4Caption {
  base_caption: string;
  char_captions: Array<{ char_caption: string; centers: Point[] }>;
}

export interface GenerateRequest {
  input: string;
  model: string;
  action: 'generate' | 'infill';
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

function referenceBaseCaption(type: PreciseReferenceType): string {
  switch (type) {
    case 'character':
      return 'character';
    case 'style':
      return 'style';
    case 'outfit':
      return 'costume';
  }
}

function clampReferenceStrength(strength: number): number {
  if (!Number.isFinite(strength)) return DEFAULT_PRECISE_REFERENCE_STRENGTH;
  return Math.min(PRECISE_REFERENCE_STRENGTH_MAX, Math.max(PRECISE_REFERENCE_STRENGTH_MIN, strength));
}

function clampInpaintStrength(strength: number): number {
  if (!Number.isFinite(strength)) return DEFAULT_INPAINT_STRENGTH;
  const clamped = Math.min(INPAINT_STRENGTH_MAX, Math.max(INPAINT_STRENGTH_MIN, strength));
  return Math.round(clamped * 100) / 100;
}

/**
 * 公式UIは品質タグと UC プリセットの文面をクライアント側で展開してから送るので、
 * こちらも展開済みの文字列を渡す（品質タグはタグ編集画面で、ネガティブは設定で持つ）。
 * v4_prompt / v4_negative_prompt を省くと 500 になるため、常に両方入れる。
 */
export function buildGenerateRequest({
  prompt,
  negative,
  characters,
  params,
  mode = 'anime',
  references,
  inpaint,
}: GenerateInput): GenerateRequest {
  if (inpaint && references && references.length > 0) {
    throw new NovelAIError(0, 'インペイントと精密参照は同時に使用できません');
  }

  // V5 のモード切替は専用 API パラメータではなく、ベースプロンプト先頭のタグで指定する。
  const basePrompt = mode === 'furry' ? prefixFurryDataset(prompt) : prompt;
  const useCoords = characters.some((c) => c.center !== undefined);
  const pointOf = (c: CharacterInput): Point => c.center ?? (useCoords ? { x: 0.5, y: 0.5 } : NO_POSITION);
  const caption = (base: string, chars: readonly CharacterInput[], text: (c: CharacterInput) => string): V4Caption => ({
    base_caption: base,
    char_captions: chars.map((c) => ({ char_caption: text(c), centers: [pointOf(c)] })),
  });
  const referenceParams =
    !inpaint && references && references.length > 0
      ? {
          director_reference_images: references.map((r) => r.imageBase64.replace(/^data:[^,]*,/, '')),
          director_reference_descriptions: references.map((r) => ({
            caption: { base_caption: referenceBaseCaption(r.type), char_captions: [] },
            legacy_uc: false,
          })),
          director_reference_strength_values: references.map((r) => clampReferenceStrength(r.strength)),
          director_reference_secondary_strength_values: references.map(() => 0),
          director_reference_information_extracted: references.map(() => 1),
        }
      : {};

  let inpaintParams: Record<string, unknown> = {};
  if (inpaint) {
    if (!isValidFreeSize(inpaint.width, inpaint.height)) {
      throw new NovelAIError(0, 'インペイントの画像サイズが無料枠の条件を満たしていません');
    }
    const imageBase64 = inpaint.imageBase64.replace(/^data:[^,]*,/, '').trim();
    const maskBase64 = inpaint.maskBase64.replace(/^data:[^,]*,/, '').trim();
    if (!imageBase64 || !maskBase64) {
      throw new NovelAIError(0, 'インペイントの画像またはマスクが不正です');
    }
    inpaintParams = {
      strength: INPAINT_BASE_STRENGTH,
      noise: INPAINT_NOISE,
      inpaintImg2ImgStrength: clampInpaintStrength(inpaint.strength),
      extra_noise_seed: params.seed > 0 ? params.seed - 1 : 0,
      image: imageBase64,
      mask: maskBase64,
    };
  }

  return {
    input: basePrompt,
    model: inpaint ? NAI_INPAINT_MODEL : NAI_MODEL,
    action: inpaint ? 'infill' : 'generate',
    use_new_shared_trial: true,
    parameters: {
      params_version: 4,
      width: inpaint ? inpaint.width : params.width,
      height: inpaint ? inpaint.height : params.height,
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
      add_original_image: inpaint ? inpaint.addOriginalImage : true,
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
      ...referenceParams,
      ...inpaintParams,
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

function base64ToBytes(b64: string, errorMessage = '応答の画像データを読み取れませんでした'): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64.replace(/^data:[^,]*,/, ''));
  } catch {
    throw new NovelAIError(0, errorMessage);
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

const BASE64_PREVIEW_LENGTH = 64;
const MAX_ERROR_DETAIL_LENGTH = 300;
const DATA_URL_BASE64_RE = /data:[^;\s,"']+?;base64,[A-Za-z0-9+/=_-]+/gi;
const LONG_BASE64_RE = /(?<![A-Za-z0-9_-])[A-Za-z0-9+/]{65,}[A-Za-z0-9+/=]*/g;

/**
 * エラー文に含まれる長い base64 / data URL 文字列を先頭 64 文字で打ち切り、全体長も上限に収める。
 */
export function sanitizeErrorMessage(raw: string, maxLength = MAX_ERROR_DETAIL_LENGTH): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const truncateMatch = (match: string) =>
    match.length > BASE64_PREVIEW_LENGTH ? `${match.slice(0, BASE64_PREVIEW_LENGTH)}…` : match;
  const redacted = trimmed
    .replace(DATA_URL_BASE64_RE, truncateMatch)
    .replace(LONG_BASE64_RE, truncateMatch);
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

function extractArrayMessages(items: unknown[]): string[] {
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const record = item as { msg?: unknown; message?: unknown };
        const msg = typeof record.msg === 'string' ? record.msg : typeof record.message === 'string' ? record.message : '';
        return msg.trim();
      }
      return '';
    })
    .filter((msg) => msg.length > 0);
}

function extractErrorField(data: Record<string, unknown>): string | null {
  for (const key of ['message', 'error', 'detail'] as const) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return sanitizeErrorMessage(value);
    if (Array.isArray(value)) {
      const messages = extractArrayMessages(value);
      if (messages.length > 0) return sanitizeErrorMessage(messages.join(', '));
    }
  }
  const nestedError = data.error;
  if (nestedError && typeof nestedError === 'object') {
    const message = (nestedError as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return sanitizeErrorMessage(message);
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
  return sanitizeErrorMessage(trimmed);
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

function attachMultipartReferenceImages(form: FormData, body: GenerateRequest): GenerateRequest {
  const rawRefs = body.parameters?.director_reference_images;
  if (!Array.isArray(rawRefs) || rawRefs.length === 0) return body;

  const partNames: string[] = [];
  for (let i = 0; i < rawRefs.length; i++) {
    const value = rawRefs[i];
    if (typeof value !== 'string' || !value.trim()) {
      throw new NovelAIError(0, '参照画像の送信データが不正です');
    }
    const bytes = base64ToBytes(value, '参照画像の送信データを読み取れませんでした');
    const mime = sniffImageType(bytes) ?? 'image/png';
    const partName = `director_ref_${i}`;
    form.append(partName, new Blob([bytes as BlobPart], { type: mime }), 'blob');
    partNames.push(partName);
  }

  return {
    ...body,
    parameters: {
      ...body.parameters,
      director_reference_images: partNames,
    },
  };
}

function attachMultipartInpaintImages(form: FormData, body: GenerateRequest): GenerateRequest {
  if (body.action !== 'infill') return body;
  const rawRefs = body.parameters?.director_reference_images;
  if (Array.isArray(rawRefs) && rawRefs.length > 0) {
    throw new NovelAIError(0, 'インペイントと精密参照は同時に使用できません');
  }
  const rawImage = body.parameters?.image;
  const rawMask = body.parameters?.mask;
  if (typeof rawImage !== 'string' || !rawImage.trim() || typeof rawMask !== 'string' || !rawMask.trim()) {
    throw new NovelAIError(0, 'インペイントの送信データが不正です');
  }

  const imageBytes = base64ToBytes(rawImage, 'インペイントのベース画像を読み取れませんでした');
  const maskBytes = base64ToBytes(rawMask, 'インペイントのマスク画像を読み取れませんでした');
  const imageMime = sniffImageType(imageBytes) ?? 'image/png';
  const maskMime = sniffImageType(maskBytes) ?? 'image/png';

  form.append('image', new Blob([imageBytes as BlobPart], { type: imageMime }), 'blob');
  form.append('mask', new Blob([maskBytes as BlobPart], { type: maskMime }), 'blob');

  return {
    ...body,
    parameters: {
      ...body.parameters,
      image: 'image',
      mask: 'mask',
    },
  };
}

/**
 * 公式 Web UI と同じく multipart/form-data の `request` パートに JSON を入れて送る。
 * 精密参照は `director_ref_N`、インペイントは `image` / `mask` パートとして添付し、JSON 側にはパート名を入れる。
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
  const payload =
    body.action === 'infill'
      ? attachMultipartInpaintImages(form, body)
      : attachMultipartReferenceImages(form, body);
  form.append('request', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'blob');

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
    const cleanMessage = sanitizeErrorMessage(error.message);
    const detail = cleanMessage ? `（${cleanMessage}）` : '';
    const corr = error.correlationId ? ` [ID: ${error.correlationId}]` : '';
    switch (error.status) {
      case 0:
        return cleanMessage;
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
  return `生成できませんでした: ${sanitizeErrorMessage(String(error))}`;
}

// ---- Anlas 残高（GET /user/subscription） ----

/** プラン名。tier: 0=Paper、1=Tablet、2=Scroll、3=Opus。 */
export const TIER_NAMES: Record<number, string> = {
  0: 'Paper',
  1: 'Tablet',
  2: 'Scroll',
  3: 'Opus',
};

export function tierName(tier: number): string {
  return TIER_NAMES[tier] ?? `プラン ${tier}`;
}

/** Opus の V5 利用枠。Opus 以外では応答に含まれない。 */
export interface SubscriptionUsage {
  /** V5 利用枠の使用率（%）。 */
  percent: number;
  /** 利用枠を超過しているとき true。 */
  isNegative: boolean;
  /** 次に 1% 回復するまでの秒数。分からなければ null。 */
  timeUntilNextPercent: number | null;
}

export interface Subscription {
  tier: number;
  /** 付与分 Anlas の残り。 */
  fixedTrainingStepsLeft: number;
  /** 購入分 Anlas の残り。 */
  purchasedTrainingSteps: number;
  /** 合計残高（付与分＋購入分）。 */
  totalAnlas: number;
  /** 購読期間の終了時刻（ミリ秒）。分からなければ null。 */
  expiresAt: number | null;
  /** Opus の V5 利用枠。Opus 以外・不明のとき null。 */
  usage: SubscriptionUsage | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 秒かミリ秒か分からない UNIX 時刻をミリ秒にそろえる。 */
function normalizeTimestampMs(value: unknown): number | null {
  const num = finiteNumber(value);
  if (num === null || num <= 0) return null;
  return num > 1e12 ? num : num * 1000;
}

function parseUsage(value: unknown): SubscriptionUsage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const percent = finiteNumber(record.percent);
  if (percent === null) return null;
  return {
    percent,
    isNegative: record.isNegative === true,
    timeUntilNextPercent: finiteNumber(record.timeUntilNextPercent),
  };
}

/**
 * `GET /user/subscription` の応答を解釈する。公式 OpenAPI（`user.SubscriptionResponse`）
 * では残高は `trainingStepsLeft` オブジェクトの中（`fixedTrainingStepsLeft`／
 * `purchasedTrainingSteps`）にある。平坦な応答にも一応対応するが、公式はネスト。
 * 未対応のフィールドが増えても、残高の要所が読めれば表示する。残高がまったく
 * 読めないときだけ null。
 */
export function parseSubscription(data: unknown): Subscription | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const nested = record.trainingStepsLeft;
  const steps =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : null;
  const fixed = finiteNumber(steps?.fixedTrainingStepsLeft) ?? finiteNumber(record.fixedTrainingStepsLeft);
  const purchased = finiteNumber(steps?.purchasedTrainingSteps) ?? finiteNumber(record.purchasedTrainingSteps);
  if (fixed === null || purchased === null) return null;
  const tier = finiteNumber(record.tier);
  return {
    tier: tier ?? -1,
    fixedTrainingStepsLeft: fixed,
    purchasedTrainingSteps: purchased,
    totalAnlas: fixed + purchased,
    expiresAt: normalizeTimestampMs(record.expiresAt),
    usage: parseUsage(record.usage),
  };
}

/**
 * Anlas 残高とプランを取得する。残高は表示用にだけ使い、IndexedDB や
 * バックアップには保存しない。取得に失敗しても例外を投げるだけで、生成は止めない。
 */
export async function fetchSubscription(
  token: string,
  signal?: AbortSignal,
  timeoutMs = SUBSCRIPTION_TIMEOUT_MS,
): Promise<Subscription> {
  const tokenError = validateToken(token);
  if (tokenError) throw new NovelAIError(0, `トークンの形式が正しくありません（${tokenError}）`);

  const { signal: requestSignal, cleanup } = createRequestSignal(signal, timeoutMs);
  try {
    const res = await fetch(SUBSCRIPTION_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: requestSignal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) {
      const message = await readErrorMessage(res, requestSignal);
      if (requestSignal?.aborted) throw requestSignal.reason ?? createTimeoutError();
      throw new NovelAIError(res.status, message || '残高を取得できませんでした');
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new NovelAIError(0, '残高の応答を読み取れませんでした');
    }
    if (requestSignal?.aborted) throw requestSignal.reason ?? createTimeoutError();
    const parsed = parseSubscription(data);
    if (!parsed) throw new NovelAIError(0, '残高の応答を読み取れませんでした');
    return parsed;
  } catch (err) {
    if (requestSignal?.aborted && !signal?.aborted && isTimeoutError(requestSignal.reason)) {
      throw requestSignal.reason;
    }
    throw err;
  } finally {
    cleanup();
  }
}

/** 残高取得の失敗を、画面に出す短い文にする。 */
export function describeSubscriptionError(error: unknown): string {
  if (isTimeoutError(error)) return 'タイムアウトしました';
  if (error instanceof NovelAIError) {
    switch (error.status) {
      case 0:
        return error.message || '通信に失敗しました';
      case 401:
        return 'トークンが無効です';
      case 402:
        return 'プランの範囲外です';
      default:
        return `取得できませんでした（${error.status}）`;
    }
  }
  return '取得できませんでした';
}
