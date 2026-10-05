import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEGATIVE,
  DEFAULT_PARAMS,
  NAI_MODEL,
  buildGenerateRequest,
  isFreeGeneration,
} from '../src/lib/novelai';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/lib/settings';

const params = { ...DEFAULT_PARAMS, seed: 42 };
const build = (prompt: string, negative = '', characters: Array<{ prompt: string; negative: string }> = []) =>
  buildGenerateRequest({ prompt, negative, characters, params });

describe('buildGenerateRequest (V5)', () => {
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
});

describe('isFreeGeneration', () => {
  it('1024×1024 相当以下・28 steps 以下なら Anlas を消費しない', () => {
    expect(isFreeGeneration({ width: 832, height: 1216, steps: 28 })).toBe(true);
    expect(isFreeGeneration({ width: 1024, height: 1024, steps: 28 })).toBe(true);
    expect(isFreeGeneration({ width: 1024, height: 1088, steps: 28 })).toBe(false);
    expect(isFreeGeneration({ width: 832, height: 1216, steps: 29 })).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('古い保存データには既定のネガティブを補う', () => {
    expect(normalizeSettings({ weightSyntax: 'brace' })).toEqual({
      ...DEFAULT_SETTINGS,
      weightSyntax: 'brace',
    });
    expect(DEFAULT_SETTINGS.negativePrompt).toBe(DEFAULT_NEGATIVE);
  });
  it('空のネガティブは「なし」として残す', () => {
    expect(normalizeSettings({ negativePrompt: '' }).negativePrompt).toBe('');
  });
  it('壊れた値は既定値にする', () => {
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ weightSyntax: 'x', negativePrompt: 1 })).toEqual(DEFAULT_SETTINGS);
  });
});
