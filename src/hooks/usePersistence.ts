import { useEffect, useRef, useState } from 'react';
import { getKV, setKV, type KVKey } from '../lib/db';
import { getDataResetSignal } from '../lib/reset';

export interface PersistenceState {
  loaded: boolean;
  status: 'loading' | 'idle' | 'error';
  error: string | null;
}

const INITIAL: PersistenceState = { loaded: false, status: 'loading', error: null };

/**
 * IndexedDB の kv ストアから値を読み込み、変更を少し遅らせて書き戻す。
 * 読み込みが終わるまでは書き込まない（初期値で保存データを上書きしないため）。
 * `commitRef` があれば、その関数は遅延を待たず、同じ直列の書き込みで `next` の保存完了を待つ。
 */
export function usePersistence<T>(
  key: KVKey,
  value: T,
  onLoad: (raw: unknown, isCurrent: () => boolean) => Promise<void> | void,
  delayMs = 300,
  commitRef?: { current: (next: T) => Promise<boolean> },
): PersistenceState {
  const [state, setState] = useState({ key, ...INITIAL });
  const [resetSignal] = useState(getDataResetSignal);
  const writes = useRef(Promise.resolve());
  const synced = useRef<{ key: string; value: T; inFlight: number } | null>(null);
  const current = state.key === key ? state : INITIAL;
  const stateRef = useRef(current);
  stateRef.current = current;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const latest = useRef(value);
  latest.current = value;
  const revision = useRef(0);
  const cancelScheduled = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    const isCurrent = () => active && !resetSignal.aborted;
    synced.current = null;
    setState({ key, ...INITIAL });
    getKV<unknown>(key)
      .then(async (raw) => {
        if (!isCurrent()) return;
        if (raw !== undefined) {
          const result = onLoadRef.current(raw, isCurrent);
          if (result && typeof (result as PromiseLike<void>).then === 'function') {
            await result;
          }
        }
        if (!isCurrent()) return;
        setState({ key, loaded: true, status: 'idle', error: null });
      })
      .catch((error: unknown) => {
        if (isCurrent()) setState({ key, loaded: false, status: 'error', error: `保存データを読み込めません (${key}): ${String(error)}` });
      });
    return () => { active = false; };
  }, [key, resetSignal]);

  useEffect(() => {
    if (!current.loaded) return;
    if (synced.current?.key !== key) {
      synced.current = { key, value, inFlight: 0 };
      return;
    }
    const tracker = synced.current;
    if (tracker.inFlight === 0 && Object.is(tracker.value, value)) return;

    revision.current += 1;
    let active = true;
    let pending = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      pending = false;
      clearTimeout(timer);
    };
    cancelScheduled.current = cancel;

    const enqueueWrite = (force: boolean) => {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      tracker.inFlight += 1;
      // 遅い保存が新しい値を上書きしないよう、順番に書き込む。
      writes.current = writes.current.then(async () => {
        try {
          if (resetSignal.aborted || (!force && !active)) return;
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
      if (cancelScheduled.current === cancel) cancelScheduled.current = null;
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [key, value, current.loaded, delayMs, resetSignal]);

  const commit = async (next: T): Promise<boolean> => {
    const tracker = synced.current;
    if (!stateRef.current.loaded || !tracker || tracker.key !== key) return false;
    cancelScheduled.current?.();
    const seen = revision.current;
    tracker.inFlight += 1;
    let ok = false;
    let skipped = false;
    const run = writes.current.then(async () => {
      try {
        if (resetSignal.aborted || revision.current !== seen) {
          skipped = true;
          return;
        }
        await setKV(key, next);
        if (resetSignal.aborted || revision.current !== seen) {
          skipped = true;
          return;
        }
        tracker.value = next;
        ok = true;
        if (stateRef.current.status !== 'idle' || stateRef.current.error !== null) {
          setState({ key, loaded: true, status: 'idle', error: null });
        }
      } catch (error) {
        if (!resetSignal.aborted && revision.current === seen) {
          setState({ key, loaded: true, status: 'error', error: `変更を保存できません (${key}): ${String(error)}` });
        } else {
          skipped = true;
        }
      } finally {
        tracker.inFlight -= 1;
      }
    });
    writes.current = run.then(() => undefined, () => undefined);
    await run;
    if (!ok && !skipped && !Object.is(tracker.value, latest.current) && !resetSignal.aborted) {
      const recover = latest.current;
      tracker.inFlight += 1;
      const recoverRun = writes.current.then(async () => {
        try {
          if (resetSignal.aborted) return;
          await setKV(key, recover);
          if (resetSignal.aborted) return;
          tracker.value = recover;
          setState({ key, loaded: true, status: 'idle', error: null });
        } catch (error) {
          if (!resetSignal.aborted) {
            setState({ key, loaded: true, status: 'error', error: `変更を保存できません (${key}): ${String(error)}` });
          }
        } finally {
          tracker.inFlight -= 1;
        }
      });
      writes.current = recoverRun.then(() => undefined, () => undefined);
      await recoverRun;
    }
    return ok;
  };
  if (commitRef) commitRef.current = commit;

  return current;
}
