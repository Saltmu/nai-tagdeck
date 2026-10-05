import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, NAI_MODEL, buildGenerateRequest, isFreeGeneration } from '../src/lib/novelai';

const params = { ...DEFAULT_PARAMS, seed: 42 };

describe('buildGenerateRequest (V5)', () => {
  it('プロンプトを input / prompt / v4_prompt の3か所に入れる', () => {
    const body = buildGenerateRequest('1girl, solo', [], params);
    expect(body.model).toBe(NAI_MODEL);
    expect(body.model).toBe('nai-diffusion-5-full');
    expect(body.action).toBe('generate');
    expect(body.input).toBe('1girl, solo');
    expect(body.parameters.prompt).toBe('1girl, solo');
    expect(body.parameters.v4_prompt.caption).toEqual({ base_caption: '1girl, solo', char_captions: [] });
  });

  it('ネガティブは空でも v4_negative_prompt を必ず送る', () => {
    const p = buildGenerateRequest('a', [], params).parameters;
    expect(p.negative_prompt).toBe('');
    expect(p.v4_negative_prompt.caption).toEqual({ base_caption: '', char_captions: [] });
  });

  it('キャラクターを char_captions に入れ、ネガティブ側も同じ数だけ空で並べる', () => {
    const p = buildGenerateRequest('2girls', ['girl, red hair', 'girl, blue hair'], params).parameters;
    expect(p.v4_prompt.caption.char_captions).toEqual([
      { char_caption: 'girl, red hair', centers: [{ x: 0.5, y: 0.5 }] },
      { char_caption: 'girl, blue hair', centers: [{ x: 0.5, y: 0.5 }] },
    ]);
    expect(p.v4_prompt.use_coords).toBe(false);
    expect(p.v4_negative_prompt.caption.char_captions.map((c) => c.char_caption)).toEqual(['', '']);
  });

  it('生成は常に1枚、シードを extra_noise_seed にも入れる', () => {
    const p = buildGenerateRequest('a', [], params).parameters;
    expect(p).toMatchObject({ n_samples: 1, seed: 42, extra_noise_seed: 42, width: 832, height: 1216, steps: 28 });
  });
});

describe('isFreeGeneration', () => {
  it('1024×1024 相当以下・28 steps 以下なら Anlas を消費しない', () => {
    expect(isFreeGeneration({ width: 832, height: 1216, steps: 28 })).toBe(true);
    expect(isFreeGeneration({ width: 1024, height: 1024, steps: 28 })).toBe(true);
    expect(isFreeGeneration({ width: 1024, height: 1088, steps: 28 })).toBe(false);
    expect(isFreeGeneration({ width: 832, height: 1216, steps: 29 })).toBe(false);
  });
});
