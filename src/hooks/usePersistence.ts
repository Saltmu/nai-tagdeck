import { useEffect, useRef, useState } from 'react';
import { getKV, setKV } from '../lib/db';

/**
 * IndexedDB の kv ストアから値を読み込み、変更を少し遅らせて書き戻す。
 * 読み込みが終わるまでは書き込まない（初期値で保存データを上書きしないため）。
 */
export function usePersistence<T>(
  key: string,
  value: T,
  onLoad: (raw: unknown) => void,
  delayMs = 300,
): boolean {
  const [loaded, setLoaded] = useState(false);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    getKV<unknown>(key)
      .then((raw) => {
        if (raw !== undefined) onLoadRef.current(raw);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      setKV(key, value).catch(() => {});
    }, delayMs);
    return () => clearTimeout(timer);
  }, [key, value, loaded, delayMs]);

  return loaded;
}
