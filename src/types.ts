import type { CategoryKey, PromptCategoryKey } from './lib/categories';

export type { CategoryKey, PromptCategoryKey, WorkspaceCategoryKey } from './lib/categories';

/** 辞書の1エントリ。 */
export interface DictEntry {
  id: string;
  tag: string;
  category: CategoryKey;
  /** 日本語名・よみ。空白や読点で区切って複数書ける。 */
  alias: string;
  default_weight: number;
  sort_order: number;
  updated_at: string;
}

/** 作業中プロンプトの1タグ。OFF でも消さずに残す。 */
export interface WorkTag {
  id: string;
  tag: string;
  enabled: boolean;
  /** -3〜3。マイナスは V4.5 以降の「取り除く」指定。 */
  weight: number;
}

export type TagGroups = Record<PromptCategoryKey, WorkTag[]>;

/** V4 以降のキャラクタープロンプト（char_captions の1件）。 */
export interface Character {
  id: string;
  /** 画面上の呼び名。プロンプトには出力しない。 */
  name: string;
  enabled: boolean;
  tags: TagGroups;
}

export interface Workspace {
  base: TagGroups;
  characters: Character[];
  /** ネガティブ（Undesired Content）。カテゴリに分けず1つの並びで持つ。 */
  negative: WorkTag[];
}

/** 'base' かキャラクターの id。 */
export type TargetId = string;

/** numeric: V4 以降の `1.2::tag::`、brace: `{tag}` / `[tag]`（1段 = 1.05 倍）。 */
export type WeightSyntax = 'numeric' | 'brace';

export interface Settings {
  weightSyntax: WeightSyntax;
  /** キャラクタープロンプトごとのネガティブ。全体のネガティブは Workspace.negative に持つ。 */
  characterNegativePrompt: string;
}
