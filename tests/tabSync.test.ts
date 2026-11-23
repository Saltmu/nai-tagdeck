// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTabId,
  isStaleWriteError,
  publishTabSync,
  resetTabSyncForTests,
  subscribeTabSync,
  TAB_SYNC_STORAGE_KEY,
  type TabSyncMessage,
} from '../src/lib/tabSync';

class FakeBroadcastChannel {
  static instances = new Set<FakeBroadcastChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.add(this);
  }

  postMessage(data: unknown): void {
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer !== this && !peer.closed && peer.name === this.name) {
        peer.onmessage?.({ data } as MessageEvent);
      }
    }
  }

  close(): void {
    this.closed = true;
    FakeBroadcastChannel.instances.delete(this);
  }
}

beforeEach(() => {
  FakeBroadcastChannel.instances.clear();
  resetTabSyncForTests();
  localStorage.clear();
});

afterEach(() => {
  resetTabSyncForTests();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('tabSync transport', () => {
  it('delivers messages over BroadcastChannel, ignores self-messages, and closes channel when unsubscribed', () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const received: TabSyncMessage[] = [];
    const unsubscribe = subscribeTabSync((msg) => received.push(msg));
    expect(FakeBroadcastChannel.instances.size).toBe(1);

    const peer = new FakeBroadcastChannel('nai-tagdeck:sync');
    // 同じ tabId のメッセージは無視される
    peer.postMessage({ type: 'updated', senderId: getTabId(), seq: 1, at: Date.now() });
    expect(received).toEqual([]);

    // 別タブのメッセージは届く
    peer.postMessage({ type: 'updated', senderId: 'other-tab', seq: 2, at: 12345 });
    peer.postMessage({ type: 'reset', senderId: 'other-tab', seq: 3, at: 12346 });
    expect(received.map((m) => m.type)).toEqual(['updated', 'reset']);

    // 不正ペイロードは無視される
    peer.postMessage({ type: 'unknown', senderId: 'other-tab', seq: 4, at: 1 });
    peer.postMessage(null);
    expect(received).toHaveLength(2);

    // publishTabSync が peer へ届く
    const peerReceived: unknown[] = [];
    peer.onmessage = (e) => peerReceived.push(e.data);
    publishTabSync('updated');
    expect(peerReceived).toEqual([
      expect.objectContaining({ type: 'updated', senderId: getTabId() }),
    ]);

    peer.close();
    unsubscribe();
    expect(FakeBroadcastChannel.instances.size).toBe(0);
  });

  it('falls back to localStorage and storage event when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const received: TabSyncMessage[] = [];
    const unsubscribe = subscribeTabSync((msg) => received.push(msg));

    publishTabSync('reset');
    const stored = localStorage.getItem(TAB_SYNC_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toMatchObject({ type: 'reset', senderId: getTabId() });

    // 別タブからの storage イベントを受信
    const otherPayload: TabSyncMessage = { type: 'updated', senderId: 'tab-b', seq: 1, at: 100 };
    window.dispatchEvent(new StorageEvent('storage', {
      key: TAB_SYNC_STORAGE_KEY,
      newValue: JSON.stringify(otherPayload),
    }));
    // 壊れた JSON や無関係なキーは無視
    window.dispatchEvent(new StorageEvent('storage', { key: TAB_SYNC_STORAGE_KEY, newValue: '{bad' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'other-key', newValue: JSON.stringify(otherPayload) }));

    expect(received).toEqual([otherPayload]);
    unsubscribe();
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(() => publishTabSync('updated')).not.toThrow();
    spy.mockRestore();
  });

  it('identifies StaleWriteError safely without instanceof db import', () => {
    const err = Object.assign(new Error('stale'), { name: 'StaleWriteError', reason: 'updated' });
    expect(isStaleWriteError(err)).toBe(true);
    expect(isStaleWriteError(new Error('other'))).toBe(false);
    expect(isStaleWriteError({ name: 'StaleWriteError', reason: 'updated' })).toBe(false);
  });
});
