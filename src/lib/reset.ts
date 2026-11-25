import * as db from './db';
import { publishTabSync } from './tabSync';

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
  // テーマの localStorage ミラー（'nai-tagdeck:theme'）は clearAppStorage で消える。
  // data-theme 属性も外し、再起動時はシステム連動へ戻す。
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-theme');
  await db.clearAllData();
  const meta = 'getBaseMeta' in db && typeof db.getBaseMeta === 'function' ? db.getBaseMeta() ?? undefined : undefined;
  publishTabSync('reset', meta);
}
