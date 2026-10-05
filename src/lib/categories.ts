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
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

export const CATEGORY_KEYS: readonly CategoryKey[] = CATEGORIES.map((c) => c.key);

/** キャラクタープロンプトで編集するカテゴリ（品質・画風・エフェクト・構図はベース側で扱う）。 */
export const CHARACTER_CATEGORY_KEYS: readonly CategoryKey[] = [
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
