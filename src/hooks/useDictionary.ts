import { useCallback, useEffect, useRef, useState } from 'react';
import type { DictEntry } from '../types';
import { deleteEntry, listEntries, putEntry, putEntries, replaceAllEntries } from '../lib/db';
import { mergeEntries, sortEntries, type ImportMode } from '../lib/io';
import { getDataResetSignal } from '../lib/reset';
import { isStaleWriteError } from '../lib/tabSync';
import type { SyncBridge } from './useTabSync';

export interface Dictionary {
  entries: DictEntry[];
  loaded: boolean;
  error: string | null;
  save: (entry: DictEntry) => Promise<void>;
  saveMany: (entries: DictEntry[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importEntries: (incoming: DictEntry[], mode: ImportMode) => Promise<number>;
  restoreInitial: () => Promise<number>;
  /** 進行中の辞書書き込みキューがすべて終わるまで待つ。 */
  flush?: () => Promise<void>;
}

export function useDictionary(sync?: SyncBridge): Dictionary {
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSignal] = useState(getDataResetSignal);
  const latest = useRef<DictEntry[]>(entries);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const writes = useRef(Promise.resolve());
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const hasSync = sync !== undefined;
  const snapshot = sync?.snapshot ?? null;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const snapshotRevision = snapshot?.revision ?? 0;

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = writes.current.then(() => {
      resetSignal.throwIfAborted();
      if (!loadedRef.current) {
        throw new Error('辞書の読み込みが完了していないため保存できません');
      }
      if (syncRef.current?.isLocked()) {
        throw new DOMException('別のタブでデータが更新されたため、このタブの保存を停止しています', 'AbortError');
      }
      return task();
    }).catch((caught: unknown) => {
      if (isStaleWriteError(caught)) {
        syncRef.current?.onStaleWrite(caught.reason);
      }
      throw caught;
    });
    writes.current = run.then(() => undefined, () => undefined);
    return run;
  }, [resetSignal]);

  // 単独利用（sync なし）: 従来どおり listEntries で読み込む
  useEffect(() => {
    if (hasSync) return;
    let active = true;
    listEntries()
      .then((list) => {
        if (!active) return;
        const sorted = sortEntries(list);
        latest.current = sorted;
        loadedRef.current = true;
        setEntries(sorted);
        setError(null);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!active) return;
        loadedRef.current = false;
        setError(`辞書を読み込めません: ${String(e)}`);
        setLoaded(false);
      });
    return () => { active = false; };
  }, [hasSync]);

  // 同期利用（sync あり）: 一括スナップショットから辞書を反映する
  useEffect(() => {
    const snap = snapshotRef.current;
    if (!hasSync || !snap || snapshotRevision === 0) return;
    const sorted = sortEntries(snap.data.dictionary);
    latest.current = sorted;
    loadedRef.current = true;
    setEntries(sorted);
    setError(null);
    setLoaded(true);
  }, [hasSync, snapshotRevision]);

  const save = useCallback((entry: DictEntry) => enqueue(async () => {
    const next = { ...entry, updated_at: new Date().toISOString() };
    await putEntry(next);
    syncRef.current?.onPersisted();
    const updated = sortEntries([...latest.current.filter((e) => e.id !== next.id), next]);
    latest.current = updated;
    setEntries(updated);
  }), [enqueue]);

  const remove = useCallback((id: string) => enqueue(async () => {
    await deleteEntry(id);
    syncRef.current?.onPersisted();
    const updated = latest.current.filter((e) => e.id !== id);
    latest.current = updated;
    setEntries(updated);
  }), [enqueue]);

  const saveMany = useCallback((incoming: DictEntry[]) => enqueue(async () => {
    const updated_at = new Date().toISOString();
    const next = incoming.map((entry) => ({ ...entry, updated_at }));
    await putEntries(next);
    syncRef.current?.onPersisted();
    const ids = new Set(next.map((entry) => entry.id));
    const updated = sortEntries([...latest.current.filter((entry) => !ids.has(entry.id)), ...next]);
    latest.current = updated;
    setEntries(updated);
  }), [enqueue]);

  const importEntries = useCallback((incoming: DictEntry[], mode: ImportMode) => enqueue(async () => {
    const merged = mergeEntries(latest.current, incoming, mode);
    await replaceAllEntries(merged);
    syncRef.current?.onPersisted();
    latest.current = merged;
    setEntries(merged);
    return merged.length;
  }), [enqueue]);

  const restoreInitial = useCallback(async () => {
    // 動的 import の解決待ちで書き込みキューを塞がないよう、enqueue() の外で先に読む。
    const { restoreInitialDictionary } = await import('../lib/sampleDictionary');
    return enqueue(async () => {
      const merged = restoreInitialDictionary(latest.current);
      await replaceAllEntries(merged);
      syncRef.current?.onPersisted();
      latest.current = merged;
      setEntries(merged);
      return merged.length;
    });
  }, [enqueue]);

  const flush = useCallback(async () => {
    let pending: Promise<void>;
    do {
      pending = writes.current;
      await pending;
    } while (writes.current !== pending);
  }, []);

  return { entries, loaded, error, save, saveMany, remove, importEntries, restoreInitial, flush };
}
