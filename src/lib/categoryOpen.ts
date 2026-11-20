import type { WorkspaceCategoryKey, TargetId } from '../types';

type CategoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

const listeners = new Set<() => void>();

/** 一括開閉など、このフックの外から保存した開閉を画面へ伝える。 */
export function subscribeCategoryOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitCategoryOpen(): void {
  for (const listener of [...listeners]) listener();
}

function storageKey(target: TargetId, category: WorkspaceCategoryKey): string {
  return `nai-tagdeck:category-open:${JSON.stringify([target, category])}`;
}

/** 未保存・不正な値の場合は開いた状態にする。 */
export function loadCategoryOpen(target: TargetId, category: WorkspaceCategoryKey, storage?: CategoryStorage): boolean {
  try {
    return (storage ?? window.localStorage).getItem(storageKey(target, category)) !== 'false';
  } catch {
    return true;
  }
}

/** 開閉直後の再読み込みでも復元できるよう、変更時に同期的に保存する。 */
export function saveCategoryOpen(target: TargetId, category: WorkspaceCategoryKey, open: boolean, storage?: CategoryStorage): void {
  saveCategoriesOpen(target, [category], open, storage);
}

/** 表示中の欄にあるカテゴリをまとめて開く、または閉じる。 */
export function saveCategoriesOpen(
  target: TargetId,
  categories: readonly WorkspaceCategoryKey[],
  open: boolean,
  storage?: CategoryStorage,
): void {
  const box = storage ?? window.localStorage;
  let wrote = false;
  for (const category of categories) {
    try {
      box.setItem(storageKey(target, category), String(open));
      wrote = true;
    } catch {
      // 保存が利用できない環境でも、画面上の開閉は続けられる。
    }
  }
  if (!storage && wrote) emitCategoryOpen();
}
