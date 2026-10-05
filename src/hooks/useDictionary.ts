import { useCallback, useEffect, useRef, useState } from 'react';
import type { DictEntry } from '../types';
import { deleteEntry, listEntries, putEntry, replaceAllEntries } from '../lib/db';
import { mergeEntries, sortEntries, type ImportMode } from '../lib/io';
import { restoreInitialDictionary } from '../lib/sampleDictionary';

export interface Dictionary {
  entries: DictEntry[];
  loaded: boolean;
  error: string | null;
  save: (entry: DictEntry) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importEntries: (incoming: DictEntry[], mode: ImportMode) => Promise<number>;
  restoreInitial: () => Promise<number>;
}

export function useDictionary(): Dictionary {
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(entries);
  latest.current = entries;

  useEffect(() => {
    listEntries()
      .then((list) => setEntries(sortEntries(list)))
      .catch((e: unknown) => setError(`辞書を読み込めません: ${String(e)}`))
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (entry: DictEntry) => {
    const next = { ...entry, updated_at: new Date().toISOString() };
    await putEntry(next);
    setEntries((prev) => sortEntries([...prev.filter((e) => e.id !== next.id), next]));
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const importEntries = useCallback(async (incoming: DictEntry[], mode: ImportMode) => {
    const merged = mergeEntries(latest.current, incoming, mode);
    await replaceAllEntries(merged);
    setEntries(merged);
    return merged.length;
  }, []);

  const restoreInitial = useCallback(async () => {
    const merged = restoreInitialDictionary(latest.current);
    await replaceAllEntries(merged);
    latest.current = merged;
    setEntries(merged);
    return merged.length;
  }, []);

  return { entries, loaded, error, save, remove, importEntries, restoreInitial };
}
