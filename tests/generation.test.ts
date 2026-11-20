import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  GENERATE_URL,
  NovelAIError,
  buildGenerateRequest,
  describeError,
  extractImages,
  parseRetryAfter,
  requestImages,
  sniffImageType,
} from '../src/lib/novelai';
import {
  DEFAULT_GENERATION,
  SIZE_PRESETS,
  normalizeGeneration,
  toParams,
} from '../src/lib/generation';
import { isFreeGeneration } from '../src/lib/novelai';
import {
  clearToken,
  isValidToken,
  loadToken,
  maskToken,
  normalizeToken,
  saveToken,
  validateToken,
} from '../src/lib/token';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))));
const buf = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe('sniffImageType', () => {
  it('PNG / WebP / JPEG を見分ける', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('extractImages', () => {
  it('ZIP の中の画像を名前順に取り出す', async () => {
    const zip = zipSync({ 'image_1.png': PNG, 'image_0.png': PNG, 'readme.txt': new Uint8Array([65]) });
    const images = extractImages(buf(zip));
    expect(images).toHaveLength(2);
    expect(images[0]!.blob.type).toBe('image/png');
    expect(new Uint8Array(await images[0]!.blob.arrayBuffer())).toEqual(PNG);
  });

  it('JSON（base64）の応答とシードを読む', () => {
    const json = JSON.stringify({ images: [{ image: toBase64(WEBP), index: 0, seed: 99 }] });
    const images = extractImages(buf(new TextEncoder().encode(json)));
    expect(images.map((i) => [i.blob.type, i.seed])).toEqual([['image/webp', 99]]);
  });

  it('画像そのものの応答も受け付ける', () => {
    expect(extractImages(buf(PNG))[0]!.blob.type).toBe('image/png');
  });

  it('画像がなければエラー', () => {
    expect(() => extractImages(buf(new TextEncoder().encode('{"images":[]}')))).toThrow(NovelAIError);
    expect(() => extractImages(buf(new TextEncoder().encode('null')))).toThrow(NovelAIError);
  });

  it('破損 ZIP・不正な base64・壊れた JSON を分かりやすい NovelAIError にする', () => {
    const brokenZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff]);
    expect(() => extractImages(buf(brokenZip))).toThrowError(
      new NovelAIError(0, '応答の ZIP データを展開できませんでした'),
    );

    const badBase64 = JSON.stringify({ images: [{ image: '%%%not-base64%%%' }] });
    expect(() => extractImages(buf(new TextEncoder().encode(badBase64)))).toThrowError(
      new NovelAIError(0, '応答の画像データを読み取れませんでした'),
    );

    expect(() => extractImages(buf(new TextEncoder().encode('not-json')))).toThrowError(
      new NovelAIError(0, '応答を読み取れませんでした'),
    );
  });
});

describe('requestImages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('multipart の request パートに JSON を入れ、トークンと x-correlation-id をヘッダーに載せる', async () => {
    const fetchMock = vi.fn(async () => new Response(PNG, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = buildGenerateRequest({
      prompt: 'a',
      negative: '',
      characters: [],
      params: { ...toParams(DEFAULT_GENERATION, 1) },
    });

    const images = await requestImages('pst-secret', body);
    expect(images).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GENERATE_URL);
    expect(url).not.toContain('pst-secret');
    expect(init.headers).toEqual({
      Authorization: 'Bearer pst-secret',
      'x-correlation-id': expect.stringMatching(/^[A-Za-z0-9]{6}$/),
    });
    expect(init.credentials).toBe('omit');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const part = (init.body as FormData).get('request') as File;
    expect(part.type).toBe('application/json');
    expect(JSON.parse(await part.text())).toEqual(body);
  });

  it('改行や非 ASCII を含むトークンは fetch 前に拒否し、通信エラーに誤分類しない', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const err = await requestImages('pst-abc\nxyz', {} as never).catch((e: unknown) => e);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(NovelAIError);
    expect(describeError(err)).toContain('トークンの形式');
    expect(describeError(err)).not.toContain('接続');
  });

  it('エラー応答は message / error / detail を抽出し、HTML 本文は省く', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"statusCode":401,"message":"Invalid token"}', { status: 401 }));
    const err1 = await requestImages('x', {} as never).catch((e: unknown) => e);
    expect(err1).toBeInstanceOf(NovelAIError);
    expect(err1).toMatchObject({ status: 401, message: 'Invalid token' });

    vi.stubGlobal('fetch', async () => new Response('{"error":"Forbidden plan"}', { status: 403 }));
    const err2 = await requestImages('x', {} as never).catch((e: unknown) => e);
    expect(err2).toMatchObject({ status: 403, message: 'Forbidden plan' });

    vi.stubGlobal('fetch', async () => new Response('{"detail":"Bad parameter"}', { status: 400 }));
    const err3 = await requestImages('x', {} as never).catch((e: unknown) => e);
    expect(err3).toMatchObject({ status: 400, message: 'Bad parameter' });

    vi.stubGlobal(
      'fetch',
      async () => new Response('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const err4 = await requestImages('x', {} as never).catch((e: unknown) => e);
    expect(err4).toMatchObject({ status: 502, message: '' });
    expect((err4 as NovelAIError).correlationId).toMatch(/^[A-Za-z0-9]{6}$/);
  });

  it('429 の Retry-After を解釈して NovelAIError に載せる', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('{"error":"Too Many Requests"}', { status: 429, headers: { 'Retry-After': '15' } }),
    );
    const err = await requestImages('x', {} as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NovelAIError);
    expect(err).toMatchObject({ status: 429, retryAfterSeconds: 15 });
    expect(describeError(err)).toContain('15秒');
  });

  it('タイムアウト時は TimeoutError で中断し、手動キャンセルと区別できる', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    const userCtrl = new AbortController();
    const timeoutErr = await requestImages('pst-ok', {} as never, userCtrl.signal, 20).catch((e: unknown) => e);
    expect(userCtrl.signal.aborted).toBe(false);
    expect(describeError(timeoutErr)).toContain('タイムアウト');

    const cancelCtrl = new AbortController();
    const cancelPromise = requestImages('pst-ok', {} as never, cancelCtrl.signal, 5000).catch((e: unknown) => e);
    cancelCtrl.abort();
    const cancelErr = await cancelPromise;
    expect(cancelCtrl.signal.aborted).toBe(true);
    expect((cancelErr as { name?: string })?.name).not.toBe('TimeoutError');
  });

  it('エラー応答の本文受信中にタイムアウトした場合は HTTP エラーではなくタイムアウトとして扱う', async () => {
    let onReadingBody: (() => void) | undefined;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => ({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: () =>
        new Promise<string>((_resolve, reject) => {
          onReadingBody?.();
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
    }));

    const userCtrl = new AbortController();
    const timeoutErr = await requestImages('pst-ok', {} as never, userCtrl.signal, 20).catch((e: unknown) => e);
    expect(userCtrl.signal.aborted).toBe(false);
    expect(timeoutErr).not.toBeInstanceOf(NovelAIError);
    expect(describeError(timeoutErr)).toContain('タイムアウト');

    const cancelCtrl = new AbortController();
    const readingStarted = new Promise<void>((resolve) => {
      onReadingBody = resolve;
    });
    const cancelPromise = requestImages('pst-ok', {} as never, cancelCtrl.signal, 5000).catch((e: unknown) => e);
    await readingStarted;
    cancelCtrl.abort();
    const cancelErr = await cancelPromise;
    expect(cancelCtrl.signal.aborted).toBe(true);
    expect(cancelErr).not.toBeInstanceOf(NovelAIError);
    expect((cancelErr as { name?: string })?.name).not.toBe('TimeoutError');
  });
});

describe('parseRetryAfter', () => {
  it('秒数と HTTP-date を解釈する', () => {
    expect(parseRetryAfter('42')).toBe(42);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:30 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))).toBe(30);
    expect(parseRetryAfter('invalid')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('describeError', () => {
  it('状態コードごとの説明', () => {
    expect(describeError(new NovelAIError(401, ''))).toContain('トークン');
    expect(describeError(new NovelAIError(402, 'x'))).toContain('Anlas');
    expect(describeError(new NovelAIError(403, 'denied'))).toContain('アクセスが拒否されました');
    expect(describeError(new NovelAIError(429, ''))).toContain('上限');
    expect(describeError(new NovelAIError(429, '', { retryAfterSeconds: 20 }))).toContain('20秒');
    expect(describeError(new NovelAIError(502, ''))).toContain('一時的に応答できません（502）');
    expect(describeError(new NovelAIError(503, 'down', { correlationId: 'Ab12Cd' }))).toBe(
      'NovelAI のサーバーが一時的に応答できません（503）。時間をおいてもう一度お試しください（down） [ID: Ab12Cd]',
    );
    expect(describeError(new NovelAIError(504, ''))).toContain('一時的に応答できません（504）');
    expect(describeError(new NovelAIError(500, 'oops', { correlationId: 'Xy98Za' }))).toBe(
      'NovelAI 側でエラーが起きました（500）（oops） [ID: Xy98Za]',
    );
    expect(describeError(new TypeError('Failed to fetch'))).toContain('接続');
    expect(describeError(new DOMException('timeout', 'TimeoutError'))).toContain('タイムアウト');
  });
});

describe('generation settings', () => {
  it('モードを保存値から復元し、旧データ・不正なモードはアニメにする', () => {
    expect(normalizeGeneration({ mode: 'furry' }).mode).toBe('furry');
    expect(normalizeGeneration({ mode: 'anime' }).mode).toBe('anime');
    expect(normalizeGeneration({}).mode).toBe('anime');
    expect(normalizeGeneration({ mode: 'invalid' }).mode).toBe('anime');
    const furry = normalizeGeneration({ ...DEFAULT_GENERATION, mode: 'furry' });
    expect(normalizeGeneration(JSON.parse(JSON.stringify(furry)))).toEqual(furry);
  });

  it('用意したサイズはすべて Anlas を消費しない', () => {
    for (const s of SIZE_PRESETS) {
      expect(isFreeGeneration({ width: s.width, height: s.height, steps: 28 })).toBe(true);
      expect(s.width % 64).toBe(0);
      expect(s.height % 64).toBe(0);
    }
  });

  it('範囲外や不明な値を補正する', () => {
    expect(normalizeGeneration({ size: 'huge', steps: 50, scale: 99, sampler: 'x', seed: -5 })).toEqual({
      ...DEFAULT_GENERATION,
      steps: 28,
      scale: 10,
      seed: 0,
    });
    expect(normalizeGeneration(null)).toEqual(DEFAULT_GENERATION);
    expect(normalizeGeneration({ steps: 0.4, scale: 5.55, seed: 12.9 })).toMatchObject({ steps: 1, scale: 5.6, seed: 12 });
    expect(normalizeGeneration({}).cfgRescale).toBe(0);
    expect(normalizeGeneration({}).dynamicThresholding).toBe(false);
    expect(normalizeGeneration({ cfgRescale: 1.234, dynamicThresholding: true })).toMatchObject({
      cfgRescale: 1,
      dynamicThresholding: true,
    });
    expect(normalizeGeneration({ cfgRescale: 'high', dynamicThresholding: 'yes' })).toMatchObject({
      cfgRescale: 0,
      dynamicThresholding: false,
    });
  });

  it('送信用のパラメータにする', () => {
    expect(toParams({ ...DEFAULT_GENERATION, size: 'landscape' }, 7)).toMatchObject({
      width: 1216,
      height: 832,
      steps: 28,
      seed: 7,
      cfgRescale: 0,
      dynamicThresholding: false,
    });
    expect(toParams({ ...DEFAULT_GENERATION, cfgRescale: 0.2, dynamicThresholding: true }, 7)).toMatchObject({
      cfgRescale: 0.2,
      dynamicThresholding: true,
    });
  });
});

describe('token', () => {
  class MemoryStorage {
    private map = new Map<string, string>();
    getItem(k: string) {
      return this.map.get(k) ?? null;
    }
    setItem(k: string, v: string) {
      this.map.set(k, v);
    }
    removeItem(k: string) {
      this.map.delete(k);
    }
  }
  afterEach(() => vi.unstubAllGlobals());

  it('選んだ保存先だけに残す', () => {
    vi.stubGlobal('window', { sessionStorage: new MemoryStorage(), localStorage: new MemoryStorage() });
    expect(loadToken()).toEqual({ token: null, storage: 'session' });
    expect(saveToken('pst-a', 'local')).toBe(true);
    expect(loadToken()).toEqual({ token: 'pst-a', storage: 'local' });
    saveToken('pst-b', 'session');
    expect(loadToken()).toEqual({ token: 'pst-b', storage: 'session' });
    expect(window.localStorage.getItem('nai-tagdeck.token')).toBeNull();
    clearToken();
    expect(loadToken().token).toBeNull();
  });

  it('ストレージが使えなくても落ちない', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
      get localStorage(): Storage {
        throw new Error('blocked');
      },
    });
    expect(saveToken('x', 'session')).toBe(false);
    expect(loadToken().token).toBeNull();
  });

  it('貼り付けた値を整え、表示用に伏せる', () => {
    expect(normalizeToken('  Bearer pst-abc  ')).toBe('pst-abc');
    expect(maskToken('pst-1234567890abcd')).toBe('pst-…abcd');
    expect(maskToken('short')).toBe('••••');
  });

  it('トークンの印字可能 ASCII 文字を検証する', () => {
    expect(validateToken('pst-abc_123.XYZ')).toBeNull();
    expect(isValidToken('pst-abc_123.XYZ')).toBe(true);
    expect(validateToken('')).toContain('入力');
    expect(validateToken('pst-abc\ndef')).toContain('改行');
    expect(validateToken('pst-abc def')).toContain('半角英数字・記号以外');
    expect(validateToken('pst-全角')).toContain('半角英数字・記号以外');
    expect(isValidToken('pst-全角')).toBe(false);
  });
});
