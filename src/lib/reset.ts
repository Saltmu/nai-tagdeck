import { clearAllData } from './db';
import { clearTabSyncConflict, getTabSyncEpoch, publishTabSync } from './tabSync';

let pendingWrites = new AbortController();

/** リセット前の画面から予約された書き込みを無効にするためのシグナル。 */
export function getDataResetSignal(): AbortSignal {
  return pendingWrites.signal;
}

/** このアプリが保存したキーだけを削除し、同じサイトの他のデータは保持する。 */
export function clearAppStorage(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === 'nai-tagdeck.token' || key?.startsWith('nai-tagdeck:')) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/** 旧画面の書き込みを無効にしてから、先行する書き込みと同じストアを消去する。 */
export async function resetAppData(): Promise<void> {
  const epoch = getTabSyncEpoch();
  pendingWrites.abort();
  pendingWrites = new AbortController();
  clearAppStorage(window.localStorage);
  clearAppStorage(window.sessionStorage);
  await clearAllData();
  publishTabSync('reset', 'reset');
  // リセットより後に届いた他タブの通知は、新しい画面のロックとして残す。
  if (getTabSyncEpoch() === epoch) clearTabSyncConflict();
}
