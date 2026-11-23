import { clearAllData } from './db';

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
  pendingWrites.abort();
  pendingWrites = new AbortController();
  clearAppStorage(window.localStorage);
  clearAppStorage(window.sessionStorage);
  await clearAllData();
}
