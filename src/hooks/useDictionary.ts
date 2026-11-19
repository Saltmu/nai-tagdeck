import { useCallback, useEffect, useRef, useState } from 'react';
import type { DictEntry } from '../types';
import { deleteEntry, listEntries, putEntry, putEntries, replaceAllEntries } from '../lib/db';
import { mergeEntries, sortEntries, type ImportMode } from '../lib/io';
import { restoreInitialDictionary } from '../lib/sampleDictionary';

export interface Dictionary {
  entries: DictEntry[];
  loaded: boolean;
  error: string | null;
  save: (entry: DictEntry) => Promise<void>;
  saveMany: (entries: DictEntry[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importEntries: (incoming: DictEntry[], mode: ImportMode) => Promise<number>;
  restoreInitial: () => Promise<number>;
}

export function useDictionary(): Dictionary {
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<DictEntry[]>(entries);
  const writes = useRef(Promise.resolve());

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = writes.current.then(task);
    writes.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  useEffect(() => {
    let active = true;
    listEntries()
      .then((list) => {
        if (!active) return;
        const sorted = sortEntries(list);
        latest.current = sorted;
        setEntries(sorted);
        setError(null);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(`辞書を読み込めません: ${String(e)}`);
        setLoaded(false);
      });
    return () => { active = false; };
  }, []);

  const save = useCallback((entry: DictEntry) => enqueue(async () => {
    const next = { ...entry, updated_at: new Date().toISOString() };
    await putEntry(next);
    const updated = sortEntries([...latest.current.filter((e) => e.id !== next.id), next]);
    latest.current = updated;
    setEntries(updated);
  }), [enqueue]);

  const remove = useCallback((id: string) => enqueue(async () => {
    await deleteEntry(id);
    const updated = latest.current.filter((e) => e.id !== id);
    latest.current = updated;
    setEntries(updated);
  }), [enqueue]);

  const saveMany = useCallback((incoming: DictEntry[]) => enqueue(async () => {
    const updated_at = new Date().toISOString();
    const next = incoming.map((entry) => ({ ...entry, updated_at }));
    await putEntries(next);
    const ids = new Set(next.map((entry) => entry.id));
    const updated = sortEntries([...latest.current.filter((entry) => !ids.has(entry.id)), ...next]);
    latest.current = updated;
    setEntries(updated);
  }), [enqueue]);

  const importEntries = useCallback((incoming: DictEntry[], mode: ImportMode) => enqueue(async () => {
    const merged = mergeEntries(latest.current, incoming, mode);
    await replaceAllEntries(merged);
    latest.current = merged;
    setEntries(merged);
    return merged.length;
  }), [enqueue]);

  const restoreInitial = useCallback(() => enqueue(async () => {
    const merged = restoreInitialDictionary(latest.current);
    await replaceAllEntries(merged);
    latest.current = merged;
    setEntries(merged);
    return merged.length;
  }), [enqueue]);

  return { entries, loaded, error, save, saveMany, remove, importEntries, restoreInitial };
}
