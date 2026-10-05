import { clearAllData } from './db';

/** このアプリが保存したキーだけを削除し、同じサイトの他のデータは保持する。 */
export function clearAppStorage(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === 'nai-tagdeck.token' || key?.startsWith('nai-tagdeck:')) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/** 自動保存を行う画面をアンマウントしてから呼ぶ。 */
export async function resetAppData(): Promise<void> {
  clearAppStorage(window.localStorage);
  clearAppStorage(window.sessionStorage);
  await clearAllData();
}
