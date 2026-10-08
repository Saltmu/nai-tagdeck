export const CATEGORIES = [
  { key: 'quality', label: '品質' },
  { key: 'style', label: '画風' },
  { key: 'subject', label: '被写体・人数・関係性' },
  { key: 'appearance', label: '外見' },
  { key: 'outfit', label: '衣装' },
  { key: 'dress_state', label: '着衣状態' },
  { key: 'pose', label: 'ポーズ' },
  { key: 'effect', label: 'エフェクト' },
  { key: 'composition', label: '構図' },
  { key: 'background', label: '背景・場所' },
  { key: 'weather', label: '時間・天候' },
  // ネガティブ（Undesired Content）。辞書のカテゴリとしてだけ使い、プロンプトのカテゴリには含めない。
  { key: 'negative', label: 'ネガティブ' },
] as const;

/** 辞書のカテゴリ（ネガティブを含む）。 */
export type CategoryKey = (typeof CATEGORIES)[number]['key'];

/** プロンプト（ベース・キャラクター）を組み立てるカテゴリ。 */
export type PromptCategoryKey = Exclude<CategoryKey, 'negative'>;

export const CATEGORY_KEYS: readonly CategoryKey[] = CATEGORIES.map((c) => c.key);

export const PROMPT_CATEGORY_KEYS: readonly PromptCategoryKey[] = CATEGORY_KEYS.filter(
  (k): k is PromptCategoryKey => k !== 'negative',
);

/** キャラクタープロンプトで編集するカテゴリ（品質・画風・エフェクト・構図・背景・天候はベース側で扱う）。 */
export const CHARACTER_CATEGORY_KEYS: readonly PromptCategoryKey[] = [
  'subject',
  'appearance',
  'outfit',
  'dress_state',
  'pose',
];

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && (CATEGORY_KEYS as readonly string[]).includes(value);
}

export function categoryLabel(key: CategoryKey): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export function categoryIndex(key: CategoryKey): number {
  return CATEGORY_KEYS.indexOf(key);
}

/** キー（quality）と表示名（品質）のどちらでも受け付ける。 */
export function parseCategory(value: string): CategoryKey | null {
  const v = value.trim();
  if (isCategoryKey(v)) return v;
  return CATEGORIES.find((c) => c.label === v)?.key ?? null;
}
