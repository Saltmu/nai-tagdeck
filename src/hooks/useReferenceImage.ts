import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../lib/id';
import { DEFAULT_PRECISE_REFERENCE_STRENGTH, type PreciseReferenceType } from '../lib/novelai';
import {
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
  setFromFile: (file: File) => Promise<boolean>;
  setFromBlob: (blob: Blob, name: string) => Promise<boolean>;
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
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      revokeAll(itemsRef.current);
      itemsRef.current = [];
    };
  }, []);

  const setFromBlob = useCallback(async (blob: Blob, name: string): Promise<boolean> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const independentBlob = await validateReferenceImageBlob(blob);
      if (!mountedRef.current || requestId !== requestIdRef.current) return false;
      const previewUrl = URL.createObjectURL(independentBlob);
      const prev = itemsRef.current;
      const previousFirst = prev[0];
      const nextItem: PreciseReferenceItem = {
        id: newId(),
        blob: independentBlob,
        previewUrl,
        name: name.trim() || '参照画像',
        type: previousFirst?.type ?? 'character',
        strength: previousFirst?.strength ?? DEFAULT_PRECISE_REFERENCE_STRENGTH,
        enabled: true,
      };
      itemsRef.current = [nextItem];
      setItems([nextItem]);
      revokeAll(prev);
      return true;
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return false;
      const message =
        err instanceof ReferenceImageError
          ? err.message
          : '参照画像を読み込めませんでした';
      setError(message);
      return false;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const setFromFile = useCallback(
    (file: File): Promise<boolean> => setFromBlob(file, file.name || '参照画像'),
    [setFromBlob],
  );

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
    requestIdRef.current += 1;
    setLoading(false);
    setError(null);
    const target = itemsRef.current.find((item) => item.id === id);
    if (!target) return;
    const next = itemsRef.current.filter((item) => item.id !== id);
    itemsRef.current = next;
    setItems(next);
    URL.revokeObjectURL(target.previewUrl);
  }, []);

  const clear = useCallback(() => {
    requestIdRef.current += 1;
    setLoading(false);
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
    setFromFile,
    setFromBlob,
    setType,
    setStrength,
    setEnabled,
    disableAll,
    remove,
    clear,
    dismissError,
  };
}
