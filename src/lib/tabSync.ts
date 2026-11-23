import { newId } from './id';

export type TabSyncType = 'updated' | 'reset';

export interface TabSyncMessage {
  type: TabSyncType;
  senderId: string;
  seq: number;
  at: number;
}

export const TAB_SYNC_STORAGE_KEY = 'nai-tagdeck:sync-event';
const CHANNEL_NAME = 'nai-tagdeck:sync';

const tabId = newId();
let seq = 0;
let channel: BroadcastChannel | null = null;
let storageListener: ((event: StorageEvent) => void) | null = null;
let preferStorage = false;
const listeners = new Set<(message: TabSyncMessage) => void>();

function isTabSyncMessage(data: unknown): data is TabSyncMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Partial<TabSyncMessage>;
  if (msg.type !== 'updated' && msg.type !== 'reset') return false;
  if (typeof msg.senderId !== 'string' || !msg.senderId) return false;
  if (typeof msg.seq !== 'number' || typeof msg.at !== 'number') return false;
  return true;
}

function dispatchIncoming(data: unknown): void {
  if (!isTabSyncMessage(data) || data.senderId === tabId) return;
  for (const listener of listeners) listener(data);
}

function openChannel(): BroadcastChannel | null {
  if (preferStorage || typeof BroadcastChannel === 'undefined') return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => dispatchIncoming(event.data);
    return channel;
  } catch {
    channel = null;
    return null;
  }
}

function attachTransports(): void {
  openChannel();
  if (!storageListener && typeof window !== 'undefined') {
    storageListener = (event: StorageEvent) => {
      if (event.key !== TAB_SYNC_STORAGE_KEY || event.newValue == null) return;
      try {
        dispatchIncoming(JSON.parse(event.newValue));
      } catch {
        // 壊れた通知は無視する
      }
    };
    window.addEventListener('storage', storageListener);
  }
}

function detachTransports(): void {
  channel?.close();
  channel = null;
  if (storageListener && typeof window !== 'undefined') {
    window.removeEventListener('storage', storageListener);
  }
  storageListener = null;
}

export function getTabId(): string {
  return tabId;
}

/** 他タブからの保存・全削除通知を購読する。購読者が 0 になると自動で解放する。 */
export function subscribeTabSync(listener: (message: TabSyncMessage) => void): () => void {
  if (listeners.size === 0) attachTransports();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detachTransports();
  };
}

function writeStorageFallback(message: TabSyncMessage): void {
  try {
    localStorage.setItem(TAB_SYNC_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // localStorage が使えない環境では通知しない
  }
}

/** 書き込み成功後に他タブへ知らせる。届かなくても保存結果には影響しない。 */
export function publishTabSync(type: TabSyncType): void {
  const message: TabSyncMessage = {
    type,
    senderId: tabId,
    seq: ++seq,
    at: Date.now(),
  };
  if (!preferStorage && typeof BroadcastChannel !== 'undefined') {
    const existing = channel;
    const target = existing ?? openChannel();
    if (target) {
      try {
        target.postMessage(message);
        if (!existing && listeners.size === 0) {
          target.close();
          channel = null;
        }
        return;
      } catch {
        if (!existing && listeners.size === 0) {
          try { target.close(); } catch { /* noop */ }
          channel = null;
        }
      }
    }
  }
  writeStorageFallback(message);
}

/** db.ts をモックしたテスト環境でも安全に StaleWriteError を判定する。 */
export function isStaleWriteError(error: unknown): error is Error & { reason: TabSyncType } {
  if (!(error instanceof Error) || error.name !== 'StaleWriteError') return false;
  const reason = (error as { reason?: unknown }).reason;
  return reason === 'updated' || reason === 'reset';
}

/** テスト用に輸送チャネルとカウンタを初期化する。 */
export function resetTabSyncForTests(options?: { preferStorage?: boolean }): void {
  listeners.clear();
  detachTransports();
  seq = 0;
  preferStorage = options?.preferStorage ?? false;
}
