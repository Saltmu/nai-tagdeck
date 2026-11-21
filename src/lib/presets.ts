import type { WorkTag, Workspace } from '../types';
import { PROMPT_CATEGORY_KEYS } from './categories';
import { newId, normalizeId } from './id';
import { normalize } from './tagText';
import { hasNegative, normalizeWorkspace } from './workspace';

/** プリセットのタグ一式。ネガティブ対応前に保存したものは negative を持たない。 */
export type PresetWorkspace = Omit<Workspace, 'negative'> & Partial<Pick<Workspace, 'negative'>>;

/** 作業中のタグ一式（ベース＋キャラクター＋ネガティブ）に名前を付けて保存したもの。 */
export interface Preset {
  id: string;
  name: string;
  workspace: PresetWorkspace;
  updated_at: string;
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

export function normalizePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  return sortPresets(
    raw.flatMap((item): Preset[] => {
      if (!item || typeof item !== 'object') return [];
      const p = item as Record<string, unknown>;
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (!name) return [];
      return [
        {
          id: normalizeId(p.id),
          name,
          workspace: normalizePresetWorkspace(p.workspace),
          updated_at: typeof p.updated_at === 'string' ? p.updated_at : new Date().toISOString(),
        },
      ];
    }),
  );
}

/** 保存するときは複製して、編集中の状態と共有しないようにする。 */
function snapshot(workspace: Workspace): Workspace {
  return normalizeWorkspace(structuredClone(workspace));
}

export function createPreset(name: string, workspace: Workspace): Preset {
  return { id: newId(), name: name.trim(), workspace: snapshot(workspace), updated_at: new Date().toISOString() };
}

export function overwritePreset(presets: readonly Preset[], id: string, workspace: Workspace): Preset[] {
  return presets.map((p) =>
    p.id === id ? { ...p, workspace: snapshot(workspace), updated_at: new Date().toISOString() } : p,
  );
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
