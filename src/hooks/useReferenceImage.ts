import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../lib/id';
import { DEFAULT_PRECISE_REFERENCE_STRENGTH, type PreciseReferenceType } from '../lib/novelai';
import {
  MAX_PRECISE_REFERENCES,
  normalizeReferenceStrength,
  ReferenceImageError,
  validateReferenceImageBlob,
  type PreciseReferenceItem,
} from '../lib/referenceImage';

export interface ReferenceImageStore {
  items: readonly PreciseReferenceItem[];
  activeItems: readonly PreciseReferenceItem[];
  loading: boolean;
  error: string | null;
  addFromFile: (file: File) => Promise<boolean>;
  addFromFiles: (files: FileList | readonly File[]) => Promise<number>;
  addFromBlob: (blob: Blob, name: string) => Promise<boolean>;
  replaceFromFile: (id: string, file: File) => Promise<boolean>;
  replaceFromBlob: (id: string, blob: Blob, name: string) => Promise<boolean>;
  moveItem: (id: string, delta: -1 | 1) => void;
  setType: (id: string, type: PreciseReferenceType) => void;
  setStrength: (id: string, strength: number) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  disableAll: () => void;
  remove: (id: string) => void;
  clear: () => void;
  dismissError: () => void;
}

function revokeAll(items: readonly PreciseReferenceItem[]): void {
  for (const item of items) {
    URL.revokeObjectURL(item.previewUrl);
  }
}

export function useReferenceImage(): ReferenceImageStore {
  const [items, setItems] = useState<PreciseReferenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef<PreciseReferenceItem[]>([]);
  const mountedRef = useRef(true);
  const clearEpochRef = useRef(0);
  const replaceEpochRef = useRef<Map<string, number>>(new Map());
  const inFlightCountRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearEpochRef.current += 1;
      replaceEpochRef.current.clear();
      revokeAll(itemsRef.current);
      itemsRef.current = [];
    };
  }, []);

  const beginLoading = useCallback(() => {
    inFlightCountRef.current += 1;
    setLoading(true);
  }, []);

  const endLoading = useCallback(() => {
    inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
    if (mountedRef.current) {
      setLoading(inFlightCountRef.current > 0);
    }
  }, []);

  const addFromBlob = useCallback(async (blob: Blob, name: string): Promise<boolean> => {
    if (itemsRef.current.length >= MAX_PRECISE_REFERENCES) {
      setError(`参照画像は最大 ${MAX_PRECISE_REFERENCES} 枚まで追加できます`);
      return false;
    }
    const startClearEpoch = clearEpochRef.current;
    beginLoading();
    setError(null);
    try {
      const independentBlob = await validateReferenceImageBlob(blob);
      if (!mountedRef.current || startClearEpoch !== clearEpochRef.current) return false;
      if (itemsRef.current.length >= MAX_PRECISE_REFERENCES) {
        setError(`参照画像は最大 ${MAX_PRECISE_REFERENCES} 枚まで追加できます`);
        return false;
      }
      const previewUrl = URL.createObjectURL(independentBlob);
      const nextItem: PreciseReferenceItem = {
        id: newId(),
        blob: independentBlob,
        previewUrl,
        name: name.trim() || '参照画像',
        type: 'character',
        strength: DEFAULT_PRECISE_REFERENCE_STRENGTH,
        enabled: true,
      };
      const next = [...itemsRef.current, nextItem];
      itemsRef.current = next;
      setItems(next);
      return true;
    } catch (err) {
      if (!mountedRef.current || startClearEpoch !== clearEpochRef.current) return false;
      const message =
        err instanceof ReferenceImageError ? err.message : '参照画像を読み込めませんでした';
      setError(message);
      return false;
    } finally {
      endLoading();
    }
  }, [beginLoading, endLoading]);

  const addFromFile = useCallback(
    (file: File): Promise<boolean> => addFromBlob(file, file.name || '参照画像'),
    [addFromBlob],
  );

  const addFromFiles = useCallback(
    async (files: FileList | readonly File[]): Promise<number> => {
      const list = Array.from(files);
      if (list.length === 0) return 0;
      let added = 0;
      let hitLimit = false;
      let lastError: string | null = null;
      const startClearEpoch = clearEpochRef.current;

      for (const file of list) {
        if (!mountedRef.current || startClearEpoch !== clearEpochRef.current) break;
        if (itemsRef.current.length >= MAX_PRECISE_REFERENCES) {
          hitLimit = true;
          break;
        }
        beginLoading();
        try {
          const independentBlob = await validateReferenceImageBlob(file);
          if (!mountedRef.current || startClearEpoch !== clearEpochRef.current) break;
          if (itemsRef.current.length >= MAX_PRECISE_REFERENCES) {
            hitLimit = true;
            break;
          }
          const previewUrl = URL.createObjectURL(independentBlob);
          const nextItem: PreciseReferenceItem = {
            id: newId(),
            blob: independentBlob,
            previewUrl,
            name: file.name || '参照画像',
            type: 'character',
            strength: DEFAULT_PRECISE_REFERENCE_STRENGTH,
            enabled: true,
          };
          const next = [...itemsRef.current, nextItem];
          itemsRef.current = next;
          setItems(next);
          added += 1;
        } catch (err) {
          if (!mountedRef.current || startClearEpoch !== clearEpochRef.current) break;
          lastError =
            err instanceof ReferenceImageError ? err.message : '参照画像を読み込めませんでした';
        } finally {
          endLoading();
        }
      }

      if (mountedRef.current && startClearEpoch === clearEpochRef.current) {
        if (lastError) {
          setError(lastError);
        } else if (hitLimit) {
          setError(`参照画像は最大 ${MAX_PRECISE_REFERENCES} 枚までです（上限を超えた画像は追加されませんでした）`);
        } else if (added > 0) {
          setError(null);
        }
      }
      return added;
    },
    [beginLoading, endLoading],
  );

  const replaceFromBlob = useCallback(async (id: string, blob: Blob, name: string): Promise<boolean> => {
    if (!itemsRef.current.some((item) => item.id === id)) return false;
    const startClearEpoch = clearEpochRef.current;
    const replaceSeq = (replaceEpochRef.current.get(id) ?? 0) + 1;
    replaceEpochRef.current.set(id, replaceSeq);
    beginLoading();
    setError(null);
    try {
      const independentBlob = await validateReferenceImageBlob(blob);
      if (
        !mountedRef.current ||
        startClearEpoch !== clearEpochRef.current ||
        replaceEpochRef.current.get(id) !== replaceSeq
      ) {
        return false;
      }
      const oldItem = itemsRef.current.find((item) => item.id === id);
      if (!oldItem) return false;
      const previewUrl = URL.createObjectURL(independentBlob);
      const next = itemsRef.current.map((item) =>
        item.id === id
          ? {
              ...item,
              blob: independentBlob,
              previewUrl,
              name: name.trim() || '参照画像',
              enabled: true,
            }
          : item,
      );
      itemsRef.current = next;
      setItems(next);
      URL.revokeObjectURL(oldItem.previewUrl);
      return true;
    } catch (err) {
      if (
        !mountedRef.current ||
        startClearEpoch !== clearEpochRef.current ||
        replaceEpochRef.current.get(id) !== replaceSeq
      ) {
        return false;
      }
      const message =
        err instanceof ReferenceImageError ? err.message : '参照画像を読み込めませんでした';
      setError(message);
      return false;
    } finally {
      endLoading();
    }
  }, [beginLoading, endLoading]);

  const replaceFromFile = useCallback(
    (id: string, file: File): Promise<boolean> => replaceFromBlob(id, file, file.name || '参照画像'),
    [replaceFromBlob],
  );

  const moveItem = useCallback((id: string, delta: -1 | 1) => {
    const index = itemsRef.current.findIndex((item) => item.id === id);
    if (index < 0) return;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= itemsRef.current.length) return;
    const next = [...itemsRef.current];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved!);
    itemsRef.current = next;
    setItems(next);
  }, []);

  const setType = useCallback((id: string, type: PreciseReferenceType) => {
    const next = itemsRef.current.map((item) => (item.id === id ? { ...item, type } : item));
    itemsRef.current = next;
    setItems(next);
  }, []);

  const setStrength = useCallback((id: string, strength: number) => {
    const normalized = normalizeReferenceStrength(strength);
    const next = itemsRef.current.map((item) => (item.id === id ? { ...item, strength: normalized } : item));
    itemsRef.current = next;
    setItems(next);
  }, []);

  const setEnabled = useCallback((id: string, enabled: boolean) => {
    const next = itemsRef.current.map((item) => (item.id === id ? { ...item, enabled } : item));
    itemsRef.current = next;
    setItems(next);
  }, []);

  const disableAll = useCallback(() => {
    if (!itemsRef.current.some((item) => item.enabled)) return;
    const next = itemsRef.current.map((item) => (item.enabled ? { ...item, enabled: false } : item));
    itemsRef.current = next;
    setItems(next);
  }, []);

  const remove = useCallback((id: string) => {
    replaceEpochRef.current.delete(id);
    setError(null);
    const target = itemsRef.current.find((item) => item.id === id);
    if (!target) return;
    const next = itemsRef.current.filter((item) => item.id !== id);
    itemsRef.current = next;
    setItems(next);
    URL.revokeObjectURL(target.previewUrl);
  }, []);

  const clear = useCallback(() => {
    clearEpochRef.current += 1;
    replaceEpochRef.current.clear();
    setError(null);
    const prev = itemsRef.current;
    if (prev.length === 0) return;
    itemsRef.current = [];
    setItems([]);
    revokeAll(prev);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  const activeItems = useMemo(() => items.filter((item) => item.enabled), [items]);

  return {
    items,
    activeItems,
    loading,
    error,
    addFromFile,
    addFromFiles,
    addFromBlob,
    replaceFromFile,
    replaceFromBlob,
    moveItem,
    setType,
    setStrength,
    setEnabled,
    disableAll,
    remove,
    clear,
    dismissError,
  };
}
