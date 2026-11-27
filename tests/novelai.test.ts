import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PARAMS,
  NAI_INPAINT_MODEL,
  NAI_MODEL,
  NovelAIError,
  SUBSCRIPTION_URL,
  buildGenerateRequest,
  describeSubscriptionError,
  fetchSubscription,
  isFreeGeneration,
  parseSubscription,
  tierName,
} from '../src/lib/novelai';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/lib/settings';

const params = { ...DEFAULT_PARAMS, seed: 42 };
const build = (prompt: string, negative = '', characters: Array<{ prompt: string; negative: string }> = []) =>
  buildGenerateRequest({ prompt, negative, characters, params });

describe('buildGenerateRequest (V5)', () => {
  it('ケモノは両方のベースプロンプト先頭にfur datasetを付け、キャラとネガティブは保持する', () => {
    const characters = [{ prompt: 'wolf, red fur', negative: 'lowres' }];
    const body = buildGenerateRequest({ prompt: 'solo, forest', negative: 'bad quality', characters, params, mode: 'furry' });
    expect(body.model).toBe('nai-diffusion-5-full');
    expect(body.input).toBe('fur dataset, solo, forest');
    expect(body.parameters.v4_prompt.caption.base_caption).toBe(body.input);
    expect(body.parameters.v4_prompt.caption.char_captions[0]?.char_caption).toBe(characters[0]?.prompt);
    expect(body.parameters.negative_prompt).toBe('bad quality');
    expect(body.parameters.v4_negative_prompt.caption.char_captions[0]?.char_caption).toBe('lowres');
    expect(body).not.toHaveProperty('mode');
    expect(body.parameters).not.toHaveProperty('mode');
    expect(body.parameters).not.toHaveProperty('furry');
  });

  it('アニメでは入力を変更せず、ケモノでも先頭タグを重複させない', () => {
    for (const prompt of ['solo', 'fur dataset, solo', 'FUR_DATASET, wolf']) {
      expect(buildGenerateRequest({ prompt, negative: '', characters: [], params, mode: 'anime' }).input).toBe(prompt);
    }
    const prompt = 'fur dataset, wolf';
    expect(buildGenerateRequest({ prompt, negative: '', characters: [], params, mode: 'furry' }).input).toBe(prompt);
    expect(buildGenerateRequest({ prompt: '', negative: '', characters: [], params, mode: 'furry' }).input).toBe('fur dataset');
    expect(buildGenerateRequest({ prompt: '  solo  ', negative: '', characters: [], params, mode: 'furry' }).input).toBe('fur dataset, solo');
  });

  it('プロンプトを input と v4_prompt に入れる', () => {
    const body = build('1girl, solo');
    expect(body.model).toBe(NAI_MODEL);
    expect(body.model).toBe('nai-diffusion-5-full');
    expect(body.action).toBe('generate');
    expect(body.input).toBe('1girl, solo');
    expect(body.parameters.v4_prompt).toEqual({
      caption: { base_caption: '1girl, solo', char_captions: [] },
      use_coords: false,
      use_order: true,
    });
  });

  it('ネガティブを negative_prompt と v4_negative_prompt の両方に入れる（空でも省かない）', () => {
    const p = build('a', 'lowres, bad quality').parameters;
    expect(p.negative_prompt).toBe('lowres, bad quality');
    expect(p.v4_negative_prompt).toEqual({
      caption: { base_caption: 'lowres, bad quality', char_captions: [] },
      legacy_uc: false,
    });
    expect(build('a').parameters.v4_negative_prompt.caption.base_caption).toBe('');
  });

  it('キャラクターを characterPrompts と char_captions の両方に、公式UIと同じ形で入れる', () => {
    const p = build('2girls', '', [
      { prompt: 'girl, red hair', negative: 'lowres, ' },
      { prompt: 'girl, blue hair', negative: '' },
    ]).parameters;
    expect(p.characterPrompts).toEqual([
      { prompt: 'girl, red hair', uc: 'lowres, ', center: { x: 0, y: 0 }, enabled: true },
      { prompt: 'girl, blue hair', uc: '', center: { x: 0, y: 0 }, enabled: true },
    ]);
    expect(p.v4_prompt.caption.char_captions).toEqual([
      { char_caption: 'girl, red hair', centers: [{ x: 0, y: 0 }] },
      { char_caption: 'girl, blue hair', centers: [{ x: 0, y: 0 }] },
    ]);
    expect(p.v4_negative_prompt.caption.char_captions.map((c) => c.char_caption)).toEqual(['lowres, ', '']);
    expect(p.use_coords).toBe(false);
    expect(p.cfg_rescale).toBe(0);
    expect(p.dynamic_thresholding).toBe(false);
  });

  it('位置を指定したキャラがいるときだけ座標を有効にし、詳細設定を送る', () => {
    const p = buildGenerateRequest({
      prompt: '2girls',
      negative: '',
      characters: [
        { prompt: 'girl, red hair', negative: 'blurry', center: { x: 0.2, y: 0.8 } },
        { prompt: 'girl, blue hair', negative: '' },
      ],
      params: { ...params, cfgRescale: 0.3, dynamicThresholding: true },
    }).parameters;
    expect(p.use_coords).toBe(true);
    expect(p.v4_prompt.use_coords).toBe(true);
    expect(p.cfg_rescale).toBe(0.3);
    expect(p.dynamic_thresholding).toBe(true);
    expect(p.characterPrompts.map((c) => c.center)).toEqual([{ x: 0.2, y: 0.8 }, { x: 0.5, y: 0.5 }]);
    expect(p.v4_prompt.caption.char_captions.map((c) => c.centers)).toEqual([[{ x: 0.2, y: 0.8 }], [{ x: 0.5, y: 0.5 }]]);
    expect(p.v4_negative_prompt.caption.char_captions.map((c) => c.centers)).toEqual([[{ x: 0.2, y: 0.8 }], [{ x: 0.5, y: 0.5 }]]);
    expect(p.v4_negative_prompt.caption.char_captions.map((c) => c.char_caption)).toEqual(['blurry', '']);
  });

  it('1枚・PNG で、公式UIと同じサンプラー関連の値を送る', () => {
    const body = build('a');
    expect(body.use_new_shared_trial).toBe(true);
    expect(body.parameters).toMatchObject({
      params_version: 4,
      n_samples: 1,
      seed: 42,
      width: 832,
      height: 1216,
      steps: 28,
      sampler: 'k_euler_ancestral',
      noise_schedule: 'karras',
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true,
      image_format: 'png',
    });
  });

  it('references が未指定または空配列のときは既存リクエストと完全一致し、director_reference_* を含めない', () => {
    const baseline = build('1girl, solo', 'lowres', [{ prompt: 'girl', negative: 'blurry' }]);
    const withUndefined = buildGenerateRequest({
      prompt: '1girl, solo',
      negative: 'lowres',
      characters: [{ prompt: 'girl', negative: 'blurry' }],
      params,
      references: undefined,
    });
    const withEmpty = buildGenerateRequest({
      prompt: '1girl, solo',
      negative: 'lowres',
      characters: [{ prompt: 'girl', negative: 'blurry' }],
      params,
      references: [],
    });
    expect(withUndefined).toEqual(baseline);
    expect(withEmpty).toEqual(baseline);
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(baseline));
    expect(baseline.parameters).not.toHaveProperty('director_reference_images');
    expect(baseline.parameters).not.toHaveProperty('director_reference_descriptions');
    expect(baseline.parameters).not.toHaveProperty('director_reference_strength_values');
    expect(baseline.parameters).not.toHaveProperty('director_reference_secondary_strength_values');
    expect(baseline.parameters).not.toHaveProperty('director_reference_information_extracted');
  });

  it('references 指定時に docs/novelai-api.md どおりの director_reference_* 配列を出力する', () => {
    const charReq = buildGenerateRequest({
      prompt: '1girl, solo',
      negative: 'lowres',
      characters: [],
      params,
      references: [{ imageBase64: 'AAAABBBB', type: 'character', strength: 1 }],
    });
    expect(charReq.parameters).toMatchObject({
      director_reference_images: ['AAAABBBB'],
      director_reference_descriptions: [
        { caption: { base_caption: 'character', char_captions: [] }, legacy_uc: false },
      ],
      director_reference_strength_values: [1],
      director_reference_secondary_strength_values: [0],
      director_reference_information_extracted: [1],
      normalize_reference_strength_multiple: true,
    });

    const styleReq = buildGenerateRequest({
      prompt: '1girl',
      negative: '',
      characters: [],
      params,
      references: [{ imageBase64: 'data:image/png;base64,STYLE64', type: 'style', strength: 5 }],
    });
    expect(styleReq.parameters.director_reference_images).toEqual(['STYLE64']);
    expect(styleReq.parameters.director_reference_descriptions).toEqual([
      { caption: { base_caption: 'style', char_captions: [] }, legacy_uc: false },
    ]);
    expect(styleReq.parameters.director_reference_strength_values).toEqual([5]);

    const outfitReq = buildGenerateRequest({
      prompt: '1girl',
      negative: '',
      characters: [],
      params,
      references: [{ imageBase64: 'OUTFIT64', type: 'outfit', strength: 2.25 }],
    });
    expect(outfitReq.parameters.director_reference_descriptions).toEqual([
      { caption: { base_caption: 'costume', char_captions: [] }, legacy_uc: false },
    ]);
    expect(outfitReq.parameters.director_reference_strength_values).toEqual([2.25]);

    const clampedReq = buildGenerateRequest({
      prompt: '1girl',
      negative: '',
      characters: [],
      params,
      references: [
        { imageBase64: 'MIN', type: 'character', strength: 0 },
        { imageBase64: 'MAX', type: 'style', strength: 99 },
      ],
    });
    expect(clampedReq.parameters.director_reference_strength_values).toEqual([0.1, 5]);
  });

  it('inpaint 指定時に専用モデル・action: infill・ベース画像寸法・#172 実測フィールドを出力する', () => {
    const req = buildGenerateRequest({
      prompt: '1girl, gold button',
      negative: 'lowres',
      characters: [{ prompt: 'girl, school uniform', negative: 'blurry', center: { x: 0.4, y: 0.6 } }],
      params: { ...params, width: 832, height: 1216, seed: 860023 },
      mode: 'furry',
      inpaint: {
        imageBase64: 'data:image/png;base64,IMGBASE64',
        maskBase64: 'data:image/png;base64,MASKBASE64',
        width: 512,
        height: 512,
        strength: 0.42,
        addOriginalImage: false,
      },
    });

    expect(req.model).toBe(NAI_INPAINT_MODEL);
    expect(req.model).toBe('nai-diffusion-5-full-inpainting');
    expect(req.action).toBe('infill');
    expect(req.input).toBe('fur dataset, 1girl, gold button');
    expect(req.parameters.v4_prompt.caption.base_caption).toBe('fur dataset, 1girl, gold button');
    expect(req.parameters.v4_prompt.caption.char_captions).toEqual([
      { char_caption: 'girl, school uniform', centers: [{ x: 0.4, y: 0.6 }] },
    ]);
    expect(req.parameters).toMatchObject({
      width: 512,
      height: 512,
      strength: 0.7,
      noise: 0,
      inpaintImg2ImgStrength: 0.42,
      add_original_image: false,
      seed: 860023,
      extra_noise_seed: 860022,
      image: 'IMGBASE64',
      mask: 'MASKBASE64',
    });
    expect(req.parameters).not.toHaveProperty('director_reference_images');
    expect(req.parameters).not.toHaveProperty('img2img');

    // addOriginalImage: true と強さクランプ・seed 0 境界
    const clamped = buildGenerateRequest({
      prompt: '1girl',
      negative: '',
      characters: [],
      params: { ...params, seed: 0 },
      inpaint: {
        imageBase64: 'IMG',
        maskBase64: 'MASK',
        width: 1024,
        height: 1024,
        strength: 0,
        addOriginalImage: true,
      },
    });
    expect(clamped.parameters.inpaintImg2ImgStrength).toBe(0.01);
    expect(clamped.parameters.add_original_image).toBe(true);
    expect(clamped.parameters.extra_noise_seed).toBe(0);

    // 非無料枠サイズは防御的に拒否
    expect(() =>
      buildGenerateRequest({
        prompt: '1girl',
        negative: '',
        characters: [],
        params,
        inpaint: {
          imageBase64: 'IMG',
          maskBase64: 'MASK',
          width: 1200,
          height: 900,
          strength: 1,
          addOriginalImage: false,
        },
      }),
    ).toThrow(NovelAIError);
  });

  it('references と inpaint の同時指定を防御的に拒否する', () => {
    expect(() =>
      buildGenerateRequest({
        prompt: '1girl',
        negative: '',
        characters: [],
        params,
        references: [{ imageBase64: 'REF', type: 'character', strength: 1 }],
        inpaint: {
          imageBase64: 'IMG',
          maskBase64: 'MASK',
          width: 512,
          height: 512,
          strength: 1,
          addOriginalImage: false,
        },
      }),
    ).toThrow('同時に使用できません');
  });
});

describe('isFreeGeneration', () => {
  it('1024×1024 相当以下・28 steps 以下なら Anlas を消費しない', () => {
    expect(isFreeGeneration({ width: 832, height: 1216, steps: 28 })).toBe(true);
    expect(isFreeGeneration({ width: 1024, height: 1024, steps: 28 })).toBe(true);
    expect(isFreeGeneration({ width: 1024, height: 1088, steps: 28 })).toBe(false);
    expect(isFreeGeneration({ width: 832, height: 1216, steps: 29 })).toBe(false);
  });

  it('64 の倍数・辺の範囲・整数・ステップ範囲を厳格に判定する', () => {
    // 辺の端と、画素数がちょうど上限になる組み合わせは無料枠内
    expect(isFreeGeneration({ width: 512, height: 2048, steps: 28 })).toBe(true);
    expect(isFreeGeneration({ width: 64, height: 64, steps: 1 })).toBe(true);
    expect(isFreeGeneration({ width: 640, height: 1536, steps: 28 })).toBe(true);
    // 非 64 倍数・範囲外・非整数は拒否
    expect(isFreeGeneration({ width: 900, height: 1152, steps: 28 })).toBe(false);
    expect(isFreeGeneration({ width: 832, height: 1216, steps: 28 })).toBe(true);
    expect(isFreeGeneration({ width: 32, height: 1216, steps: 28 })).toBe(false);
    expect(isFreeGeneration({ width: 2112, height: 448, steps: 28 })).toBe(false);
    expect(isFreeGeneration({ width: 832.5, height: 1216, steps: 28 })).toBe(false);
    expect(isFreeGeneration({ width: NaN, height: 1216, steps: 28 })).toBe(false);
    expect(isFreeGeneration({ width: 832, height: Infinity, steps: 28 })).toBe(false);
    // ステップは 1〜28 の整数のみ
    expect(isFreeGeneration({ width: 832, height: 1216, steps: 0 })).toBe(false);
    expect(isFreeGeneration({ width: 832, height: 1216, steps: 28.5 })).toBe(false);
    expect(isFreeGeneration({ width: 832, height: 1216, steps: NaN })).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('古い保存データには既定値を補う', () => {
    expect(normalizeSettings({ weightSyntax: 'brace' })).toEqual({
      ...DEFAULT_SETTINGS,
      weightSyntax: 'brace',
    });
  });
  it('空のキャラクター用ネガティブは「なし」として残す', () => {
    expect(normalizeSettings({ characterNegativePrompt: '' }).characterNegativePrompt).toBe('');
  });
  it('ネガティブはワークスペースへ移したので設定には残さない', () => {
    expect(normalizeSettings({ negativePrompt: 'lowres' })).toEqual(DEFAULT_SETTINGS);
  });
  it('壊れた値は既定値にする', () => {
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ weightSyntax: 'x', characterNegativePrompt: 1 })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('parseSubscription', () => {
  it('trainingStepsLeft の中の付与分と購入分を合計し、プラン・V5 利用枠・期限を読み取る', () => {
    expect(
      parseSubscription({
        tier: 3,
        trainingStepsLeft: { fixedTrainingStepsLeft: 10000, purchasedTrainingSteps: 8000 },
        expiresAt: 1798761600,
        usage: { percent: 23, isNegative: false, timeUntilNextPercent: 5400 },
      }),
    ).toEqual({
      tier: 3,
      fixedTrainingStepsLeft: 10000,
      purchasedTrainingSteps: 8000,
      totalAnlas: 18000,
      expiresAt: 1798761600000,
      usage: { percent: 23, isNegative: false, timeUntilNextPercent: 5400 },
    });
    expect(tierName(0)).toBe('Paper');
    expect(tierName(1)).toBe('Tablet');
    expect(tierName(2)).toBe('Scroll');
    expect(tierName(3)).toBe('Opus');
  });

  it('平坦な応答（旧形式）も読める', () => {
    expect(parseSubscription({ tier: 1, fixedTrainingStepsLeft: 400, purchasedTrainingSteps: 100 })).toEqual({
      tier: 1,
      fixedTrainingStepsLeft: 400,
      purchasedTrainingSteps: 100,
      totalAnlas: 500,
      expiresAt: null,
      usage: null,
    });
  });

  it('残高がまったく読めない応答は null にする', () => {
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription('x')).toBeNull();
    expect(parseSubscription({ tier: 3 })).toBeNull();
    expect(parseSubscription({ tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 100 } })).toBeNull();
    expect(parseSubscription({ tier: 3, fixedTrainingStepsLeft: '100', purchasedTrainingSteps: 0 })).toBeNull();
  });

  it('ミリ秒の期限と壊れた usage はそのまま扱う', () => {
    const parsed = parseSubscription({
      tier: 3,
      trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 0 },
      expiresAt: 1798761600000,
      usage: { percent: 'x' },
    });
    expect(parsed?.expiresAt).toBe(1798761600000);
    expect(parsed?.usage).toBeNull();
  });
});

describe('fetchSubscription', () => {
  afterEach(() => vi.unstubAllGlobals());

  const subscriptionJson = {
    tier: 3,
    trainingStepsLeft: { fixedTrainingStepsLeft: 10000, purchasedTrainingSteps: 8000 },
    expiresAt: 1798761600,
    usage: { percent: 10, isNegative: false, timeUntilNextPercent: 3600 },
  };

  it('image.novelai.net の /user/subscription に Bearer トークンで問い合わせる', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(subscriptionJson), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const data = await fetchSubscription('pst-secret');
    expect(data.totalAnlas).toBe(18000);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SUBSCRIPTION_URL);
    expect(url).toBe('https://image.novelai.net/user/subscription');
    expect(url).not.toContain('api.novelai.net');
    expect(url).not.toContain('pst-secret');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer pst-secret' });
    expect(init.credentials).toBe('omit');
  });

  it('401 は NovelAIError になり、表示文はトークン無効になる', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"Invalid token"}', { status: 401 }));
    const err = await fetchSubscription('pst-bad').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NovelAIError);
    expect(err).toMatchObject({ status: 401 });
    expect(describeSubscriptionError(err)).toBe('トークンが無効です');
  });

  it('残高の読めない応答と改行トークンは fetch 前に拒否する', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    await expect(fetchSubscription('pst-ok')).rejects.toBeInstanceOf(NovelAIError);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchSubscription('pst-abc\nxyz')).rejects.toBeInstanceOf(NovelAIError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
