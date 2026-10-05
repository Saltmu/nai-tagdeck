import type { Character, CategoryKey, TagGroups, TargetId, WorkTag, Workspace } from '../types';
import { CATEGORY_KEYS } from './categories';
import { newId } from './id';
import { clampWeight } from './prompt';
import { normalize } from './suggest';

export const BASE: TargetId = 'base';
/** 公式UIのキャラクタープロンプトの上限に合わせる。 */
export const MAX_CHARACTERS = 6;

type TagAction =
  | { type: 'add'; tag: string; weight?: number }
  | { type: 'toggle'; id: string }
  | { type: 'setWeight'; id: string; weight: number }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; delta: -1 | 1 }
  | { type: 'setAll'; enabled: boolean };

export type WorkspaceAction =
  | (TagAction & { target: TargetId; category: CategoryKey })
  | { type: 'addCharacter' }
  | { type: 'removeCharacter'; id: string }
  | { type: 'renameCharacter'; id: string; name: string }
  | { type: 'toggleCharacter'; id: string }
  | { type: 'moveCharacter'; id: string; delta: -1 | 1 }
  | { type: 'replace'; workspace: Workspace };

export function emptyGroups(): TagGroups {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, []])) as unknown as TagGroups;
}

export function emptyWorkspace(): Workspace {
  return { base: emptyGroups(), characters: [] };
}

export function newCharacter(index: number): Character {
  return { id: newId(), name: `キャラ${index + 1}`, enabled: true, tags: emptyGroups() };
}

// ---- 保存データの読み込み ----

function normalizeGroups(raw: unknown): TagGroups {
  const groups = emptyGroups();
  if (!raw || typeof raw !== 'object') return groups;
  const obj = raw as Record<string, unknown>;
  for (const key of CATEGORY_KEYS) {
    const list = obj[key];
    if (!Array.isArray(list)) continue;
    groups[key] = list.flatMap((item): WorkTag[] => {
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
  return groups;
}

/**
 * 保存データを読み込むとき、壊れた値や未知のカテゴリを捨てる。
 * キャラクター対応前の形式（カテゴリ → タグの配列）はベースとして読む。
 */
export function normalizeWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') return emptyWorkspace();
  const obj = raw as Record<string, unknown>;
  if (!('base' in obj)) return { base: normalizeGroups(obj), characters: [] };

  const characters = Array.isArray(obj.characters)
    ? obj.characters.flatMap((item, i): Character[] => {
        if (!item || typeof item !== 'object') return [];
        const c = item as Record<string, unknown>;
        return [
          {
            id: typeof c.id === 'string' ? c.id : newId(),
            name: typeof c.name === 'string' && c.name.trim() ? c.name : `キャラ${i + 1}`,
            enabled: c.enabled !== false,
            tags: normalizeGroups(c.tags),
          },
        ];
      })
    : [];
  return { base: normalizeGroups(obj.base), characters: characters.slice(0, MAX_CHARACTERS) };
}

// ---- reducer ----

function reduceTags(tags: WorkTag[], action: TagAction): WorkTag[] {
  switch (action.type) {
    case 'add': {
      const tag = action.tag.trim();
      if (!tag) return tags;
      const key = normalize(tag);
      // 同じタグがあれば重複させず ON に戻す
      if (tags.some((t) => normalize(t.tag) === key)) {
        return tags.map((t) => (normalize(t.tag) === key ? { ...t, enabled: true } : t));
      }
      return [...tags, { id: newId(), tag, enabled: true, weight: clampWeight(action.weight ?? 1) }];
    }
    case 'toggle':
      return tags.map((t) => (t.id === action.id ? { ...t, enabled: !t.enabled } : t));
    case 'setWeight':
      return tags.map((t) => (t.id === action.id ? { ...t, weight: clampWeight(action.weight) } : t));
    case 'remove':
      return tags.filter((t) => t.id !== action.id);
    case 'move':
      return moveItem(tags, action.id, action.delta);
    case 'setAll':
      return tags.map((t) => ({ ...t, enabled: action.enabled }));
  }
}

function moveItem<T extends { id: string }>(items: T[], id: string, delta: -1 | 1): T[] {
  const i = items.findIndex((t) => t.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const next = [...items];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

function updateGroups(groups: TagGroups, category: CategoryKey, action: TagAction): TagGroups {
  const before = groups[category];
  const after = reduceTags(before, action);
  return after === before ? groups : { ...groups, [category]: after };
}

function updateCharacter(state: Workspace, id: string, fn: (c: Character) => Character): Workspace {
  if (!state.characters.some((c) => c.id === id)) return state;
  return { ...state, characters: state.characters.map((c) => (c.id === id ? fn(c) : c)) };
}

export function workspaceReducer(state: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case 'addCharacter':
      if (state.characters.length >= MAX_CHARACTERS) return state;
      return { ...state, characters: [...state.characters, newCharacter(state.characters.length)] };
    case 'removeCharacter':
      return { ...state, characters: state.characters.filter((c) => c.id !== action.id) };
    case 'renameCharacter':
      return updateCharacter(state, action.id, (c) => ({ ...c, name: action.name }));
    case 'toggleCharacter':
      return updateCharacter(state, action.id, (c) => ({ ...c, enabled: !c.enabled }));
    case 'moveCharacter':
      return { ...state, characters: moveItem(state.characters, action.id, action.delta) };
    case 'replace':
      return action.workspace;
    default: {
      const { target, category } = action;
      if (target === BASE) {
        const base = updateGroups(state.base, category, action);
        return base === state.base ? state : { ...state, base };
      }
      return updateCharacter(state, target, (c) => {
        const tags = updateGroups(c.tags, category, action);
        return tags === c.tags ? c : { ...c, tags };
      });
    }
  }
}
