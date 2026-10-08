import type { Character, CategoryKey, PromptCategoryKey, TagGroups, TargetId, WorkTag, Workspace } from '../types';
import { PROMPT_CATEGORY_KEYS } from './categories';
import { newId } from './id';
import { clampWeight, parseTagList } from './prompt';
import { DEFAULT_NEGATIVE } from './novelai';
import { normalize } from './suggest';
import { MAX_CHARACTERS, MAX_ENABLED_CHARACTERS } from './characterLimits';

export { MAX_CHARACTERS, MAX_ENABLED_CHARACTERS } from './characterLimits';

export const BASE: TargetId = 'base';
/** ネガティブ欄の target（開閉状態の保存などに使う）。タグの操作は category: 'negative' で判断する。 */
export const NEGATIVE: TargetId = 'negative';

type TagAction =
  | { type: 'add'; tag: string; weight?: number }
  | { type: 'toggle'; id: string }
  | { type: 'setWeight'; id: string; weight: number }
  | { type: 'setTag'; id: string; tag: string }
  /** undo: 取り消し通知の対象にする（タグ行の✕など、利用者が行を消す操作）。reducer では無視する。 */
  | { type: 'remove'; id: string; undo?: boolean }
  /** 消したタグを元の位置に戻す。同じタグが今あれば重複させず、現在のタグを優先する。 */
  | { type: 'restore'; tag: WorkTag; index: number }
  | { type: 'move'; id: string; delta: -1 | 1 }
  | { type: 'setAll'; enabled: boolean }
  /** group のタグのうち tag だけを先頭に置き、ほかは外す。tag が null なら group のタグをすべて外す。 */
  | { type: 'pickOne'; group: readonly string[]; tag: string | null };

export type WorkspaceAction =
  /** category が 'negative' のときは target によらずネガティブを操作する。 */
  | (TagAction & { target: TargetId; category: CategoryKey })
  | { type: 'addCharacter' }
  | { type: 'removeCharacter'; id: string }
  | { type: 'renameCharacter'; id: string; name: string }
  | { type: 'toggleCharacter'; id: string }
  | { type: 'moveCharacter'; id: string; delta: -1 | 1 }
  | { type: 'replace'; workspace: Workspace };

export function emptyGroups(): TagGroups {
  return Object.fromEntries(PROMPT_CATEGORY_KEYS.map((k) => [k, []])) as unknown as TagGroups;
}

/** 文字列のプロンプトを作業中のタグにする（すべて ON）。 */
export function tagsFromText(text: string): WorkTag[] {
  const seen = new Set<string>();
  return parseTagList(text).flatMap(({ tag, weight }) => {
    const key = normalize(tag);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: newId(), tag, enabled: true, weight }];
  });
}

/** 既定のネガティブ（公式UIの UC プリセット「heavy」）。 */
export function defaultNegativeTags(): WorkTag[] {
  return tagsFromText(DEFAULT_NEGATIVE);
}

/** タグは空で、ネガティブだけ既定値を入れた状態。 */
export function emptyWorkspace(): Workspace {
  return { base: emptyGroups(), characters: [], negative: defaultNegativeTags() };
}

export function newCharacter(index: number): Character {
  return { id: newId(), name: `キャラ${index + 1}`, enabled: true, tags: emptyGroups() };
}

// ---- 保存データの読み込み ----

function normalizeTags(list: unknown[]): WorkTag[] {
  return list.flatMap((item): WorkTag[] => {
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

function normalizeGroups(raw: unknown): TagGroups {
  const groups = emptyGroups();
  if (!raw || typeof raw !== 'object') return groups;
  const obj = raw as Record<string, unknown>;
  for (const key of PROMPT_CATEGORY_KEYS) {
    const list = obj[key];
    if (Array.isArray(list)) groups[key] = normalizeTags(list);
  }
  return groups;
}

/** 保存データがネガティブを持っているか（ネガティブ対応前のデータでは false）。 */
export function hasNegative(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).negative);
}

/**
 * 保存データを読み込むとき、壊れた値や未知のカテゴリを捨てる。
 * キャラクター対応前の形式（カテゴリ → タグの配列）はベースとして読む。
 * ネガティブ対応前のデータには fallbackNegative を入れる（省略時は既定のネガティブ）。
 */
export function normalizeWorkspace(raw: unknown, fallbackNegative?: readonly WorkTag[]): Workspace {
  const negative = () =>
    hasNegative(raw)
      ? normalizeTags((raw as { negative: unknown[] }).negative)
      : fallbackNegative ? fallbackNegative.map((t) => ({ ...t })) : defaultNegativeTags();
  if (!raw || typeof raw !== 'object') return { ...emptyWorkspace(), negative: negative() };
  const obj = raw as Record<string, unknown>;
  if (!('base' in obj)) return { base: normalizeGroups(obj), characters: [], negative: negative() };

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
  let enabledCount = 0;
  const limited = characters.slice(0, MAX_CHARACTERS).map((character) => {
    if (!character.enabled) return character;
    enabledCount++;
    return enabledCount <= MAX_ENABLED_CHARACTERS ? character : { ...character, enabled: false };
  });
  return { base: normalizeGroups(obj.base), characters: limited, negative: negative() };
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
    case 'setTag': {
      const tag = action.tag.trim();
      if (!tag || tags.some((t) => t.id !== action.id && normalize(t.tag) === normalize(tag))) return tags;
      return tags.map((t) => (t.id === action.id ? { ...t, tag } : t));
    }
    case 'remove':
      return tags.filter((t) => t.id !== action.id);
    case 'restore': {
      const key = normalize(action.tag.tag);
      if (tags.some((t) => t.id === action.tag.id || normalize(t.tag) === key)) return tags;
      const next = [...tags];
      next.splice(Math.min(Math.max(action.index, 0), tags.length), 0, { ...action.tag });
      return next;
    }
    case 'move':
      return moveItem(tags, action.id, action.delta);
    case 'setAll':
      return tags.map((t) => ({ ...t, enabled: action.enabled }));
    case 'pickOne': {
      const group = new Set(action.group.map(normalize));
      const rest = tags.filter((t) => !group.has(normalize(t.tag)));
      if (action.tag === null) return rest;
      const key = normalize(action.tag);
      const existing = tags.find((t) => normalize(t.tag) === key);
      const picked = existing ? { ...existing, enabled: true } : { id: newId(), tag: action.tag, enabled: true, weight: 1 };
      return [picked, ...rest];
    }
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

/** target / category が指すタグの並び。キャラクターがいなければ undefined。 */
export function tagsOf(state: Workspace, target: TargetId, category: CategoryKey): WorkTag[] | undefined {
  if (category === 'negative') return state.negative;
  if (target === BASE) return state.base[category];
  return state.characters.find((c) => c.id === target)?.tags[category];
}

function updateGroups(groups: TagGroups, category: PromptCategoryKey, action: TagAction): TagGroups {
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
    case 'addCharacter': {
      if (state.characters.length >= MAX_CHARACTERS) return state;
      const enabled = state.characters.filter((c) => c.enabled).length < MAX_ENABLED_CHARACTERS;
      return { ...state, characters: [...state.characters, { ...newCharacter(state.characters.length), enabled }] };
    }
    case 'removeCharacter':
      return { ...state, characters: state.characters.filter((c) => c.id !== action.id) };
    case 'renameCharacter':
      return updateCharacter(state, action.id, (c) => ({ ...c, name: action.name }));
    case 'toggleCharacter':
      if (state.characters.some((c) => c.id === action.id && !c.enabled) &&
          state.characters.filter((c) => c.enabled).length >= MAX_ENABLED_CHARACTERS) return state;
      return updateCharacter(state, action.id, (c) => ({ ...c, enabled: !c.enabled }));
    case 'moveCharacter':
      return { ...state, characters: moveItem(state.characters, action.id, action.delta) };
    case 'replace':
      return normalizeWorkspace(action.workspace);
    default: {
      const { target, category } = action;
      if (category === 'negative') {
        const negative = reduceTags(state.negative, action);
        return negative === state.negative ? state : { ...state, negative };
      }
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
