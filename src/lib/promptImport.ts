import type { GeneratedImage } from '../hooks/useImages';
import type { DictEntry, PromptCategoryKey, TagGroups, WorkTag } from '../types';
import { CHARACTER_CATEGORY_KEYS, PROMPT_CATEGORY_KEYS } from './categories';
import { MAX_CHARACTERS, MAX_ENABLED_CHARACTERS } from './characterLimits';
import {
  NOISE_SCHEDULES, SAMPLERS, SCALE_MAX, SCALE_MIN, SIZE_PRESETS, isValidFreeSize, normalizeCfgRescale, normalizeScale, normalizeSeed, normalizeSteps,
  type GenerationSettings,
} from './generation';
import { newId } from './id';
import type { GenerationMode } from './novelai';
import { readPngMetadata } from './pngMetadata';
import { parseTagList } from './prompt';
import type { PromptImport, PromptImportGeneration } from './promptImportShared';
import { normalize } from './tagText';
import { classifyTag, dictionaryCategories } from './tagClassification';
import { emptyGroups, newCharacter, normalizeCenter } from './workspace';

export { importedBaseForMode, type PromptImport, type PromptImportGeneration } from './promptImportShared';

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : undefined;
}

function getCaptionList(value: unknown): Array<{ text: string; centers: unknown }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = [];
  for (const item of value) {
    const caption = fields(item);
    if (typeof caption?.char_caption !== 'string') return undefined;
    result.push({ text: caption.char_caption, centers: caption.centers });
  }
  return result;
}

function readCenter(centers: unknown): { x: number; y: number } | undefined {
  return Array.isArray(centers) ? normalizeCenter(centers[0]) : undefined;
}

const FUR_DATASET_PREFIX = /^\s*(fur[\s_]+dataset)(?:\s*[,\n]+\s*|\s*$)/i;

function generationFrom(comment: Fields, isFurry: boolean, explicitMode?: GenerationMode): PromptImportGeneration {
  const values: Partial<GenerationSettings> = {};
  const labels: string[] = [];
  const skipped: string[] = [];
  const add = <K extends keyof GenerationSettings>(
    key: K, label: string, value: GenerationSettings[K] | undefined, formatted?: string,
  ) => {
    if (value === undefined) skipped.push(label);
    else {
      values[key] = value;
      labels.push(`${label} ${formatted ?? value}`);
    }
  };
  if (explicitMode !== undefined) {
    add('mode', '生成モード', explicitMode, explicitMode === 'furry' ? 'ケモノ' : 'アニメ');
  } else if (isFurry) {
    add('mode', '生成モード', 'furry', 'ケモノ');
  }
  const size = SIZE_PRESETS.find((s) => s.width === comment.width && s.height === comment.height);
  const customSize = !size && isValidFreeSize(comment.width, comment.height)
    ? { width: comment.width as number, height: comment.height as number }
    : undefined;
  const seed = normalizeSeed(comment.seed);
  const steps = normalizeSteps(comment.steps);
  const scale = typeof comment.scale === 'number' && Number.isFinite(comment.scale) &&
    comment.scale >= SCALE_MIN && comment.scale <= SCALE_MAX
    ? normalizeScale(comment.scale)
    : undefined;
  const sampler = SAMPLERS.find((s) => s.value === comment.sampler);
  const schedule = NOISE_SCHEDULES.find((s) => s === comment.noise_schedule);
  add('seed', 'シード', seed !== null && seed === comment.seed ? seed : undefined);
  if (customSize) {
    values.customWidth = customSize.width;
    values.customHeight = customSize.height;
    add('size', 'サイズ', 'custom', `カスタム ${customSize.width}×${customSize.height}`);
  } else {
    add('size', 'サイズ', size?.key, size?.label);
  }
  add('steps', 'ステップ', steps === comment.steps ? steps : undefined);
  add('scale', 'ガイダンス', scale);
  add('sampler', 'サンプラー', sampler?.value, sampler?.label);
  add('noiseSchedule', 'ノイズスケジュール', schedule);
  if (typeof comment.cfg_rescale === 'number' && Number.isFinite(comment.cfg_rescale)) {
    add('cfgRescale', 'CFGリスケール', normalizeCfgRescale(comment.cfg_rescale));
  }
  if (typeof comment.dynamic_thresholding === 'boolean') {
    add('dynamicThresholding', 'ダイナミックしきい値', comment.dynamic_thresholding, comment.dynamic_thresholding ? 'オン' : 'オフ');
  }
  return { values, labels, skipped };
}

interface AssembleCharacter {
  text: string;
  center?: { x: number; y: number };
}

interface AssembleInput {
  baseText: string;
  positiveCharacters: AssembleCharacter[];
  negativeText: string | undefined;
  negativeCharacters?: AssembleCharacter[];
  /** PNG の v4_negative_prompt の char_captions（生の JSON 項目）。per-item ノート用。 */
  rawNegativeCharacters?: readonly unknown[];
  useCoordinates: boolean;
  generationFields: Fields;
  explicitMode?: GenerationMode;
  model?: string;
  extraNotes?: readonly string[];
}

/**
 * PNG 経路と履歴フォールバック経路の共通組立。タグ展開・重み調整ノート・
 * 重複排除・カテゴリ分類・キャラ数上限・ON/OFF 振り分け・キャラ用ネガティブの
 * 共通/個別判定・座標反映・生成設定の変換をここに集約する。
 */
function assemblePromptImport(input: AssembleInput, entries: readonly DictEntry[]): PromptImport {
  const {
    baseText, positiveCharacters, negativeCharacters, rawNegativeCharacters,
    useCoordinates, generationFields, explicitMode, model, extraNotes,
  } = input;
  if (positiveCharacters.length > MAX_CHARACTERS) {
    throw new Error(`画像のキャラクター数が保存上限（${MAX_CHARACTERS}人）を超えています`);
  }
  const furDataset = baseText.match(FUR_DATASET_PREFIX)?.[1];
  const isFurry = furDataset !== undefined || explicitMode === 'furry';
  const normalizedBaseText = furDataset ? baseText.replace(FUR_DATASET_PREFIX, '') : baseText;
  const notes: string[] = [...(extraNotes ?? [])];
  const byTag = dictionaryCategories(entries);
  const readTags = (text: string, scope: string, initialSeen?: readonly string[]): WorkTag[] => {
    const seen = new Set<string>(initialSeen);
    const tags: WorkTag[] = [];
    for (const { tag, weight } of parseTagList(
      text,
      (t, w, adjusted) => notes.push(`${scope}「${t}」の重みを ${w} から ${adjusted} に調整します。`),
    )) {
      const key = normalize(tag);
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push({ id: newId(), enabled: true, tag, weight });
    }
    return tags;
  };
  const group = (tags: WorkTag[], allowed: readonly PromptCategoryKey[]): TagGroups => {
    const groups = emptyGroups();
    for (const tag of tags) {
      groups[classifyTag(tag.tag, byTag, allowed)].push(tag);
    }
    return groups;
  };
  const baseTags = readTags(normalizedBaseText, 'ベース', furDataset ? [normalize(furDataset)] : undefined);
  const characterTags = positiveCharacters.map(({ text }, i) => readTags(text, `キャラ${i + 1}`));
  if (baseTags.length === 0 && characterTags.every((tags) => tags.length === 0)) {
    if (!furDataset) throw new Error('適用できる正のプロンプトがありません');
    baseTags.push({ id: newId(), enabled: true, tag: furDataset, weight: 1 });
  }
  const base = group(baseTags, PROMPT_CATEGORY_KEYS);
  const characters = characterTags.map((tags, i) => ({
    ...newCharacter(i), enabled: i < MAX_ENABLED_CHARACTERS, tags: group(tags, CHARACTER_CATEGORY_KEYS),
  }));

  const negative = typeof input.negativeText === 'string' ? readTags(input.negativeText, '全体ネガティブ') : undefined;
  if (!negative) notes.push('全体ネガティブを読み取れないため、現在の値を使います。');
  const negativeChars = negativeCharacters;
  const shared = negativeChars?.[0]?.text;
  const sameCenter = (a?: { x: number; y: number }, b?: { x: number; y: number }) =>
    !useCoordinates || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y);
  let characterNegative: string | undefined;
  if (shared !== undefined && negativeChars?.length === positiveCharacters.length &&
      negativeChars.every((item, i) => item.text === shared && sameCenter(item.center, positiveCharacters[i]?.center))) {
    characterNegative = shared;
  } else if (characters.length > 0 || (rawNegativeCharacters !== undefined && rawNegativeCharacters.length > 0)) {
    const stored = negativeChars !== undefined && negativeChars.length === characters.length && characters.length > 0;
    if (stored) {
      characters.forEach((character, i) => {
        character.negative = negativeChars[i]!.text;
      });
    }
    const textsDiffer = stored && negativeChars.some((item) => item.text !== negativeChars[0]?.text);
    notes.push(!stored
      ? '画像のキャラ用ネガティブを共通欄に反映できないため、現在の値を使います。'
      : textsDiffer
        ? 'キャラ用ネガティブがキャラごとに違うため、各キャラの個別欄に入れました。'
        : 'キャラ用ネガティブの位置が正のプロンプトと違うため、各キャラの個別欄に入れました。');
    if (rawNegativeCharacters !== undefined) {
      rawNegativeCharacters.forEach((item, i) => {
        const text = fields(item)?.char_caption;
        notes.push(`キャラ用ネガティブ ${i + 1}　${typeof text === 'string' ? text || '（空欄）' : '（読み取り不可）'}`);
      });
    } else if (negativeChars !== undefined) {
      negativeChars.forEach((item, i) => {
        notes.push(`キャラ用ネガティブ ${i + 1}　${item.text || '（空欄）'}`);
      });
    }
  }
  if (model) notes.push(`画像のモデルは ${model} です。生成時はこのアプリのモデルを使います。`);
  if (useCoordinates) {
    const missed: string[] = [];
    characters.forEach((character, i) => {
      const center = positiveCharacters[i]?.center ? normalizeCenter(positiveCharacters[i].center) : undefined;
      if (center) character.center = center;
      else missed.push(character.name);
    });
    if (characters.length === 0 || missed.length === characters.length) {
      notes.push('画像に記録されたキャラクターの座標は反映できません。');
    } else if (missed.length > 0) {
      notes.push(`${missed.join('、')} の座標は読み取れませんでした。再生成では中央（0.5, 0.5）になります。`);
    }
  }
  if (explicitMode === undefined && !isFurry) notes.push('生成モード（アニメ／ケモノ）は現在の設定を使います。');

  return { base, furDataset, characters, negative, characterNegative, generation: generationFrom(generationFields, isFurry, explicitMode), notes };
}

export async function readPromptImport(blob: Blob, entries: readonly DictEntry[]): Promise<PromptImport> {
  const metadata = await readPngMetadata(blob);
  if (metadata.Comment === undefined) {
    throw new Error('PNG に NovelAI の生成情報が見つかりませんでした');
  }
  let comment: Fields | undefined;
  try {
    comment = fields(JSON.parse(metadata.Comment));
  } catch {
    throw new Error('PNG の生成情報を JSON として読み取れませんでした');
  }
  if (!comment) throw new Error('PNG の生成情報の形式を解釈できませんでした');

  const origin = [metadata.Software?.trim(), metadata.Source?.trim()]
    .filter((text): text is string => !!text);
  const isNovelAI = origin.some((text) => /^NovelAI\b/i.test(text));
  const hasNovelAIFields = typeof comment.signed_hash === 'string' &&
    typeof comment.model_name === 'string' && /^NovelAI Diffusion\b/.test(comment.model_name) &&
    typeof comment.model_hash === 'string';
  if (!isNovelAI && !(origin.length === 0 && hasNovelAIFields)) {
    throw new Error('NovelAI の生成情報を確認できませんでした');
  }

  const positive = fields(comment.v4_prompt);
  const caption = fields(positive?.caption);
  const readBase = caption?.base_caption !== undefined ? caption.base_caption : comment.prompt;
  const baseText = readBase === undefined ? '' : readBase;
  const rawPositiveChars = caption?.char_captions;
  const positiveChars = rawPositiveChars === undefined ? [] : getCaptionList(rawPositiveChars);
  if ((comment.v4_prompt !== undefined && !caption) || typeof baseText !== 'string' || !positiveChars) {
    throw new Error('正のプロンプトの形式を解釈できませんでした');
  }
  const negativePrompt = fields(comment.v4_negative_prompt);
  const negativeCaption = fields(negativePrompt?.caption);
  const negativeText = negativeCaption?.base_caption !== undefined ? negativeCaption.base_caption : comment.uc;
  const rawNegativeChars = negativeCaption?.char_captions;
  const negativeChars = getCaptionList(rawNegativeChars);
  const useCoordinates = positive?.use_coords === true || negativePrompt?.use_coords === true;
  const model = typeof comment.model_name === 'string' ? comment.model_name : metadata.Source;

  return assemblePromptImport({
    baseText,
    positiveCharacters: positiveChars.map(({ text, centers }) => ({ text, center: readCenter(centers) })),
    negativeText: typeof negativeText === 'string' ? negativeText : undefined,
    negativeCharacters: negativeChars?.map(({ text, centers }) => ({ text, center: readCenter(centers) })),
    rawNegativeCharacters: Array.isArray(rawNegativeChars) ? rawNegativeChars : undefined,
    useCoordinates,
    generationFields: comment,
    model,
  }, entries);
}

/**
 * アプリ内履歴に保持している送信情報から PromptImport を組み立てる。
 * PNG メタデータが読めない履歴画像（WebP 化・メタデータ欠落など）のフォールバック用。
 */
export function promptImportFromGeneratedImage(image: GeneratedImage, entries: readonly DictEntry[]): PromptImport {
  const details = image.characterDetails;
  const positiveCharacters = details !== undefined
    ? details.map((detail) => ({ text: detail.prompt, center: detail.center }))
    : image.characterPrompts.map((text) => ({ text }));
  const negativeCharacters = details?.map((detail) => ({ text: detail.negative, center: detail.center }));
  const useCoordinates = details?.some((detail) => detail.center !== undefined) ?? false;
  const params = image.params;
  const generationFields: Fields = {
    seed: image.seed,
    width: image.width,
    height: image.height,
    ...(params === undefined ? {} : {
      steps: params.steps,
      scale: params.scale,
      sampler: params.sampler,
      noise_schedule: params.noiseSchedule,
      cfg_rescale: params.cfgRescale,
      dynamic_thresholding: params.dynamicThresholding,
    }),
  };
  return assemblePromptImport({
    baseText: image.prompt,
    positiveCharacters,
    negativeText: image.negativePrompt,
    negativeCharacters,
    useCoordinates,
    generationFields,
    explicitMode: params?.mode,
    extraNotes: ['画像から生成情報を読み取れなかったため、履歴に保持していた送信情報から読み込みました。'],
  }, entries);
}

/**
 * まず PNG 埋め込みメタデータを優先して読み、失敗したときだけ履歴の
 * 保持情報をフォールバックに使う。フォールバックが無い外部 PNG では
 * 従来どおり PNG 読取のエラーをそのまま返す。
 */
export async function readPromptImportWithFallback(
  source: { blob: Blob; fallbackImage?: GeneratedImage },
  entries: readonly DictEntry[],
): Promise<PromptImport> {
  try {
    return await readPromptImport(source.blob, entries);
  } catch (error) {
    if (!source.fallbackImage) throw error;
    return promptImportFromGeneratedImage(source.fallbackImage, entries);
  }
}
