import type { WorkspaceCategoryKey, TargetId } from '../types';

type CategoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

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
  try {
    (storage ?? window.localStorage).setItem(storageKey(target, category), String(open));
  } catch {
    // 保存が利用できない環境でも、画面上の開閉は続けられる。
  }
}
