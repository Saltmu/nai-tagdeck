import { useEffect, useRef, useState } from 'react';
import { getKV, setKV } from '../lib/db';

export interface PersistenceState {
  loaded: boolean;
  status: 'loading' | 'idle' | 'error';
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
  onLoad: (raw: unknown) => Promise<void> | void,
  delayMs = 300,
): PersistenceState {
  const [state, setState] = useState({ key, ...INITIAL });
  const writes = useRef(Promise.resolve());
  const synced = useRef<{ key: string; value: T; inFlight: number } | null>(null);
  const current = state.key === key ? state : INITIAL;
  const stateRef = useRef(current);
  stateRef.current = current;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    let active = true;
    synced.current = null;
    setState({ key, ...INITIAL });
    getKV<unknown>(key)
      .then(async (raw) => {
        if (!active) return;
        if (raw !== undefined) {
          const result = onLoadRef.current(raw);
          if (result && typeof (result as PromiseLike<void>).then === 'function') {
            await result;
          }
        }
        if (!active) return;
        setState({ key, loaded: true, status: 'idle', error: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ key, loaded: false, status: 'error', error: `保存データを読み込めません (${key}): ${String(error)}` });
      });
    return () => { active = false; };
  }, [key]);

  useEffect(() => {
    if (!current.loaded) return;
    if (synced.current?.key !== key) {
      synced.current = { key, value, inFlight: 0 };
      return;
    }
    const tracker = synced.current;
    if (tracker.inFlight === 0 && Object.is(tracker.value, value)) return;

    let active = true;
    let pending = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const enqueueWrite = (force: boolean) => {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      tracker.inFlight += 1;
      // 遅い保存が新しい値を上書きしないよう、順番に書き込む。
      writes.current = writes.current.then(async () => {
        try {
          if (!force && !active) return;
          await setKV(key, value);
          tracker.value = value;
          if (active && (stateRef.current.status !== 'idle' || stateRef.current.error !== null)) {
            setState({ key, loaded: true, status: 'idle', error: null });
          }
        } catch (error) {
          if (active) setState({ key, loaded: true, status: 'error', error: `変更を保存できません (${key}): ${String(error)}` });
        } finally {
          tracker.inFlight -= 1;
        }
      });
    };

    const onPageHide = () => enqueueWrite(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') enqueueWrite(true);
    };

    timer = setTimeout(() => enqueueWrite(false), delayMs);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      pending = false;
      clearTimeout(timer);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [key, value, current.loaded, delayMs]);

  return current;
}
