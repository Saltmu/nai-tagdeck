import type { WorkTag, Workspace } from '../types';
import { PROMPT_CATEGORY_KEYS } from './categories';
import {
  modeLabel,
  normalizeGeneration,
  samplerLabel,
  SIZE_PRESETS,
  type GenerationSettings,
} from './generation';
import { newId, normalizeId } from './id';
import { normalize } from './tagText';
import { hasNegative, normalizeWorkspace } from './workspace';

/** プリセットのタグ一式。ネガティブ対応前に保存したものは negative を持たない。 */
export type PresetWorkspace = Omit<Workspace, 'negative'> & Partial<Pick<Workspace, 'negative'>>;

/** プリセットに任意で保存する生成設定。シードは含めない。 */
export type PresetGeneration = Omit<GenerationSettings, 'seed'>;

/** 作業中のタグ一式（ベース＋キャラクター＋ネガティブ）に名前を付けて保存したもの。 */
export interface Preset {
  id: string;
  name: string;
  workspace: PresetWorkspace;
  /** 生成設定も含めて保存した場合のみ。未設定なら読み込み時に作業中の生成設定を残す。 */
  generation?: PresetGeneration;
  /** 共通のキャラ用ネガティブも含めて保存した場合のみ。未設定なら作業中の値を残す。 */
  characterNegativePrompt?: string;
  updated_at: string;
}

/** 新規保存や、生成設定付きプリセットの上書きで書き込む値。シードは保存時に除く。 */
export interface PresetGenerationSave {
  generation: GenerationSettings;
  characterNegativePrompt: string;
}

/** ネガティブを持たない古いプリセットは、読み込み時に作業中のネガティブを残すため negative を省いたままにする。 */
function normalizePresetWorkspace(raw: unknown): PresetWorkspace {
  const workspace: PresetWorkspace = normalizeWorkspace(raw);
  if (!hasNegative(raw)) delete workspace.negative;
  return workspace;
}

/** プリセットを読み込んだ作業状態。ネガティブを持たないプリセットでは current のネガティブを残す。 */
export function presetToWorkspace(preset: PresetWorkspace, current: Workspace): Workspace {
  return normalizeWorkspace(structuredClone(preset), current.negative);
}

export function sortPresets(presets: readonly Preset[]): Preset[] {
  return [...presets].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/** オブジェクト以外は保存しない。オブジェクトなら生成設定として補正し、シードは除く。 */
function normalizePresetGeneration(raw: unknown): PresetGeneration | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return presetGenerationOf(normalizeGeneration(raw));
}

export function normalizePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  return sortPresets(
    raw.flatMap((item): Preset[] => {
      if (!item || typeof item !== 'object') return [];
      const p = item as Record<string, unknown>;
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (!name) return [];
      const preset: Preset = {
        id: normalizeId(p.id),
        name,
        workspace: normalizePresetWorkspace(p.workspace),
        updated_at: typeof p.updated_at === 'string' ? p.updated_at : new Date().toISOString(),
      };
      const generation = normalizePresetGeneration(p.generation);
      if (generation) preset.generation = generation;
      if (typeof p.characterNegativePrompt === 'string') {
        preset.characterNegativePrompt = p.characterNegativePrompt;
      }
      return [preset];
    }),
  );
}

/** 保存用にシードを除いた生成設定。 */
export function presetGenerationOf(generation: GenerationSettings): PresetGeneration {
  const normalized = normalizeGeneration(generation);
  return {
    mode: normalized.mode,
    size: normalized.size,
    steps: normalized.steps,
    scale: normalized.scale,
    sampler: normalized.sampler,
    noiseSchedule: normalized.noiseSchedule,
    cfgRescale: normalized.cfgRescale,
    dynamicThresholding: normalized.dynamicThresholding,
  };
}

/** 保存ダイアログに出す、シードを含まない生成設定の要約。 */
export function presetGenerationSummary(generation: PresetGeneration): string {
  const size = SIZE_PRESETS.find((preset) => preset.key === generation.size)?.label ?? generation.size;
  return [
    modeLabel(generation.mode),
    size,
    `${generation.steps} steps`,
    `スケール ${generation.scale}`,
    samplerLabel(generation.sampler),
  ].join(' · ');
}

/** 保存するときは複製して、編集中の状態と共有しないようにする。 */
function snapshot(workspace: Workspace): Workspace {
  return normalizeWorkspace(structuredClone(workspace));
}

function withGenerationSave(preset: Preset, save: PresetGenerationSave | null | undefined): Preset {
  if (save === undefined) return preset;
  if (save === null) {
    delete preset.generation;
    delete preset.characterNegativePrompt;
    return preset;
  }
  preset.generation = presetGenerationOf(save.generation);
  preset.characterNegativePrompt = save.characterNegativePrompt;
  return preset;
}

export function createPreset(name: string, workspace: Workspace, save?: PresetGenerationSave): Preset {
  return withGenerationSave(
    { id: newId(), name: name.trim(), workspace: snapshot(workspace), updated_at: new Date().toISOString() },
    save,
  );
}

/**
 * タグを上書きする。
 * save を渡すと生成設定と共通キャラネガティブも書き換える。
 * null ならその2つを外す。省略すると、もともと付いていた生成設定は変えない。
 */
export function overwritePreset(
  presets: readonly Preset[],
  id: string,
  workspace: Workspace,
  save?: PresetGenerationSave | null,
): Preset[] {
  return presets.map((p) =>
    p.id === id
      ? withGenerationSave(
          { ...p, workspace: snapshot(workspace), updated_at: new Date().toISOString() },
          save,
        )
      : p,
  );
}

/** 変更の上書きで使う。生成設定を持たないプリセットはタグだけ更新する。 */
export function generationSaveForOverwrite(
  preset: Pick<Preset, 'generation'>,
  current: { generation: GenerationSettings; characterNegativePrompt: string },
): PresetGenerationSave | undefined {
  if (preset.generation === undefined) return undefined;
  return {
    generation: current.generation,
    characterNegativePrompt: current.characterNegativePrompt,
  };
}

export function renamePreset(presets: readonly Preset[], id: string, name: string): Preset[] {
  const trimmed = name.trim();
  if (!trimmed) return [...presets];
  return sortPresets(presets.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
}

/** 同じ id は取り込む側で上書きし、それ以外は追加する。 */
export function mergePresets(existing: readonly Preset[], incoming: readonly Preset[]): Preset[] {
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const p of incoming) byId.set(p.id, p);
  return sortPresets([...byId.values()]);
}

/** 並び・ON/OFF・重みまで同じか。id は比べない。 */
export function sameWorkTags(a: readonly WorkTag[] | undefined, b: readonly WorkTag[] | undefined): boolean {
  return sameTagList(a, b);
}

function sameTagList(a: readonly WorkTag[] | undefined, b: readonly WorkTag[] | undefined): boolean {
  const lenA = a?.length ?? 0;
  const lenB = b?.length ?? 0;
  if (lenA !== lenB) return false;
  if (a === b) return true;
  for (let i = 0; i < lenA; i++) {
    const ta = a![i]!;
    const tb = b![i]!;
    if (ta === tb) continue;
    if (ta.tag !== tb.tag || ta.enabled !== tb.enabled || ta.weight !== tb.weight) return false;
  }
  return true;
}

function sameTagGroups(a: Workspace['base'], b: Workspace['base']): boolean {
  if (a === b) return true;
  for (const key of PROMPT_CATEGORY_KEYS) {
    if (!sameTagList(a[key], b[key])) return false;
  }
  return true;
}

/**
 * ON/OFF・重み・並び順まで含めて同じか。タグの id は比べない。
 * ネガティブはどちらも持っているときだけ比べる（古いプリセットは読み込んでもネガティブを変えないため）。
 */
export function sameWorkspace(a: PresetWorkspace, b: PresetWorkspace): boolean {
  if (a === b) return true;
  if (a.characters.length !== b.characters.length) return false;
  if (!sameTagGroups(a.base, b.base)) return false;
  for (let i = 0; i < a.characters.length; i++) {
    const ca = a.characters[i]!;
    const cb = b.characters[i]!;
    if (ca === cb) continue;
    if (
      ca.name !== cb.name ||
      ca.enabled !== cb.enabled ||
      ca.negative !== cb.negative ||
      ca.center?.x !== cb.center?.x ||
      ca.center?.y !== cb.center?.y ||
      !sameTagGroups(ca.tags, cb.tags)
    ) {
      return false;
    }
  }
  if (a.negative !== undefined && b.negative !== undefined && !sameTagList(a.negative, b.negative)) {
    return false;
  }
  return true;
}

function samePresetGeneration(preset: PresetGeneration, current: GenerationSettings): boolean {
  for (const key of Object.keys(preset) as (keyof PresetGeneration)[]) {
    if (!Object.is(preset[key], current[key])) return false;
  }
  return true;
}

/**
 * 読み込み中のプリセットと作業中の値が同じか。
 * 生成設定と共通キャラネガティブは、プリセットが持っているときだけ比べる。シードは比べない。
 */
export function samePreset(
  preset: Pick<Preset, 'workspace' | 'generation' | 'characterNegativePrompt'>,
  current: { workspace: PresetWorkspace; generation: GenerationSettings; characterNegativePrompt: string },
): boolean {
  if (!sameWorkspace(preset.workspace, current.workspace)) return false;
  if (preset.generation !== undefined && !samePresetGeneration(preset.generation, current.generation)) return false;
  if (
    preset.characterNegativePrompt !== undefined &&
    preset.characterNegativePrompt !== current.characterNegativePrompt
  ) {
    return false;
  }
  return true;
}

/** 読み込みで変える生成設定と共通キャラネガティブ。変わらない項目とシードは含めない。 */
export function presetLoadExtras(
  preset: Pick<Preset, 'generation' | 'characterNegativePrompt'>,
  current: { generation: GenerationSettings; characterNegativePrompt: string },
): { characterNegativePrompt?: string; generation?: Partial<GenerationSettings> } | undefined {
  const extras: { characterNegativePrompt?: string; generation?: Partial<GenerationSettings> } = {};
  if (preset.generation) {
    const generation: Partial<GenerationSettings> = {};
    for (const key of Object.keys(preset.generation) as (keyof PresetGeneration)[]) {
      const value = preset.generation[key];
      if (!Object.is(value, current.generation[key])) generation[key] = value as never;
    }
    if (Object.keys(generation).length > 0) extras.generation = generation;
  }
  if (
    preset.characterNegativePrompt !== undefined &&
    preset.characterNegativePrompt !== current.characterNegativePrompt
  ) {
    extras.characterNegativePrompt = preset.characterNegativePrompt;
  }
  if (extras.generation === undefined && extras.characterNegativePrompt === undefined) return undefined;
  return extras;
}

/** ベースとキャラクターが空か。ネガティブは既定値が入っているので見ない。 */
export function isEmptyWorkspace(ws: PresetWorkspace): boolean {
  return ws.characters.length === 0 && PROMPT_CATEGORY_KEYS.every((k) => !ws.base[k]?.length);
}

/** 名前の部分一致で絞り込む（全角/半角・大小文字・カタカナ/ひらがなの違いは無視）。空なら全件。 */
export function filterPresets(presets: readonly Preset[], query: string): Preset[] {
  const q = normalize(query);
  if (!q) return [...presets];
  return presets.filter((p) => normalize(p.name).includes(q));
}
