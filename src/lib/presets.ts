import type { Workspace } from '../types';
import { PROMPT_CATEGORY_KEYS } from './categories';
import { newId } from './id';
import { normalize } from './suggest';
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
          id: typeof p.id === 'string' && p.id ? p.id : newId(),
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

/**
 * ON/OFF・重み・並び順まで含めて同じか。タグの id は比べない。
 * ネガティブはどちらも持っているときだけ比べる（古いプリセットは読み込んでもネガティブを変えないため）。
 */
export function sameWorkspace(a: PresetWorkspace, b: PresetWorkspace): boolean {
  const list = (tags: Workspace['negative']) => tags.map((t) => [t.tag, t.enabled, t.weight]);
  const compareNegative = a.negative !== undefined && b.negative !== undefined;
  const strip = (ws: PresetWorkspace) => {
    const groups = (g: Workspace['base']) => PROMPT_CATEGORY_KEYS.map((k) => list(g[k] ?? []));
    return JSON.stringify([
      groups(ws.base),
      ws.characters.map((c) => [c.name, c.enabled, groups(c.tags)]),
      compareNegative ? list(ws.negative!) : null,
    ]);
  };
  return strip(a) === strip(b);
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
