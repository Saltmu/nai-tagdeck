import { describe, expect, it } from 'vitest';
import type { GeneratedImage } from '../src/hooks/useImages';
import { diffGeneratedImages, diffGenerationMeta, diffPromptText } from '../src/lib/imageCompare';

function makeImage(extra: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: 'img-1',
    url: 'blob:1',
    blob: new Blob([], { type: 'image/png' }),
    seed: 100,
    width: 832,
    height: 1216,
    prompt: '1girl, solo, smile',
    characterPrompts: [],
    createdAt: 1_700_000_000_000,
    downloaded: false,
    pinned: false,
    ...extra,
  };
}

describe('diffGenerationMeta', () => {
  it('detects changed and unchanged metadata fields', () => {
    const a = makeImage({
      seed: 100,
      width: 832,
      height: 1216,
      params: {
        mode: 'anime',
        steps: 28,
        scale: 5,
        sampler: 'k_euler_ancestral',
        noiseSchedule: 'karras',
        cfgRescale: 0,
        dynamicThresholding: false,
      },
    });
    const b = makeImage({
      seed: 200,
      width: 832,
      height: 1216,
      params: {
        mode: 'furry',
        steps: 28,
        scale: 6.5,
        sampler: 'k_euler_ancestral',
        noiseSchedule: 'exponential',
        cfgRescale: 0.2,
        dynamicThresholding: true,
      },
    });

    const rows = diffGenerationMeta(a, b);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.seed?.changed).toBe(true);
    expect(byKey.size?.changed).toBe(false);
    expect(byKey.mode?.changed).toBe(true);
    expect(byKey.steps?.changed).toBe(false);
    expect(byKey.scale?.changed).toBe(true);
    expect(byKey.sampler?.changed).toBe(false);
    expect(byKey.noiseSchedule?.changed).toBe(true);
    expect(byKey.cfgRescale?.changed).toBe(true);
    expect(byKey.dynamicThresholding?.valueA).toBe('オフ');
    expect(byKey.dynamicThresholding?.valueB).toBe('オン');
    expect(byKey.dynamicThresholding?.changed).toBe(true);
  });

  it('falls back to em-dash when params are missing on legacy history items', () => {
    const a = makeImage({ seed: 10 });
    const b = makeImage({ seed: 10 });
    const rows = diffGenerationMeta(a, b);
    const steps = rows.find((r) => r.key === 'steps');
    expect(steps).toEqual({
      key: 'steps',
      label: 'ステップ',
      valueA: '—',
      valueB: '—',
      changed: false,
    });
  });
});

describe('diffPromptText', () => {
  it('classifies added, removed, weight-changed, and same tags with normalization', () => {
    const diff = diffPromptText(
      '1girl, blue_eyes, smile, hat',
      '1girl, Blue Eyes, 1.2::smile::, ribbon',
    );
    expect(diff.hasChanges).toBe(true);
    expect(diff.same.map((t) => t.tag)).toEqual(['1girl', 'Blue Eyes']);
    expect(diff.changed).toEqual([{ tag: 'smile', weightA: 1, weightB: 1.2 }]);
    expect(diff.removed).toEqual([{ tag: 'hat', weight: 1 }]);
    expect(diff.added).toEqual([{ tag: 'ribbon', weight: 1 }]);
  });

  it('reports no changes when prompts are equivalent', () => {
    const diff = diffPromptText('1girl, {smile}', '1girl, 1.05::smile::');
    expect(diff.hasChanges).toBe(false);
    expect(diff.same).toHaveLength(2);
  });
});

describe('diffGeneratedImages', () => {
  it('diffs base prompt, global negative, character prompts, and coordinates', () => {
    const a = makeImage({
      prompt: '1girl, outdoor',
      negativePrompt: 'lowres, bad anatomy',
      characterDetails: [
        { prompt: 'wolf, smile', negative: 'hat', center: { x: 0.2, y: 0.5 } },
      ],
    });
    const b = makeImage({
      prompt: '1girl, indoor',
      negativePrompt: 'lowres, blurry',
      characterDetails: [
        { prompt: 'wolf, 1.3::smile::', negative: 'hat', center: { x: 0.8, y: 0.5 } },
        { prompt: 'cat', negative: '' },
      ],
    });

    const result = diffGeneratedImages(a, b);
    expect(result.basePrompt.removed.map((t) => t.tag)).toEqual(['outdoor']);
    expect(result.basePrompt.added.map((t) => t.tag)).toEqual(['indoor']);
    expect(result.hasNegativeData).toBe(true);
    expect(result.negativePrompt.removed.map((t) => t.tag)).toEqual(['bad anatomy']);
    expect(result.negativePrompt.added.map((t) => t.tag)).toEqual(['blurry']);
    expect(result.characters).toHaveLength(2);
    expect(result.characters[0]?.centerChanged).toBe(true);
    expect(result.characters[0]?.centerLabelA).toBe('(0.2, 0.5)');
    expect(result.characters[0]?.centerLabelB).toBe('(0.8, 0.5)');
    expect(result.characters[0]?.prompt.changed).toEqual([{ tag: 'smile', weightA: 1, weightB: 1.3 }]);
    expect(result.characters[1]?.presentA).toBe(false);
    expect(result.characters[1]?.presentB).toBe(true);
    expect(result.characters[1]?.prompt.added.map((t) => t.tag)).toEqual(['cat']);
  });

  it('falls back to characterPrompts when characterDetails is absent', () => {
    const a = makeImage({ characterPrompts: ['fox'] });
    const b = makeImage({ characterPrompts: ['fox, tail'] });
    const result = diffGeneratedImages(a, b);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0]?.prompt.added.map((t) => t.tag)).toEqual(['tail']);
    expect(result.characters[0]?.centerLabelA).toBe('自動');
    expect(result.characters[0]?.centerChanged).toBe(false);
  });
});
