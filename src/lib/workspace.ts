import type { Character, PromptCategoryKey, TagGroups, TargetId, WorkTag, Workspace, WorkspaceCategoryKey } from '../types';
import { CHARACTER_CATEGORY_KEYS, LEGACY_DRESS_STATE_CATEGORY, PROMPT_CATEGORY_KEYS } from './categories';
import { newId, normalizeId } from './id';
import { clampWeight, parseTagList } from './prompt';
import { DEFAULT_NEGATIVE } from './novelai';
import { normalize } from './tagText';
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
  /** 以前は取り消し通知の対象を示すだけだった。履歴は操作全般を記録するので、reducer では無視する。 */
  | { type: 'remove'; id: string; undo?: boolean }
  /** 消したタグを元の位置に戻す。同じタグが今あれば重複させず、現在のタグを優先する。 */
  | { type: 'restore'; tag: WorkTag; index: number }
  | { type: 'move'; id: string; delta: -1 | 1 }
  /** ドラッグで id のタグを index 番目へ動かす。 */
  | { type: 'moveTo'; id: string; index: number }
  | { type: 'setAll'; enabled: boolean }
  /** group のタグのうち tag だけを先頭に置き、ほかは外す。tag が null なら group のタグをすべて外す。 */
  | { type: 'pickOne'; group: readonly string[]; tag: string | null };

export type WorkspaceAction =
  /** category が 'negative' のときは target によらずネガティブを操作する。 */
  | (TagAction & { target: TargetId; category: WorkspaceCategoryKey })
  | { type: 'moveFromUnclassified'; target: TargetId; id: string; to: PromptCategoryKey }
  | { type: 'addCharacter' }
  | { type: 'duplicateCharacter'; id: string }
  | { type: 'removeCharacter'; id: string }
  | { type: 'renameCharacter'; id: string; name: string }
  /** null は個別指定を消し、共通のネガティブに戻す。 */
  | { type: 'setCharacterNegative'; id: string; negative: string | null }
  /** null は位置指定を消す。 */
  | { type: 'setCharacterCenter'; id: string; center: { x: number; y: number } | null }
  | { type: 'toggleCharacter'; id: string }
  | { type: 'moveCharacter'; id: string; delta: -1 | 1 }
  | { type: 'replace'; workspace: Workspace }
  /** 取り消し履歴が計算した状態を、正規化し直さずそのまま入れる。 */
  | { type: 'commit'; workspace: Workspace };

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

/** 座標は 0〜1。範囲外は端に寄せ、小数第 2 位までにする。 */
export function normalizeCenter(raw: unknown): { x: number; y: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const point = raw as Record<string, unknown>;
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return undefined;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
  return { x: clamp(point.x), y: clamp(point.y) };
}

// ---- 保存データの読み込み ----

function normalizeTags(list: unknown[]): WorkTag[] {
  return list.flatMap((item): WorkTag[] => {
    if (!item || typeof item !== 'object') return [];
    const t = item as Record<string, unknown>;
    if (typeof t.tag !== 'string' || !t.tag.trim()) return [];
    return [
      {
        id: normalizeId(t.id),
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
  // 統合前のプロンプトと同じ順序になるよう、衣装の後ろに着衣状態をつなぐ。
  const dressState = obj[LEGACY_DRESS_STATE_CATEGORY];
  if (Array.isArray(dressState)) groups.outfit.push(...normalizeTags(dressState));
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
        const center = normalizeCenter(c.center);
        return [
          {
            id: normalizeId(c.id),
            name: typeof c.name === 'string' && c.name.trim() ? c.name : `キャラ${i + 1}`,
            enabled: c.enabled !== false,
            tags: normalizeGroups(c.tags),
            ...(typeof c.negative === 'string' ? { negative: c.negative } : {}),
            ...(center ? { center } : {}),
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
    case 'moveTo': {
      const from = tags.findIndex((t) => t.id === action.id);
      const to = Math.min(Math.max(action.index, 0), tags.length - 1);
      if (from < 0 || from === to) return tags;
      const next = [...tags];
      next.splice(to, 0, next.splice(from, 1)[0]!);
      return next;
    }
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
export function tagsOf(state: Workspace, target: TargetId, category: WorkspaceCategoryKey): WorkTag[] | undefined {
  if (category === 'negative') return state.negative;
  if (target === BASE) return state.base[category];
  return state.characters.find((c) => c.id === target)?.tags[category];
}

function updateGroups(groups: TagGroups, category: PromptCategoryKey, action: TagAction): TagGroups {
  const before = groups[category];
  const after = reduceTags(before, action);
  return after === before ? groups : { ...groups, [category]: after };
}

/** 画面に出している呼び名。未入力のときは並び順の既定名。 */
function displayedCharacterName(character: Character, index: number): string {
  return character.name.trim() || `キャラ${index + 1}`;
}

function cloneGroups(groups: TagGroups): TagGroups {
  const next = emptyGroups();
  for (const key of PROMPT_CATEGORY_KEYS) {
    next[key] = groups[key].map((tag) => ({ ...tag, id: newId() }));
  }
  return next;
}

function updateCharacter(state: Workspace, id: string, fn: (c: Character) => Character): Workspace {
  const index = state.characters.findIndex((c) => c.id === id);
  if (index < 0) return state;
  const before = state.characters[index]!;
  const after = fn(before);
  if (before === after) return state;
  const characters = [...state.characters];
  characters[index] = after;
  return { ...state, characters };
}

export function workspaceReducer(state: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case 'addCharacter': {
      if (state.characters.length >= MAX_CHARACTERS) return state;
      const enabled = state.characters.filter((c) => c.enabled).length < MAX_ENABLED_CHARACTERS;
      return { ...state, characters: [...state.characters, { ...newCharacter(state.characters.length), enabled }] };
    }
    case 'duplicateCharacter': {
      if (state.characters.length >= MAX_CHARACTERS) return state;
      const index = state.characters.findIndex((c) => c.id === action.id);
      if (index < 0) return state;
      const source = state.characters[index]!;
      const enabled = source.enabled && state.characters.filter((c) => c.enabled).length < MAX_ENABLED_CHARACTERS;
      const copy: Character = {
        id: newId(),
        name: `${displayedCharacterName(source, index)}（コピー）`,
        enabled,
        tags: cloneGroups(source.tags),
        ...(source.negative !== undefined ? { negative: source.negative } : {}),
        ...(source.center ? { center: { ...source.center } } : {}),
      };
      const characters = [...state.characters];
      characters.splice(index + 1, 0, copy);
      return { ...state, characters };
    }
    case 'removeCharacter':
      return { ...state, characters: state.characters.filter((c) => c.id !== action.id) };
    case 'renameCharacter':
      return updateCharacter(state, action.id, (c) => ({ ...c, name: action.name }));
    case 'setCharacterNegative':
      return updateCharacter(state, action.id, (c) => {
        if (action.negative === null) {
          if (c.negative === undefined) return c;
          const { negative: _negative, ...rest } = c;
          return rest;
        }
        return c.negative === action.negative ? c : { ...c, negative: action.negative };
      });
    case 'setCharacterCenter':
      return updateCharacter(state, action.id, (c) => {
        if (action.center === null) {
          if (!c.center) return c;
          const { center: _center, ...rest } = c;
          return rest;
        }
        const center = normalizeCenter(action.center);
        if (!center || (c.center?.x === center.x && c.center?.y === center.y)) return c;
        return { ...c, center };
      });
    case 'toggleCharacter':
      if (state.characters.some((c) => c.id === action.id && !c.enabled) &&
          state.characters.filter((c) => c.enabled).length >= MAX_ENABLED_CHARACTERS) return state;
      return updateCharacter(state, action.id, (c) => ({ ...c, enabled: !c.enabled }));
    case 'moveCharacter':
      return { ...state, characters: moveItem(state.characters, action.id, action.delta) };
    case 'replace':
      return normalizeWorkspace(action.workspace);
    case 'commit':
      return action.workspace;
    case 'moveFromUnclassified': {
      const keys = action.target === BASE ? PROMPT_CATEGORY_KEYS : CHARACTER_CATEGORY_KEYS;
      if (action.to === 'unclassified' || !keys.includes(action.to)) return state;
      const move = (groups: TagGroups): TagGroups => {
        const tag = groups.unclassified.find((t) => t.id === action.id);
        if (!tag) return groups;
        const key = normalize(tag.tag);
        const destination = groups[action.to];
        const exists = destination.some((t) => normalize(t.tag) === key);
        return {
          ...groups,
          unclassified: groups.unclassified.filter((t) => t.id !== tag.id),
          [action.to]: exists ? destination : [...destination, tag],
        };
      };
      if (action.target === BASE) {
        const base = move(state.base);
        return base === state.base ? state : { ...state, base };
      }
      return updateCharacter(state, action.target, (character) => {
        const tags = move(character.tags);
        return tags === character.tags ? character : { ...character, tags };
      });
    }
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
