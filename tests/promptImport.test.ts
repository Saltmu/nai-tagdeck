import { describe, expect, it } from 'vitest';
import type { GeneratedImage } from '../src/hooks/useImages';
import { parseBackup, toBackupJSON } from '../src/lib/backup';
import { DEFAULT_GENERATION } from '../src/lib/generation';
import { createPreset, presetToWorkspace, sameWorkspace } from '../src/lib/presets';
import { buildCharacterPrompts, buildPrompt } from '../src/lib/prompt';
import { importedBaseForMode, promptImportFromGeneratedImage, readPromptImport, readPromptImportWithFallback } from '../src/lib/promptImport';
import { restoreInitialDictionary } from '../src/lib/sampleDictionary';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { BASE, emptyWorkspace, normalizeWorkspace, workspaceReducer } from '../src/lib/workspace';
import type { CategoryKey, DictEntry } from '../src/types';
import { caption, pngFixture } from './promptImportFixture';

function entry(tag: string, category: CategoryKey): DictEntry {
  return { id: `${category}:${tag}`, tag, category, default_weight: 1.5, alias: 'alias', sort_order: 0, updated_at: '' };
}

const read = (comment: Record<string, unknown>, entries: DictEntry[] = []) =>
  readPromptImport(new Blob([pngFixture(comment)]), entries);

describe('NovelAI PNG import', () => {
  it('classifies the gallery sample prompt against the built-in dictionary after loading it', async () => {
    const result = await read({
      v4_prompt: caption('amazing quality, masterpiece, detailed, lineart, realistic, oil painting (medium), land space'),
    }, restoreInitialDictionary([]));
    expect(result.base.quality.map((tag) => tag.tag)).toEqual(['amazing quality', 'masterpiece', 'detailed']);
    expect(result.base.style.map((tag) => tag.tag)).toEqual(['lineart', 'realistic', 'oil painting (medium)']);
    expect(result.base.unclassified.map((tag) => tag.tag)).toEqual(['land space']);
  });

  it('keeps original spelling, duplicates, weights and per-character categories without editing the PNG or dictionary', async () => {
    const entries = [
      entry('Blazer', 'outfit'), entry('blazer', 'outfit'), entry('standing', 'pose'),
      entry('ambiguous', 'pose'), entry('ambiguous', 'style'), entry('oil painting', 'style'),
      entry('red_hair', 'appearance'), entry('hug', 'pose'),
    ];
    const dict = structuredClone(entries);
    const bytes = pngFixture({
      prompt: 'fallback',
      uc: 'fallback',
      v4_prompt: caption('blazer, -1.2::custom tag::, standing, BLAZER, ambiguous, alias', ['{red hair}, oil painting, source#hug', 'standing']),
      v4_negative_prompt: caption('', ['lowres', 'lowres']),
      seed: 322018465, width: 1024, height: 1024, steps: 28, scale: 5,
      sampler: 'k_euler_ancestral', noise_schedule: 'karras',
    });
    const blob = new Blob([bytes], { type: 'image/png' });
    const result = await readPromptImport(blob, entries);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(entries).toEqual(dict);
    expect(result.base.outfit.map((t) => [t.tag, t.weight, t.enabled])).toEqual([['blazer', 1, true]]);
    expect(buildPrompt(result.base, 'numeric')).toBe('blazer, standing, -1.2::custom tag::, ambiguous, alias');
    expect(buildCharacterPrompts(result.characters, 'numeric').map((c) => c.prompt))
      .toEqual(['1.05::red hair::, oil painting, source#hug', 'standing']);
    expect(result.characters[0]?.tags.unclassified.map((t) => t.tag)).toEqual(['oil painting', 'source#hug']);
    expect(result.negative).toEqual([]);
    expect(result.characterNegative).toBe('lowres');
    expect(result.generation.values).toEqual({
      seed: 322018465, size: 'square', steps: 28, scale: 5, sampler: 'k_euler_ancestral', noiseSchedule: 'karras',
    });
  });

  it('reports unsupported settings, incompatible character negatives and adjusted weights', async () => {
    const result = await read({
      v4_prompt: caption('4::hat::, 1.234::shirt::', ['girl', 'boy']),
      v4_negative_prompt: caption('', ['lowres', '']),
      width: 1000, height: 1000, seed: 123, steps: 50, scale: 12, noise_schedule: 'karras',
    });
    expect(result.characterNegative).toBeUndefined();
    expect(result.characters.map((c) => c.negative)).toEqual(['lowres', '']);
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.stringContaining('個別欄'),
      expect.stringContaining('4 から 3'), expect.stringContaining('1.234 から 1.23'),
      expect.stringContaining('lowres'), expect.stringContaining('（空欄）'),
    ]));
    expect(result.generation.values).toEqual({ seed: 123, noiseSchedule: 'karras' });
    expect(result.generation.skipped).toEqual(['サイズ', 'ステップ', 'ガイダンス', 'サンプラー']);
  });

  it('checks coordinates before sharing the character negative prompt', async () => {
    const negative = caption('', ['lowres']);
    negative.caption.char_captions[0]!.centers[0]!.x = 0.5;
    const result = await read({ v4_prompt: { ...caption('2girls', ['girl']), use_coords: true }, v4_negative_prompt: negative });
    expect(result.characterNegative).toBeUndefined();
    expect(result.characters[0]).toMatchObject({ negative: 'lowres', center: { x: 0, y: 0 } });
    expect(result.notes.join('\n')).toContain('位置が正のプロンプトと違うため、各キャラの個別欄に入れました');
    expect(result.notes.join('\n')).not.toContain('座標は反映できません');
    expect((await read({ v4_prompt: caption('', ['girl']), v4_negative_prompt: caption('', ['']) })).characterNegative).toBe('');
  });

  it('stores a usable center and reports when none can be read', async () => {
    const positive = caption('2girls', ['girl']);
    positive.use_coords = true;
    positive.caption.char_captions[0]!.centers = [{ x: 0.254, y: 1.4 }];
    const placed = await read({ v4_prompt: positive, v4_negative_prompt: caption('', ['lowres']) });
    expect(placed.characters[0]?.center).toEqual({ x: 0.25, y: 1 });
    expect(placed.characterNegative).toBeUndefined();
    expect(placed.characters[0]?.negative).toBe('lowres');

    const missing = caption('2girls', ['girl']);
    missing.use_coords = true;
    missing.caption.char_captions[0]!.centers = [];
    const unread = await read({ v4_prompt: missing });
    expect(unread.characters[0]?.center).toBeUndefined();
    expect(unread.notes.join('\n')).toContain('座標は反映できません');

    const partial = caption('2girls', ['girl', 'boy']);
    partial.use_coords = true;
    partial.caption.char_captions[0]!.centers = [{ x: 0.2, y: 0.3 }];
    partial.caption.char_captions[1]!.centers = [];
    const mixed = await read({ v4_prompt: partial });
    expect(mixed.characters[0]?.center).toEqual({ x: 0.2, y: 0.3 });
    expect(mixed.characters[1]?.center).toBeUndefined();
    expect(mixed.notes.join('\n')).toContain('キャラ2 の座標は読み取れませんでした。再生成では中央（0.5, 0.5）になります。');
    expect(mixed.notes.join('\n')).not.toContain('座標は反映できません');
  });

  it('imports cfg rescale and dynamic thresholding only when the image records them', async () => {
    const recorded = await read({ prompt: 'standing', cfg_rescale: 0.456, dynamic_thresholding: true });
    expect(recorded.generation.values).toMatchObject({ cfgRescale: 0.46, dynamicThresholding: true });
    expect(recorded.generation.skipped).not.toEqual(expect.arrayContaining(['CFGリスケール', 'ダイナミックしきい値']));
    const absent = await read({ prompt: 'standing' });
    expect(absent.generation.values).not.toHaveProperty('cfgRescale');
    expect(absent.generation.values).not.toHaveProperty('dynamicThresholding');
    expect(absent.generation.skipped).not.toEqual(expect.arrayContaining(['CFGリスケール', 'ダイナミックしきい値']));
  });

  it('supports the verified base-only fields and keeps missing values absent', async () => {
    const result = await read({ prompt: 'standing', uc: 'lowres', seed: 0 });
    expect(result.characters).toEqual([]);
    expect(result.negative?.[0]?.tag).toBe('lowres');
    expect(result.generation.values).toEqual({ seed: 0 });
    expect((await read({ prompt: 'standing' })).negative).toBeUndefined();
    const signed = { prompt: 'standing', model_name: 'NovelAI Diffusion V5', model_hash: '0ADF9AB7', signed_hash: '<fixture>' };
    expect((await readPromptImport(new Blob([pngFixture(signed, { origin: false })]), [])).base.unclassified[0]?.tag).toBe('standing');
  });

  it('keeps up to 15 characters, with only the first 6 enabled', async () => {
    const chars = Array.from({ length: 15 }, (_, i) => `person ${i + 1}`);
    const result = await read({ v4_prompt: caption('group', chars) });
    expect(result.characters).toHaveLength(15);
    expect(result.characters.filter((c) => c.enabled)).toHaveLength(6);
    await expect(read({ v4_prompt: caption('group', [...chars, 'extra']) })).rejects.toThrow('保存上限');
  });

  it('rejects missing metadata, invalid comments, unknown origin, empty prompts and truncated chunks', async () => {
    await expect(readPromptImport(new Blob(['not png']), [])).rejects.toThrow('PNG 画像');
    await expect(readPromptImport(new Blob([pngFixture()]), [])).rejects.toThrow('生成情報');
    await expect(readPromptImport(new Blob([pngFixture('{')]), [])).rejects.toThrow('JSON');
    await expect(readPromptImport(new Blob([pngFixture({ prompt: 'a' }, { origin: false })]), [])).rejects.toThrow('NovelAI');
    await expect(read({ v4_prompt: caption(''), prompt: 'ignored' })).rejects.toThrow('適用できる正');
    await expect(read({ v4_prompt: { caption: { base_caption: 'base', char_captions: [null] } } })).rejects.toThrow('形式');
    await expect(readPromptImport(new Blob([pngFixture({ prompt: 'a' }).slice(0, -2)]), [])).rejects.toThrow('途中');
  });

  it.each([['zTXt', 'café'], ['iTXt', '蓮の花']] as const)('reads compressed %s metadata', async (commentType, prompt) => {
    const result = await readPromptImport(new Blob([pngFixture({ prompt }, { commentType })]), []);
    expect(result.base.unclassified[0]?.tag).toBe(prompt);
  });

  it('moves unclassified tags without duplicating the same tag and round-trips them via presets and backups', async () => {
    const result = await read({ v4_prompt: caption('b, -1::A::', ['b']) });
    const before = workspaceReducer(emptyWorkspace(), { type: 'replace', workspace: { ...result, negative: [] } });
    const toggleId = before.base.unclassified[1]!.id;
    const toggled = workspaceReducer(before, { type: 'toggle', target: BASE, category: 'unclassified', id: toggleId });
    const moved = workspaceReducer(toggled, {
      type: 'moveTag',
      fromTarget: BASE,
      fromCategory: 'unclassified',
      id: toggleId,
      toTarget: BASE,
      toCategory: 'outfit',
    });
    expect(moved.base.outfit).toEqual([toggled.base.unclassified[1]]);
    expect(moved.base.unclassified).toEqual([before.base.unclassified[0]]);
    const duplicate = normalizeWorkspace({
      ...moved,
      base: { ...moved.base, unclassified: [...moved.base.unclassified, { id: 'dup', tag: 'a', weight: 1, enabled: true }] },
    });
    expect(workspaceReducer(duplicate, {
      type: 'moveTag',
      fromTarget: BASE,
      fromCategory: 'unclassified',
      id: 'dup',
      toTarget: BASE,
      toCategory: 'outfit',
    }).base.outfit).toEqual(moved.base.outfit);
    expect(buildPrompt(moved.base, 'numeric')).toBe('b');
    const character = moved.characters[0]!;
    const action = {
      type: 'moveTag',
      fromTarget: character.id,
      fromCategory: 'unclassified',
      id: character.tags.unclassified[0]!.id,
      toTarget: character.id,
    } as const;
    expect(workspaceReducer(moved, { ...action, toCategory: 'quality' })).toBe(moved);
    expect(workspaceReducer(moved, { ...action, toCategory: 'pose', id: 'missing' })).toBe(moved);
    expect(workspaceReducer(moved, { ...action, toCategory: 'pose' }).characters[0]?.tags.pose).toEqual(character.tags.unclassified);
    expect(normalizeWorkspace({ base: {}, characters: [{ tags: {} }] }).characters[0]?.tags.unclassified).toEqual([]);
    expect(sameWorkspace(before, moved)).toBe(false);
    const preset = createPreset('image', moved);
    expect(presetToWorkspace(preset.workspace, before)).toEqual(moved);
    const backup = parseBackup(toBackupJSON({
      dictionary: [], presets: [preset], workspace: moved, settings: DEFAULT_SETTINGS, generation: DEFAULT_GENERATION,
    }));
    expect(backup.ok && backup.data.workspace).toEqual(moved);
    expect(normalizeWorkspace(JSON.parse(JSON.stringify(moved)))).toEqual(moved);
  });

  it('filters dictionary categories by allowed scope before falling back to unclassified', async () => {
    const entries = [
      entry('glow', 'effect'),
      entry('glow', 'negative'),
      entry('dynamic', 'effect'),
      entry('dynamic', 'pose'),
    ];
    const result = await read({ v4_prompt: caption('glow, dynamic', ['dynamic']) }, entries);
    expect(result.base.effect.map((t) => t.tag)).toEqual(['glow']);
    expect(result.base.unclassified.map((t) => t.tag)).toEqual(['dynamic']);
    expect(result.characters[0]?.tags.pose.map((t) => t.tag)).toEqual(['dynamic']);
  });

  it('deduplicates normalized tags within each scope while keeping the first occurrence', async () => {
    const result = await read({
      v4_prompt: caption('red_hair, 1.2::red hair::, BLUE_EYES, blue eyes', ['red hair, RED_HAIR']),
      v4_negative_prompt: caption('lowres, LOWRES'),
    });
    expect(result.base.unclassified.map((t) => [t.tag, t.weight])).toEqual([['red_hair', 1], ['BLUE_EYES', 1]]);
    expect(result.characters[0]?.tags.unclassified.map((t) => t.tag)).toEqual(['red hair']);
    expect(result.negative?.map((t) => t.tag)).toEqual(['lowres']);
  });

  it('detects leading fur dataset as furry mode without duplicating it, while keeping it leading for anime mode', async () => {
    const furry = await read({ v4_prompt: caption('Fur_Dataset, blazer, fur dataset, wolf') }, [entry('blazer', 'outfit')]);
    expect(furry.furDataset).toBe('Fur_Dataset');
    expect(furry.base.outfit.map((t) => t.tag)).toEqual(['blazer']);
    expect(furry.base.unclassified.map((t) => t.tag)).toEqual(['wolf']);
    expect(buildPrompt(importedBaseForMode(furry, 'furry'), 'numeric')).toBe('blazer, wolf');
    expect(buildPrompt(importedBaseForMode(furry, 'anime'), 'numeric')).toBe('Fur_Dataset, blazer, wolf');
    expect(furry.generation.values.mode).toBe('furry');
    expect(furry.generation.labels).toContain('生成モード ケモノ');
    expect(furry.notes).not.toContain('生成モード（アニメ／ケモノ）は現在の設定を使います。');

    const charOnly = await read({ v4_prompt: caption('fur dataset', ['wolf']) });
    expect(charOnly.base.unclassified).toEqual([]);
    expect(buildPrompt(importedBaseForMode(charOnly, 'anime'), 'numeric')).toBe('fur dataset');
    expect(charOnly.characters[0]?.tags.unclassified.map((t) => t.tag)).toEqual(['wolf']);
    expect(charOnly.generation.values.mode).toBe('furry');

    const furOnly = await read({ v4_prompt: caption('fur dataset') });
    expect(furOnly.base.unclassified.map((t) => t.tag)).toEqual(['fur dataset']);
    expect(buildPrompt(importedBaseForMode(furOnly, 'anime'), 'numeric')).toBe('fur dataset');
    expect(buildPrompt(importedBaseForMode(furOnly, 'furry'), 'numeric')).toBe('fur dataset');
    expect(furOnly.generation.values.mode).toBe('furry');

    const nonLeading = await read({ prompt: 'wolf, fur dataset' });
    expect(nonLeading.furDataset).toBeUndefined();
    expect(nonLeading.base.unclassified.map((t) => t.tag)).toEqual(['wolf', 'fur dataset']);
    expect(nonLeading.generation.values.mode).toBeUndefined();
  });

  it('imports a free-tier custom size from a PNG and skips out-of-range sizes', async () => {
    const custom = await read({ prompt: 'standing', width: 896, height: 1152, seed: 1 });
    expect(custom.generation.values).toMatchObject({ size: 'custom', customWidth: 896, customHeight: 1152, seed: 1 });
    expect(custom.generation.labels).toContain('サイズ カスタム 896×1152');
    expect(custom.generation.skipped).not.toContain('サイズ');

    const tooBig = await read({ prompt: 'standing', width: 1024, height: 1536, seed: 1 });
    expect(tooBig.generation.values).not.toHaveProperty('size');
    expect(tooBig.generation.values).not.toHaveProperty('customWidth');
    expect(tooBig.generation.skipped).toContain('サイズ');

    const notMultiple = await read({ prompt: 'standing', width: 900, height: 1152, seed: 1 });
    expect(notMultiple.generation.values).not.toHaveProperty('size');
    expect(notMultiple.generation.skipped).toContain('サイズ');
  });

  it('rounds in-range scale values to one decimal place and skips out-of-range values', async () => {
    expect((await read({ prompt: 'a', scale: 5.01 })).generation.values.scale).toBe(5);
    expect((await read({ prompt: 'a', scale: 5.26 })).generation.values.scale).toBe(5.3);
    expect((await read({ prompt: 'a', scale: 0 })).generation.values.scale).toBe(0);
    expect((await read({ prompt: 'a', scale: 10 })).generation.values.scale).toBe(10);
    expect((await read({ prompt: 'a', scale: -0.1 })).generation.skipped).toContain('ガイダンス');
    expect((await read({ prompt: 'a', scale: 10.1 })).generation.skipped).toContain('ガイダンス');
  });
});

function generatedImage(overrides: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: 'img-1',
    url: 'blob:mock',
    blob: new Blob(['x'], { type: 'image/png' }),
    seed: 42,
    width: 1024,
    height: 1024,
    prompt: 'blazer, standing',
    characterPrompts: ['girl'],
    negativePrompt: 'lowres',
    characterDetails: [{ prompt: 'girl', negative: 'lowres' }],
    params: {
      mode: 'anime', steps: 28, scale: 5, sampler: 'k_euler_ancestral',
      noiseSchedule: 'karras', cfgRescale: 0.5, dynamicThresholding: true,
    },
    createdAt: 0,
    downloaded: false,
    pinned: false,
    ...overrides,
  };
}

const FALLBACK_NOTE = '画像から生成情報を読み取れなかったため、履歴に保持していた送信情報から読み込みました。';

describe('GeneratedImage fallback import', () => {
  it('restores base, character, negative and generation settings from structured history', () => {
    const result = promptImportFromGeneratedImage(generatedImage(), [entry('blazer', 'outfit'), entry('standing', 'pose')]);
    expect(result.base.outfit.map((t) => t.tag)).toEqual(['blazer']);
    expect(result.base.pose.map((t) => t.tag)).toEqual(['standing']);
    expect(result.characters[0]?.tags.unclassified.map((t) => t.tag)).toEqual(['girl']);
    expect(result.negative?.map((t) => t.tag)).toEqual(['lowres']);
    expect(result.characterNegative).toBe('lowres');
    expect(result.characters[0]?.negative).toBeUndefined();
    expect(result.generation.values).toEqual({
      mode: 'anime', seed: 42, size: 'square', steps: 28, scale: 5,
      sampler: 'k_euler_ancestral', noiseSchedule: 'karras', cfgRescale: 0.5, dynamicThresholding: true,
    });
    expect(result.generation.labels).toContain('生成モード アニメ');
    expect(result.notes).toContain(FALLBACK_NOTE);
    expect(result.notes).not.toContain('生成モード（アニメ／ケモノ）は現在の設定を使います。');
  });

  it('detects furry mode from the stored params and the fur dataset prefix', () => {
    const result = promptImportFromGeneratedImage(generatedImage({
      prompt: 'fur dataset, blazer, wolf',
      characterPrompts: ['wolf'],
      characterDetails: [{ prompt: 'wolf', negative: 'lowres' }],
      params: {
        mode: 'furry', steps: 28, scale: 5, sampler: 'k_euler_ancestral',
        noiseSchedule: 'karras', cfgRescale: 0, dynamicThresholding: false,
      },
    }), [entry('blazer', 'outfit')]);
    expect(result.furDataset).toBe('fur dataset');
    expect(result.generation.values.mode).toBe('furry');
    expect(result.generation.labels).toContain('生成モード ケモノ');
    expect(buildPrompt(importedBaseForMode(result, 'furry'), 'numeric')).toBe('blazer, wolf');
    expect(buildPrompt(importedBaseForMode(result, 'anime'), 'numeric')).toBe('fur dataset, blazer, wolf');
  });

  it('keeps per-character negatives and coordinates when they differ', () => {
    const result = promptImportFromGeneratedImage(generatedImage({
      prompt: '2girls',
      characterPrompts: ['girl, red hair', 'boy'],
      characterDetails: [
        { prompt: 'girl, red hair', negative: 'lowres', center: { x: 0.2, y: 0.3 } },
        { prompt: 'boy', negative: 'blurry', center: { x: 0.7, y: 0.4 } },
      ],
    }), []);
    expect(result.characters).toHaveLength(2);
    expect(result.characters[0]?.center).toEqual({ x: 0.2, y: 0.3 });
    expect(result.characters[1]?.center).toEqual({ x: 0.7, y: 0.4 });
    expect(result.characterNegative).toBeUndefined();
    expect(result.characters.map((c) => c.negative)).toEqual(['lowres', 'blurry']);
    expect(result.notes.join('\n')).toContain('キャラごとに違うため、各キャラの個別欄に入れました');
    expect(result.notes.join('\n')).toContain('キャラ用ネガティブ 1　lowres');
    expect(result.notes.join('\n')).toContain('キャラ用ネガティブ 2　blurry');
  });

  it('restores only positive prompts from old history without params or character details', () => {
    const image = generatedImage({
      prompt: 'standing', seed: 123, width: 832, height: 1216,
      characterPrompts: ['girl'],
    });
    delete image.negativePrompt;
    delete image.characterDetails;
    delete image.params;
    const result = promptImportFromGeneratedImage(image, []);
    expect(result.characters[0]?.tags.unclassified.map((t) => t.tag)).toEqual(['girl']);
    expect(result.negative).toBeUndefined();
    expect(result.notes).toContain('全体ネガティブを読み取れないため、現在の値を使います。');
    expect(result.notes).toContain('画像のキャラ用ネガティブを共通欄に反映できないため、現在の値を使います。');
    expect(result.notes).toContain('生成モード（アニメ／ケモノ）は現在の設定を使います。');
    expect(result.generation.values).toEqual({ seed: 123, size: 'portrait' });
    expect(result.generation.skipped).toEqual(expect.arrayContaining(['ステップ', 'ガイダンス', 'サンプラー', 'ノイズスケジュール']));
    expect(result.generation.values).not.toHaveProperty('mode');
  });

  it('rejects an empty prompt and more than 15 characters', () => {
    expect(() => promptImportFromGeneratedImage(generatedImage({ prompt: '', characterPrompts: [], characterDetails: [] }), []))
      .toThrow('適用できる正のプロンプトがありません');
    const many = Array.from({ length: 16 }, (_, i) => ({ prompt: `person ${i + 1}`, negative: '' }));
    expect(() => promptImportFromGeneratedImage(generatedImage({
      prompt: 'group', characterPrompts: many.map((c) => c.prompt), characterDetails: many,
    }), [])).toThrow('保存上限');
  });

  it('uses the fallback only when PNG metadata cannot be read, and keeps PNG priority otherwise', async () => {
    const fallback = generatedImage();
    const fromFallback = await readPromptImportWithFallback(
      { blob: new Blob([pngFixture()]), fallbackImage: fallback }, [],
    );
    expect(fromFallback.base.unclassified.map((t) => t.tag)).toEqual(['blazer', 'standing']);
    expect(fromFallback.notes).toContain(FALLBACK_NOTE);

    await expect(readPromptImportWithFallback({ blob: new Blob([pngFixture()]) }, []))
      .rejects.toThrow('生成情報');

    const fromPng = await readPromptImportWithFallback(
      { blob: new Blob([pngFixture({ v4_prompt: caption('standing', ['girl']) })]), fallbackImage: fallback }, [],
    );
    expect(fromPng.base.unclassified.map((t) => t.tag)).toEqual(['standing']);
    expect(fromPng.notes).not.toContain(FALLBACK_NOTE);

    await expect(readPromptImportWithFallback(
      { blob: new Blob([pngFixture()]), fallbackImage: generatedImage({ prompt: '', characterPrompts: [], characterDetails: [] }) }, [],
    )).rejects.toThrow('適用できる正のプロンプトがありません');
  });
});
