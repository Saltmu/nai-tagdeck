import type { Workspace } from '../types';
import { CATEGORY_KEYS } from './categories';
import { newId } from './id';
import { normalizeWorkspace } from './workspace';

/** 作業中のタグ一式（ベース＋キャラクター）に名前を付けて保存したもの。 */
export interface Preset {
  id: string;
  name: string;
  workspace: Workspace;
  updated_at: string;
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
          workspace: normalizeWorkspace(p.workspace),
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

/** ON/OFF・重み・並び順まで含めて同じか。タグの id は比べない。 */
export function sameWorkspace(a: Workspace, b: Workspace): boolean {
  const strip = (ws: Workspace) => {
    const groups = (g: Workspace['base']) =>
      CATEGORY_KEYS.map((k) => g[k].map((t) => [t.tag, t.enabled, t.weight]));
    return JSON.stringify([
      groups(ws.base),
      ws.characters.map((c) => [c.name, c.enabled, groups(c.tags)]),
    ]);
  };
  return strip(a) === strip(b);
}

export function isEmptyWorkspace(ws: Workspace): boolean {
  return ws.characters.length === 0 && CATEGORY_KEYS.every((k) => ws.base[k].length === 0);
}
