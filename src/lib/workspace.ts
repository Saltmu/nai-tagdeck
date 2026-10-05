import type { CategoryKey, WorkTag, Workspace } from '../types';
import { CATEGORY_KEYS } from './categories';
import { newId } from './id';
import { clampWeight } from './prompt';
import { normalize } from './suggest';

export type WorkspaceAction =
  | { type: 'add'; category: CategoryKey; tag: string; weight?: number }
  | { type: 'toggle'; category: CategoryKey; id: string }
  | { type: 'setWeight'; category: CategoryKey; id: string; weight: number }
  | { type: 'remove'; category: CategoryKey; id: string }
  | { type: 'move'; category: CategoryKey; id: string; delta: -1 | 1 }
  | { type: 'setAll'; category: CategoryKey; enabled: boolean }
  | { type: 'replace'; workspace: Workspace };

export function emptyWorkspace(): Workspace {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, []])) as unknown as Workspace;
}

/** 保存データを読み込むとき、壊れた値や未知のカテゴリを捨てる。 */
export function normalizeWorkspace(raw: unknown): Workspace {
  const ws = emptyWorkspace();
  if (!raw || typeof raw !== 'object') return ws;
  const obj = raw as Record<string, unknown>;
  for (const key of CATEGORY_KEYS) {
    const list = obj[key];
    if (!Array.isArray(list)) continue;
    ws[key] = list.flatMap((item): WorkTag[] => {
      if (!item || typeof item !== 'object') return [];
      const t = item as Record<string, unknown>;
      if (typeof t.tag !== 'string' || !t.tag.trim()) return [];
      return [
        {
          id: typeof t.id === 'string' ? t.id : newId(),
          tag: t.tag.trim(),
          enabled: t.enabled !== false,
          weight: clampWeight(typeof t.weight === 'number' ? t.weight : 1),
        },
      ];
    });
  }
  return ws;
}

function updateCategory(
  state: Workspace,
  category: CategoryKey,
  fn: (tags: WorkTag[]) => WorkTag[],
): Workspace {
  return { ...state, [category]: fn(state[category]) };
}

export function workspaceReducer(state: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case 'add': {
      const tag = action.tag.trim();
      if (!tag) return state;
      const key = normalize(tag);
      return updateCategory(state, action.category, (tags) => {
        // 同じタグがあれば重複させず ON に戻す
        if (tags.some((t) => normalize(t.tag) === key)) {
          return tags.map((t) => (normalize(t.tag) === key ? { ...t, enabled: true } : t));
        }
        return [...tags, { id: newId(), tag, enabled: true, weight: clampWeight(action.weight ?? 1) }];
      });
    }
    case 'toggle':
      return updateCategory(state, action.category, (tags) =>
        tags.map((t) => (t.id === action.id ? { ...t, enabled: !t.enabled } : t)),
      );
    case 'setWeight':
      return updateCategory(state, action.category, (tags) =>
        tags.map((t) => (t.id === action.id ? { ...t, weight: clampWeight(action.weight) } : t)),
      );
    case 'remove':
      return updateCategory(state, action.category, (tags) => tags.filter((t) => t.id !== action.id));
    case 'move':
      return updateCategory(state, action.category, (tags) => {
        const i = tags.findIndex((t) => t.id === action.id);
        const j = i + action.delta;
        if (i < 0 || j < 0 || j >= tags.length) return tags;
        const next = [...tags];
        [next[i], next[j]] = [next[j]!, next[i]!];
        return next;
      });
    case 'setAll':
      return updateCategory(state, action.category, (tags) =>
        tags.map((t) => ({ ...t, enabled: action.enabled })),
      );
    case 'replace':
      return action.workspace;
  }
}
