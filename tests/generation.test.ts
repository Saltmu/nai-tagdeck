import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  GENERATE_URL,
  NovelAIError,
  buildGenerateRequest,
  describeError,
  extractImages,
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
import { clearToken, loadToken, maskToken, normalizeToken, saveToken } from '../src/lib/token';

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
  });
});

describe('requestImages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('multipart の request パートに JSON を入れ、トークンはヘッダーにだけ載せる', async () => {
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
    expect(init.headers).toEqual({ Authorization: 'Bearer pst-secret' });
    expect(init.credentials).toBe('omit');
    const part = (init.body as FormData).get('request') as File;
    expect(part.type).toBe('application/json');
    expect(JSON.parse(await part.text())).toEqual(body);
  });

  it('エラー応答は状態コードとメッセージを持つ', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"statusCode":401,"message":"Invalid token"}', { status: 401 }));
    const err = await requestImages('x', {} as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NovelAIError);
    expect(err).toMatchObject({ status: 401, message: 'Invalid token' });
  });
});

describe('describeError', () => {
  it('状態コードごとの説明', () => {
    expect(describeError(new NovelAIError(401, ''))).toContain('トークン');
    expect(describeError(new NovelAIError(429, ''))).toContain('上限');
    expect(describeError(new NovelAIError(402, 'x'))).toContain('Anlas');
    expect(describeError(new NovelAIError(503, 'down'))).toBe('NovelAI 側でエラーが起きました（503）（down）');
    expect(describeError(new TypeError('Failed to fetch'))).toContain('接続');
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
  });

  it('送信用のパラメータにする', () => {
    expect(toParams({ ...DEFAULT_GENERATION, size: 'landscape' }, 7)).toMatchObject({
      width: 1216,
      height: 832,
      steps: 28,
      seed: 7,
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
});
