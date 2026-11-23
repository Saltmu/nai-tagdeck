// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { KV_KEYS } from '../src/lib/db';
import {
  TAB_SYNC_STORAGE_KEY,
  getTabId,
  getTabSyncConflict,
  publishTabSync,
  receiveTabSyncMessage,
  lockTabSyncFromStaleWrite,
  resetTabSyncForTests,
  orderedScopesToSave,
  scopesToSave,
  scopesToWrite,
  setScopeDirty,
  startTabSync,
  subscribeTabSync,
} from '../src/lib/tabSync';

afterEach(() => {
  resetTabSyncForTests();
});

describe('tab sync', () => {
  it('delivers another tab over BroadcastChannel and ignores its own id', async () => {
    startTabSync();
    const other = new BroadcastChannel('nai-tagdeck:sync');
    other.postMessage({ type: 'updated', senderId: getTabId(), scope: 'workspace', seq: 1, at: 1 });
    other.postMessage({ type: 'updated', senderId: 'other-tab', scope: 'settings', seq: 2, at: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getTabSyncConflict()).toEqual({ kind: 'updated', scopes: ['settings'] });
    other.close();
  });

  it('keeps reset when a later update arrives and lists every saved scope to write back', () => {
    receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'presets', seq: 1, at: 1 });
    receiveTabSyncMessage({ type: 'reset', senderId: 'other-tab', scope: 'reset', seq: 2, at: 2 });
    receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'dictionary', seq: 3, at: 3 });
    const conflict = getTabSyncConflict();
    expect(conflict?.kind).toBe('reset');
    expect(conflict?.scopes).toEqual(['presets', 'reset', 'dictionary']);
    const scopes = scopesToWrite(conflict!);
    for (const key of KV_KEYS) expect(scopes).toContain(key);
    expect(scopes).toContain('dictionary');
    expect(scopes).not.toContain('reset');
    setScopeDirty('workspace', true);
    const saved = scopesToSave(conflict!);
    expect(saved).toContain('workspace');
    expect(saved).not.toContain('reset');
  });

  it('locks when a write sees a newer stored revision', () => {
    lockTabSyncFromStaleWrite('generation');
    expect(getTabSyncConflict()).toEqual({ kind: 'updated', scopes: ['generation'] });
  });

  it('treats a missed reset as a reset conflict and writes workspace before settings', () => {
    lockTabSyncFromStaleWrite('settings', 'reset');
    setScopeDirty('workspace', true);
    const conflict = getTabSyncConflict();
    expect(conflict?.kind).toBe('reset');
    const ordered = orderedScopesToSave(conflict!, true);
    expect(ordered[0]).toBe('workspace');
    expect(ordered.indexOf('workspace')).toBeLessThan(ordered.indexOf('settings'));
  });

  it('ignores malformed messages', () => {
    receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'nope', seq: 1, at: 1 });
    receiveTabSyncMessage({ type: 'reset', senderId: 'other-tab', scope: 'workspace', seq: 2, at: 2 });
    receiveTabSyncMessage(null);
    expect(getTabSyncConflict()).toBeNull();
  });

  it('falls back to localStorage when BroadcastChannel is unavailable', () => {
    resetTabSyncForTests({ preferStorage: true });
    const seen: unknown[] = [];
    const stop = subscribeTabSync((message) => seen.push(message));
    publishTabSync('updated', 'generation');
    const raw = localStorage.getItem(TAB_SYNC_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw!) as { senderId: string; scope: string };
    expect(stored.scope).toBe('generation');
    expect(stored.senderId).toBe(getTabId());
    window.dispatchEvent(new StorageEvent('storage', { key: TAB_SYNC_STORAGE_KEY, newValue: raw }));
    expect(getTabSyncConflict()).toBeNull();
    expect(seen).toEqual([]);

    const remote = JSON.stringify({ type: 'updated', senderId: 'other-tab', scope: 'workspace', seq: 4, at: 4 });
    window.dispatchEvent(new StorageEvent('storage', { key: TAB_SYNC_STORAGE_KEY, newValue: remote }));
    expect(getTabSyncConflict()).toEqual({ kind: 'updated', scopes: ['workspace'] });
    expect(seen).toEqual([expect.objectContaining({ scope: 'workspace', senderId: 'other-tab' })]);
    stop();
  });

  it('swallows localStorage failures on the fallback path', () => {
    resetTabSyncForTests({ preferStorage: true });
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('unavailable'); };
    try {
      expect(() => publishTabSync('updated', 'settings')).not.toThrow();
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});
