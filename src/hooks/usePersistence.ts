import { useEffect, useRef, useState } from 'react';
import { getKV, setKV, StaleWriteError, type KVKey } from '../lib/db';
import { getDataResetSignal } from '../lib/reset';
import { isTabSyncLocked, lockTabSyncFromStaleWrite, publishTabSync, setScopeDirty, startTabSync } from '../lib/tabSync';

export interface PersistenceState {
  loaded: boolean;
  status: 'loading' | 'idle' | 'error';
  error: string | null;
  /** 再読み込みの世代。0 は初回読み込み。 */
  revision: number;
}

const INITIAL: PersistenceState = { loaded: false, status: 'loading', error: null, revision: 0 };

/**
 * IndexedDB の kv ストアから値を読み込み、変更を少し遅らせて書き戻す。
 * 読み込みが終わるまでは書き込まない（初期値で保存データを上書きしないため）。
 */
export function usePersistence<T>(
  key: KVKey,
  value: T,
  onLoad: (raw: unknown, isCurrent: () => boolean) => Promise<void> | void,
  delayMs = 300,
  reloadRevision = 0,
): PersistenceState {
  startTabSync();
  const [state, setState] = useState({ key, ...INITIAL });
  const [resetSignal] = useState(getDataResetSignal);
  const writes = useRef(Promise.resolve());
  const synced = useRef<{ key: string; value: T; inFlight: number } | null>(null);
  const current = state.key === key ? state : INITIAL;
  const stateRef = useRef(current);
  stateRef.current = current;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    let active = true;
    const revision = reloadRevision;
    const isCurrent = () => active && !resetSignal.aborted;
    synced.current = null;
    setState({ key, ...INITIAL });
    getKV<unknown>(key)
      .then(async (raw) => {
        if (!isCurrent()) return;
        // 初回に値が無いときは初期状態のままにする。再読み込みで消えていたときだけ既定値へ戻す。
        if (raw !== undefined || revision > 0) {
          const result = onLoadRef.current(raw, isCurrent);
          if (result && typeof (result as PromiseLike<void>).then === 'function') {
            await result;
          }
        }
        if (!isCurrent()) return;
        setState({ key, loaded: true, status: 'idle', error: null, revision });
      })
      .catch((error: unknown) => {
        if (isCurrent()) setState({ key, loaded: false, status: 'error', error: `保存データを読み込めません (${key}): ${String(error)}`, revision });
      });
    return () => { active = false; };
  }, [key, resetSignal, reloadRevision]);

  useEffect(() => {
    if (!current.loaded) return;
    if (synced.current?.key !== key) {
      synced.current = { key, value, inFlight: 0 };
      setScopeDirty(key, false);
      return;
    }
    const tracker = synced.current;
    if (tracker.inFlight === 0 && Object.is(tracker.value, value)) {
      setScopeDirty(key, false);
      return;
    }
    setScopeDirty(key, true);

    let active = true;
    let pending = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const enqueueWrite = (force: boolean) => {
      if (!pending || resetSignal.aborted || isTabSyncLocked()) return;
      pending = false;
      clearTimeout(timer);
      tracker.inFlight += 1;
      // 遅い保存が新しい値を上書きしないよう、順番に書き込む。
      writes.current = writes.current.then(async () => {
        try {
          // キューに入ったあとに他タブの更新やリセットが来た書き込みも捨てる。
          if (resetSignal.aborted || isTabSyncLocked() || (!force && !active)) return;
          await setKV(key, value);
          tracker.value = value;
          setScopeDirty(key, false);
          publishTabSync('updated', key);
          if (active && (stateRef.current.status !== 'idle' || stateRef.current.error !== null)) {
            setState({ key, loaded: true, status: 'idle', error: null, revision: stateRef.current.revision });
          }
        } catch (error) {
          if (error instanceof StaleWriteError) {
            setScopeDirty(key, true);
            lockTabSyncFromStaleWrite(key);
            return;
          }
          if (active) setState({ key, loaded: true, status: 'error', error: `変更を保存できません (${key}): ${String(error)}`, revision: stateRef.current.revision });
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
  }, [key, value, current.loaded, delayMs, resetSignal]);

  return current;
}
