import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, getKV, KV_KEYS, listEntries, putEntry, setKV, type KVKey } from '../src/lib/db';
import { clearAppStorage, resetAppData } from '../src/lib/reset';
import { TAB_SYNC_STORAGE_KEY } from '../src/lib/tabSync';
import { loadCategoryOpen, saveCategoryOpen } from '../src/lib/categoryOpen';
import { loadToken, saveToken } from '../src/lib/token';
import { normalizeGeneration } from '../src/lib/generation';
import { normalizeSettings } from '../src/lib/settings';
import { normalizeWorkspace } from '../src/lib/workspace';

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('全設定とデータの削除', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('辞書とすべてのKVを削除し、削除後も保存が使える', async () => {
    await putEntry({ id: 'tag', tag: 'solo', category: 'subject', alias: '', default_weight: 1, sort_order: 0, updated_at: '' });
    // アプリの型に無いキーも、ストアごと消える。
    const unknownKey = 'future-setting' as KVKey;
    for (const key of [...KV_KEYS, unknownKey]) {
      await setKV(key, { value: 'saved' });
    }
    await clearAllData();
    expect(await listEntries()).toEqual([]);
    for (const key of [...KV_KEYS, unknownKey]) {
      expect(await getKV(key)).toBeUndefined();
    }
    await setKV('settings', { value: 'new' });
    expect(await getKV('settings')).toEqual({ value: 'new' });
    await clearAllData();
  });

  it('アプリの保存キーだけを削除し、同じサイトの他のデータは残す', () => {
    const storage = new MemoryStorage();
    storage.setItem('other-app', 'keep');
    storage.setItem('nai-tagdeck.token', 'token');
    storage.setItem('nai-tagdeck:category-open:base', 'false');
    storage.setItem('nai-tagdeck:category-open:character', 'false');
    storage.setItem(TAB_SYNC_STORAGE_KEY, 'notice');
    clearAppStorage(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem('other-app')).toBe('keep');
  });

  it('トークン・開閉状態・保存設定を削除し、読み込み時に初期値へ戻る', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    saveToken('test-token', 'local');
    sessionStorage.setItem('nai-tagdeck.token', 'session-token');
    localStorage.setItem('other-app', 'keep');
    saveCategoryOpen('base', 'appearance', false);
    await setKV('generation', { mode: 'furry', seed: 123 });
    await setKV('workspace', { base: { quality: [{ tag: 'masterpiece' }] } });
    await setKV('settings', { characterNegativePrompt: 'custom' });
    await resetAppData();
    expect(loadToken().token).toBeNull();
    expect(loadCategoryOpen('base', 'appearance')).toBe(true);
    expect(localStorage.getItem('other-app')).toBe('keep');
    expect(normalizeGeneration(await getKV('generation')).mode).toBe('anime');
    expect(normalizeGeneration(await getKV('generation')).seed).toBeNull();
    expect(normalizeWorkspace(await getKV('workspace')).base.quality).toEqual([]);
    expect(normalizeSettings(await getKV('settings')).characterNegativePrompt).not.toBe('custom');
  });

  it('全削除のあと、他タブへ reset を通知する', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const other = new BroadcastChannel('nai-tagdeck:sync');
    const received = new Promise<MessageEvent>((resolve) => {
      other.onmessage = (event) => resolve(event);
    });
    await resetAppData();
    const event = await received;
    expect(event.data).toMatchObject({ type: 'reset', scope: 'reset' });
    other.close();
  });

  it('ストレージの削除に失敗した場合は成功として扱わない', async () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('storage unavailable'); } });
    await expect(resetAppData()).rejects.toThrow('storage unavailable');
  });
});
