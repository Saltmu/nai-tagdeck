import { describe, expect, it } from 'vitest';
import { parseBackup, toBackupJSON } from '../src/lib/backup';
import { DEFAULT_GENERATION } from '../src/lib/generation';
import { createPreset, presetToWorkspace, sameWorkspace } from '../src/lib/presets';
import { buildCharacterPrompts, buildPrompt } from '../src/lib/prompt';
import { readPromptImport } from '../src/lib/promptImport';
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
    expect(result.base.outfit.map((t) => [t.tag, t.weight, t.enabled])).toEqual([['blazer', 1, true], ['BLAZER', 1, true]]);
    expect(new Set(result.base.outfit.map((t) => t.id)).size).toBe(2);
    expect(buildPrompt(result.base, 'numeric')).toBe('blazer, BLAZER, standing, -1.2::custom tag::, ambiguous, alias');
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
      width: 1000, height: 1000, seed: 123, steps: 50, scale: 5.01, noise_schedule: 'karras',
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
    await expect(readPromptImport(new Blob([pngFixture()]), [])).rejects.toThrow('Comment');
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
    const result = await read({ v4_prompt: caption('b, -1::A::, A', ['b']) });
    const before = workspaceReducer(emptyWorkspace(), { type: 'replace', workspace: { ...result, negative: [] } });
    const toggleId = before.base.unclassified[1]!.id;
    const toggled = workspaceReducer(before, { type: 'toggle', target: BASE, category: 'unclassified', id: toggleId });
    const first = workspaceReducer(toggled, { type: 'moveFromUnclassified', target: BASE, to: 'outfit', id: toggleId });
    const moved = workspaceReducer(first, { type: 'moveFromUnclassified', target: BASE, to: 'outfit', id: before.base.unclassified[2]!.id });
    expect(moved.base.outfit).toEqual([toggled.base.unclassified[1]]);
    expect(moved.base.unclassified).toEqual([before.base.unclassified[0]]);
    expect(buildPrompt(moved.base, 'numeric')).toBe('b');
    const character = moved.characters[0]!;
    const action = { type: 'moveFromUnclassified', target: character.id, id: character.tags.unclassified[0]!.id } as const;
    expect(workspaceReducer(moved, { ...action, to: 'quality' })).toBe(moved);
    expect(workspaceReducer(moved, { ...action, to: 'pose', id: 'missing' })).toBe(moved);
    expect(workspaceReducer(moved, { ...action, to: 'pose' }).characters[0]?.tags.pose).toEqual(character.tags.unclassified);
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
});
