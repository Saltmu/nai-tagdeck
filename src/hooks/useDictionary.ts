import { useCallback, useEffect, useRef, useState } from 'react';
import type { DictEntry } from '../types';
import { deleteEntry, listEntries, putEntry, putEntries, replaceAllEntries, StaleWriteError } from '../lib/db';
import { readCachedDictionary } from './usePersistence';
import { mergeEntries, sortEntries, type ImportMode } from '../lib/io';
import { getDataResetSignal } from '../lib/reset';
import { restoreInitialDictionary } from '../lib/sampleDictionary';
import { assertTabSyncWritable, lockTabSyncFromStaleWrite, publishTabSync, startTabSync } from '../lib/tabSync';

export interface Dictionary {
  entries: DictEntry[];
  loaded: boolean;
  error: string | null;
  save: (entry: DictEntry) => Promise<void>;
  saveMany: (entries: DictEntry[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importEntries: (incoming: DictEntry[], mode: ImportMode) => Promise<number>;
  restoreInitial: () => Promise<number>;
  /** IndexedDB の最新の辞書を読み直す。生成画像の履歴は触らない。 */
  reload: (revision?: number) => Promise<void>;
}

export function useDictionary(): Dictionary {
  startTabSync();
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSignal] = useState(getDataResetSignal);
  const latest = useRef<DictEntry[]>(entries);
  const writes = useRef(Promise.resolve());
  const loadId = useRef(0);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = writes.current.then(() => {
      resetSignal.throwIfAborted();
      assertTabSyncWritable();
      return task();
    }).catch((error: unknown) => {
      if (error instanceof StaleWriteError) {
        lockTabSyncFromStaleWrite('dictionary', error.scope === 'reset' ? 'reset' : 'updated');
      }
      throw error;
    });
    writes.current = run.then(() => undefined, () => undefined);
    return run;
  }, [resetSignal]);

  const applyLoaded = useCallback((list: DictEntry[]) => {
    const sorted = sortEntries(list);
    latest.current = sorted;
    setEntries(sorted);
    setError(null);
    setLoaded(true);
  }, []);

  const reload = useCallback(async (revision = 0) => {
    const cached = revision > 0 ? readCachedDictionary(revision) : undefined;
    if (cached) {
      applyLoaded(cached);
      return;
    }
    const id = ++loadId.current;
    setLoaded(false);
    try {
      const list = await listEntries();
      if (id !== loadId.current) return;
      applyLoaded(list);
    } catch (e: unknown) {
      if (id !== loadId.current) return;
      setError(`辞書を読み込めません: ${String(e)}`);
      setLoaded(false);
      throw e;
    }
  }, [applyLoaded]);

  useEffect(() => {
    let active = true;
    const id = ++loadId.current;
    listEntries()
      .then((list) => {
        if (!active || id !== loadId.current) return;
        applyLoaded(list);
      })
      .catch((e: unknown) => {
        if (!active || id !== loadId.current) return;
        setError(`辞書を読み込めません: ${String(e)}`);
        setLoaded(false);
      });
    return () => { active = false; };
  }, [applyLoaded]);

  const save = useCallback((entry: DictEntry) => enqueue(async () => {
    const next = { ...entry, updated_at: new Date().toISOString() };
    await putEntry(next);
    publishTabSync('updated', 'dictionary');
    const updated = sortEntries([...latest.current.filter((e) => e.id !== next.id), next]);
    latest.current = updated;
    setEntries(updated);
  }), [enqueue]);

  const remove = useCallback((id: string) => enqueue(async () => {
    await deleteEntry(id);
    publishTabSync('updated', 'dictionary');
    const updated = latest.current.filter((e) => e.id !== id);
    latest.current = updated;
    setEntries(updated);
  }), [enqueue]);

  const saveMany = useCallback((incoming: DictEntry[]) => enqueue(async () => {
    const updated_at = new Date().toISOString();
    const next = incoming.map((entry) => ({ ...entry, updated_at }));
    await putEntries(next);
    publishTabSync('updated', 'dictionary');
    const ids = new Set(next.map((entry) => entry.id));
    const updated = sortEntries([...latest.current.filter((entry) => !ids.has(entry.id)), ...next]);
    latest.current = updated;
    setEntries(updated);
  }), [enqueue]);

  const importEntries = useCallback((incoming: DictEntry[], mode: ImportMode) => enqueue(async () => {
    const merged = mergeEntries(latest.current, incoming, mode);
    await replaceAllEntries(merged);
    publishTabSync('updated', 'dictionary');
    latest.current = merged;
    setEntries(merged);
    return merged.length;
  }), [enqueue]);

  const restoreInitial = useCallback(() => enqueue(async () => {
    const merged = restoreInitialDictionary(latest.current);
    await replaceAllEntries(merged);
    publishTabSync('updated', 'dictionary');
    latest.current = merged;
    setEntries(merged);
    return merged.length;
  }), [enqueue]);

  return { entries, loaded, error, save, saveMany, remove, importEntries, restoreInitial, reload };
}
