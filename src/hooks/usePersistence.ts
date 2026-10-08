import { useEffect, useRef, useState } from 'react';
import { getKV, setKV } from '../lib/db';

export interface PersistenceState {
  loaded: boolean;
  status: 'loading' | 'idle' | 'saving' | 'error';
  error: string | null;
}

const INITIAL: PersistenceState = { loaded: false, status: 'loading', error: null };

/**
 * IndexedDB の kv ストアから値を読み込み、変更を少し遅らせて書き戻す。
 * 読み込みが終わるまでは書き込まない（初期値で保存データを上書きしないため）。
 */
export function usePersistence<T>(
  key: string,
  value: T,
  onLoad: (raw: unknown) => void,
  delayMs = 300,
): PersistenceState {
  const [state, setState] = useState({ key, ...INITIAL });
  const writes = useRef(Promise.resolve());
  const current = state.key === key ? state : INITIAL;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    let active = true;
    setState({ key, ...INITIAL });
    getKV<unknown>(key)
      .then((raw) => {
        if (!active) return;
        if (raw !== undefined) onLoadRef.current(raw);
        setState({ key, loaded: true, status: 'idle', error: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ key, loaded: false, status: 'error', error: `保存データを読み込めません (${key}): ${String(error)}` });
      });
    return () => { active = false; };
  }, [key]);

  useEffect(() => {
    if (!current.loaded) return;
    let active = true;
    const timer = setTimeout(() => {
      setState({ key, loaded: true, status: 'saving', error: null });
      // 遅い保存が新しい値を上書きしないよう、順番に書き込む。
      writes.current = writes.current.then(async () => {
        if (!active) return;
        try {
          await setKV(key, value);
          if (active) setState({ key, loaded: true, status: 'idle', error: null });
        } catch (error) {
          if (active) setState({ key, loaded: true, status: 'error', error: `変更を保存できません (${key}): ${String(error)}` });
        }
      });
    }, delayMs);
    return () => { active = false; clearTimeout(timer); };
  }, [key, value, current.loaded, delayMs]);

  return current;
}
