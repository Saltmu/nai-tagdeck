import type { GeneratedCharacterDetail, GeneratedImage } from '../hooks/useImages';
import { modeLabel, samplerLabel } from './generation';
import { formatWeight, parseTagList } from './prompt';
import { normalize } from './tagText';

export interface MetaDiffRow {
  key: string;
  label: string;
  valueA: string;
  valueB: string;
  changed: boolean;
}

export interface TagDiffEntry {
  tag: string;
  weight: number;
}

export interface TagWeightChange {
  tag: string;
  weightA: number;
  weightB: number;
}

export interface PromptDiff {
  changed: TagWeightChange[];
  removed: TagDiffEntry[];
  added: TagDiffEntry[];
  same: TagDiffEntry[];
  hasChanges: boolean;
}

export interface CharacterDiff {
  index: number;
  presentA: boolean;
  presentB: boolean;
  prompt: PromptDiff;
  negative: PromptDiff;
  centerA?: { x: number; y: number };
  centerB?: { x: number; y: number };
  centerLabelA: string;
  centerLabelB: string;
  centerChanged: boolean;
  hasChanges: boolean;
}

export interface ImageComparisonDiff {
  meta: MetaDiffRow[];
  basePrompt: PromptDiff;
  negativePrompt: PromptDiff;
  hasNegativeData: boolean;
  characters: CharacterDiff[];
}

const MISSING = '—';

export function formatCenterCoord(center?: { x: number; y: number }): string {
  if (!center) return '自動';
  const x = Math.round(center.x * 100) / 100;
  const y = Math.round(center.y * 100) / 100;
  return `(${x}, ${y})`;
}

export function formatTagWithWeight(tag: string, weight: number): string {
  if (Math.abs(weight - 1) < 1e-9) return tag;
  return `${tag} (${formatWeight(weight)})`;
}

export function diffGenerationMeta(a: GeneratedImage, b: GeneratedImage): MetaDiffRow[] {
  const rows: Array<Omit<MetaDiffRow, 'changed'>> = [
    { key: 'seed', label: 'シード', valueA: String(a.seed), valueB: String(b.seed) },
    { key: 'size', label: 'サイズ', valueA: `${a.width}×${a.height}`, valueB: `${b.width}×${b.height}` },
    {
      key: 'mode',
      label: 'モード',
      valueA: a.params ? modeLabel(a.params.mode) : MISSING,
      valueB: b.params ? modeLabel(b.params.mode) : MISSING,
    },
    {
      key: 'steps',
      label: 'ステップ',
      valueA: a.params ? String(a.params.steps) : MISSING,
      valueB: b.params ? String(b.params.steps) : MISSING,
    },
    {
      key: 'scale',
      label: 'スケール',
      valueA: a.params ? String(a.params.scale) : MISSING,
      valueB: b.params ? String(b.params.scale) : MISSING,
    },
    {
      key: 'sampler',
      label: 'サンプラー',
      valueA: a.params ? samplerLabel(a.params.sampler) : MISSING,
      valueB: b.params ? samplerLabel(b.params.sampler) : MISSING,
    },
    {
      key: 'noiseSchedule',
      label: 'ノイズスケジュール',
      valueA: a.params ? a.params.noiseSchedule : MISSING,
      valueB: b.params ? b.params.noiseSchedule : MISSING,
    },
    {
      key: 'cfgRescale',
      label: 'CFG リスケール',
      valueA: a.params ? String(a.params.cfgRescale) : MISSING,
      valueB: b.params ? String(b.params.cfgRescale) : MISSING,
    },
    {
      key: 'dynamicThresholding',
      label: 'ダイナミックしきい値',
      valueA: a.params ? (a.params.dynamicThresholding ? 'オン' : 'オフ') : MISSING,
      valueB: b.params ? (b.params.dynamicThresholding ? 'オン' : 'オフ') : MISSING,
    },
  ];
  return rows.map((row) => ({ ...row, changed: row.valueA !== row.valueB }));
}

export function diffPromptText(textA: string, textB: string): PromptDiff {
  const tagsA = parseTagList(textA);
  const tagsB = parseTagList(textB);

  const bByKey = new Map<string, Array<{ index: number; tag: string; weight: number }>>();
  tagsB.forEach((item, index) => {
    const key = normalize(item.tag);
    if (!key) return;
    const list = bByKey.get(key);
    if (list) list.push({ index, tag: item.tag, weight: item.weight });
    else bByKey.set(key, [{ index, tag: item.tag, weight: item.weight }]);
  });

  const matchedBIndices = new Set<number>();
  const changed: TagWeightChange[] = [];
  const removed: TagDiffEntry[] = [];
  const same: TagDiffEntry[] = [];

  for (const itemA of tagsA) {
    const key = normalize(itemA.tag);
    if (!key) continue;
    const candidates = bByKey.get(key);
    const match = candidates?.shift();
    if (!match) {
      removed.push({ tag: itemA.tag, weight: itemA.weight });
      continue;
    }
    matchedBIndices.add(match.index);
    if (Math.abs(itemA.weight - match.weight) < 1e-9) {
      same.push({ tag: match.tag, weight: match.weight });
    } else {
      changed.push({ tag: match.tag, weightA: itemA.weight, weightB: match.weight });
    }
  }

  const added: TagDiffEntry[] = [];
  tagsB.forEach((itemB, index) => {
    if (matchedBIndices.has(index)) return;
    if (!normalize(itemB.tag)) return;
    added.push({ tag: itemB.tag, weight: itemB.weight });
  });

  return {
    changed,
    removed,
    added,
    same,
    hasChanges: changed.length > 0 || removed.length > 0 || added.length > 0,
  };
}

function getCharacterDetails(image: GeneratedImage): GeneratedCharacterDetail[] {
  if (image.characterDetails) return image.characterDetails;
  return image.characterPrompts.map((prompt) => ({ prompt, negative: '' }));
}

export function diffGeneratedImages(a: GeneratedImage, b: GeneratedImage): ImageComparisonDiff {
  const charsA = getCharacterDetails(a);
  const charsB = getCharacterDetails(b);
  const charCount = Math.max(charsA.length, charsB.length);
  const characters: CharacterDiff[] = [];

  for (let i = 0; i < charCount; i++) {
    const detailA = charsA[i];
    const detailB = charsB[i];
    const presentA = detailA !== undefined;
    const presentB = detailB !== undefined;
    const prompt = diffPromptText(detailA?.prompt ?? '', detailB?.prompt ?? '');
    const negative = diffPromptText(detailA?.negative ?? '', detailB?.negative ?? '');
    const centerLabelA = presentA ? formatCenterCoord(detailA.center) : MISSING;
    const centerLabelB = presentB ? formatCenterCoord(detailB.center) : MISSING;
    const centerChanged = centerLabelA !== centerLabelB;
    characters.push({
      index: i,
      presentA,
      presentB,
      prompt,
      negative,
      centerA: detailA?.center,
      centerB: detailB?.center,
      centerLabelA,
      centerLabelB,
      centerChanged,
      hasChanges: presentA !== presentB || prompt.hasChanges || negative.hasChanges || centerChanged,
    });
  }

  return {
    meta: diffGenerationMeta(a, b),
    basePrompt: diffPromptText(a.prompt, b.prompt),
    negativePrompt: diffPromptText(a.negativePrompt ?? '', b.negativePrompt ?? ''),
    hasNegativeData: a.negativePrompt !== undefined || b.negativePrompt !== undefined,
    characters,
  };
}
