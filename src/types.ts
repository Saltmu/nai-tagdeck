import type { CategoryKey } from './lib/categories';

export type { CategoryKey };

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
  weight: number;
}

export type Workspace = Record<CategoryKey, WorkTag[]>;

/** numeric: V4 の `1.2::tag::`、brace: `{tag}` / `[tag]`（1段 = 1.05 倍）。 */
export type WeightSyntax = 'numeric' | 'brace';

export interface Settings {
  weightSyntax: WeightSyntax;
}
