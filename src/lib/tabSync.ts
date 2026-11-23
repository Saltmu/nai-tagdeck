import { newId } from './id';

/** IndexedDB の kv キー。db.ts の KV_KEYS と揃える。 */
const KV_SCOPES = ['workspace', 'settings', 'generation', 'presets', 'activePreset'] as const;

export type SyncScope = (typeof KV_SCOPES)[number] | 'dictionary' | 'reset';

export interface TabSyncMessage {
  type: 'updated' | 'reset';
  senderId: string;
  scope: SyncScope;
  seq: number;
  at: number;
}

export interface TabSyncConflict {
  kind: 'updated' | 'reset';
  scopes: SyncScope[];
}

const CHANNEL_NAME = 'nai-tagdeck:sync';
export const TAB_SYNC_STORAGE_KEY = 'nai-tagdeck:sync-event';

const tabId = newId();
let seq = 0;
let epoch = 0;
let conflict: TabSyncConflict | null = null;
let channel: BroadcastChannel | null = null;
let storageListener: ((event: StorageEvent) => void) | null = null;
let preferStorage = false;

const listeners = new Set<(message: TabSyncMessage) => void>();
const conflictListeners = new Set<() => void>();

const KV_SCOPE_SET = new Set<string>(KV_SCOPES);

function isSyncScope(scope: unknown): scope is SyncScope {
  return scope === 'dictionary' || scope === 'reset' || (typeof scope === 'string' && KV_SCOPE_SET.has(scope));
}

function isTabSyncMessage(data: unknown): data is TabSyncMessage {
  if (!data || typeof data !== 'object') return false;
  const message = data as Partial<TabSyncMessage>;
  if (message.type !== 'updated' && message.type !== 'reset') return false;
  if (typeof message.senderId !== 'string' || !message.senderId) return false;
  if (!isSyncScope(message.scope)) return false;
  if (typeof message.seq !== 'number' || typeof message.at !== 'number') return false;
  if (message.type === 'reset' && message.scope !== 'reset') return false;
  if (message.type === 'updated' && message.scope === 'reset') return false;
  return true;
}

function notifyConflict(): void {
  for (const listener of conflictListeners) listener();
}

function noteConflict(message: TabSyncMessage): void {
  epoch += 1;
  const scopes = conflict ? [...conflict.scopes] : [];
  if (!scopes.includes(message.scope)) scopes.push(message.scope);
  const kind: TabSyncConflict['kind'] = message.type === 'reset' || conflict?.kind === 'reset' ? 'reset' : 'updated';
  conflict = { kind, scopes };
  notifyConflict();
}

/** 他タブから届いた通知を検証し、自分の送信は無視してロックする。 */
export function receiveTabSyncMessage(data: unknown): void {
  if (!isTabSyncMessage(data) || data.senderId === tabId) return;
  noteConflict(data);
  for (const listener of listeners) listener(data);
}

function ensureChannel(): BroadcastChannel | null {
  if (preferStorage || typeof BroadcastChannel === 'undefined') return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => receiveTabSyncMessage(event.data);
    return channel;
  } catch {
    channel = null;
    return null;
  }
}

function ensureStorageListener(): void {
  if (storageListener || typeof window === 'undefined') return;
  storageListener = (event: StorageEvent) => {
    if (event.key !== TAB_SYNC_STORAGE_KEY || event.newValue == null) return;
    try {
      receiveTabSyncMessage(JSON.parse(event.newValue));
    } catch {
      // 壊れた通知は無視する
    }
  };
  window.addEventListener('storage', storageListener);
}

/** チャンネルと storage フォールバックの受信を始める。何度呼んでも同じ。 */
export function startTabSync(): void {
  ensureChannel();
  ensureStorageListener();
}

export function getTabId(): string {
  return tabId;
}

export function getTabSyncConflict(): TabSyncConflict | null {
  return conflict;
}

export function getTabSyncEpoch(): number {
  return epoch;
}

export function isTabSyncLocked(): boolean {
  return conflict !== null;
}

export function subscribeTabSync(listener: (message: TabSyncMessage) => void): () => void {
  startTabSync();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeTabSyncConflict(listener: () => void): () => void {
  conflictListeners.add(listener);
  return () => conflictListeners.delete(listener);
}

export function clearTabSyncConflict(): void {
  if (!conflict) return;
  conflict = null;
  notifyConflict();
}

/** ロック中の辞書書き込みを、リセット時と同じ中断として返す。 */
export function assertTabSyncWritable(): void {
  if (!isTabSyncLocked()) return;
  throw new DOMException('別のタブでデータが更新されたため、このタブの保存を停止しています', 'AbortError');
}

function writeStorageFallback(message: TabSyncMessage): void {
  try {
    localStorage.setItem(TAB_SYNC_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // localStorage が使えない環境では通知しない
  }
}

/** 書き込み成功後に他タブへ知らせる。届かなくても保存結果は変えない。 */
export function publishTabSync(type: TabSyncMessage['type'], scope: SyncScope): void {
  const message: TabSyncMessage = {
    type,
    senderId: tabId,
    scope,
    seq: ++seq,
    at: Date.now(),
  };
  if (!preferStorage) {
    const bc = ensureChannel();
    if (bc) {
      try {
        bc.postMessage(message);
        return;
      } catch {
        // BroadcastChannel が失敗したときは storage へ落とす
      }
    }
  }
  writeStorageFallback(message);
}

/** このタブの内容を書き戻す対象。全削除のあとは保存中のデータをすべて戻す。 */
export function scopesToWrite(current: TabSyncConflict): SyncScope[] {
  if (current.kind === 'reset') {
    return [...KV_SCOPES, 'dictionary'];
  }
  return current.scopes.filter((scope) => scope !== 'reset');
}

/** テストが輸送とロックを初期状態に戻す。 */
export function resetTabSyncForTests(options?: { preferStorage?: boolean }): void {
  channel?.close();
  channel = null;
  if (storageListener && typeof window !== 'undefined') {
    window.removeEventListener('storage', storageListener);
  }
  storageListener = null;
  listeners.clear();
  conflictListeners.clear();
  conflict = null;
  epoch = 0;
  seq = 0;
  preferStorage = options?.preferStorage ?? false;
}
