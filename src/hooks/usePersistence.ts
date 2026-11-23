import { useEffect, useRef, useState } from 'react';
import { getKV, setKV, type KVKey } from '../lib/db';
import { getDataResetSignal } from '../lib/reset';
import { isStaleWriteError } from '../lib/tabSync';
import type { SyncBridge } from './useTabSync';

export interface PersistenceState {
  loaded: boolean;
  status: 'loading' | 'idle' | 'error';
  error: string | null;
}

interface InternalState extends PersistenceState {
  key: KVKey;
  appliedRevision: number;
}

const INITIAL: PersistenceState = { loaded: false, status: 'loading', error: null };

/**
 * IndexedDB の kv ストアから値を読み込み、変更を少し遅らせて書き戻す。
 * 読み込みが終わるまでは書き込まない（初期値で保存データを上書きしないため）。
 * sync が渡されているときは、全量スナップショットからの読み込み・競合ロック・通知を連携する。
 */
export function usePersistence<T>(
  key: KVKey,
  value: T,
  onLoad: (raw: unknown, isCurrent: () => boolean) => Promise<void> | void,
  delayMs = 300,
  sync?: SyncBridge,
  onSaved?: () => void,
): PersistenceState {
  const [state, setState] = useState<InternalState>({ key, ...INITIAL, appliedRevision: 0 });
  const [resetSignal] = useState(getDataResetSignal);
  const writes = useRef(Promise.resolve());
  const synced = useRef<{ key: string; value: T; inFlight: number } | null>(null);
  const current = state.key === key ? state : { key, ...INITIAL, appliedRevision: 0 };
  const stateRef = useRef(current);
  stateRef.current = current;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const hasSync = sync !== undefined;
  const snapshot = sync?.snapshot ?? null;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const snapshotRevision = snapshot?.revision ?? 0;
  const committed = sync?.committed ?? null;
  const committedRef = useRef(committed);
  committedRef.current = committed;
  const committedRevision = committed?.revision ?? 0;
  const locked = sync?.locked ?? false;
  const autosaveEpoch = sync?.autosaveEpoch ?? 0;

  // 単独利用（sync なし）: 従来どおり getKV で読み込む
  useEffect(() => {
    if (hasSync) return;
    let active = true;
    const isCurrent = () => active && !resetSignal.aborted;
    synced.current = null;
    setState({ key, ...INITIAL, appliedRevision: 0 });
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
        setState({ key, loaded: true, status: 'idle', error: null, appliedRevision: 0 });
      })
      .catch((error: unknown) => {
        if (isCurrent()) {
          setState({ key, loaded: false, status: 'error', error: `保存データを読み込めません (${key}): ${String(error)}`, appliedRevision: 0 });
        }
      });
    return () => { active = false; };
  }, [hasSync, key, resetSignal]);

  // 同期利用（sync あり）: readAllAppData の一括スナップショットを反映する（再読み込み時は loaded を落とさない）
  useEffect(() => {
    const snap = snapshotRef.current;
    if (!hasSync || !snap || snapshotRevision === 0) return;
    let active = true;
    const isCurrent = () => active && !resetSignal.aborted;
    const raw = snap.data.kv[key];
    const rev = snapshotRevision;
    const shouldApply = raw !== undefined || rev > 1;
    void Promise.resolve()
      .then(async () => {
        if (shouldApply) {
          const result = onLoadRef.current(raw, isCurrent);
          if (result && typeof (result as PromiseLike<void>).then === 'function') {
            await result;
          }
        }
        if (!isCurrent()) return;
        synced.current = null;
        setState({ key, loaded: true, status: 'idle', error: null, appliedRevision: rev });
      })
      .catch((error: unknown) => {
        if (isCurrent()) {
          synced.current = null;
          setState({ key, loaded: false, status: 'error', error: `保存データを読み込めません (${key}): ${String(error)}`, appliedRevision: rev });
        }
      });
    return () => { active = false; };
  }, [hasSync, key, snapshotRevision, resetSignal]);

  // 優先保存（replaceAllAppData）が完了したら、コミット済みの値を保存基準に合わせ過去の保存エラーも消す
  useEffect(() => {
    const latestCommitted = committedRef.current;
    if (!latestCommitted || committedRevision === 0) return;
    const tracker = synced.current;
    if (tracker && tracker.key === key) {
      tracker.value = latestCommitted.kv[key] as T;
    }
    if (stateRef.current.loaded && (stateRef.current.status !== 'idle' || stateRef.current.error !== null)) {
      setState((prev) => ({ ...prev, loaded: true, status: 'idle', error: null }));
    }
    onSavedRef.current?.();
  }, [committedRevision, key]);

  // 変更をデバウンスして書き戻す
  useEffect(() => {
    if (!current.loaded) return;
    if (hasSync && snapshotRevision > 0 && current.appliedRevision !== snapshotRevision) return;
    if (synced.current?.key !== key) {
      synced.current = { key, value, inFlight: 0 };
      return;
    }
    const tracker = synced.current;
    if (tracker.inFlight === 0 && Object.is(tracker.value, value)) return;
    if (locked || syncRef.current?.isLocked() || syncRef.current?.isAutosaveSuspended?.()) return;

    const effectEpoch = syncRef.current?.getAutosaveEpoch?.() ?? autosaveEpoch;
    let active = true;
    let pending = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const isInvalidated = () =>
      resetSignal.aborted ||
      (syncRef.current?.isLocked() ?? false) ||
      (syncRef.current?.isAutosaveSuspended?.() ?? false) ||
      (syncRef.current?.getAutosaveEpoch?.() ?? autosaveEpoch) !== effectEpoch;

    const enqueueWrite = (force: boolean) => {
      if (!pending || isInvalidated()) return;
      pending = false;
      clearTimeout(timer);
      tracker.inFlight += 1;
      // 遅い保存が新しい値を上書きしないよう、順番に書き込む。
      writes.current = writes.current.then(async () => {
        try {
          if (isInvalidated() || (!force && !active)) return;
          await setKV(key, value);
          if ((syncRef.current?.getAutosaveEpoch?.() ?? autosaveEpoch) !== effectEpoch) return;
          tracker.value = value;
          onSavedRef.current?.();
          syncRef.current?.onPersisted();
          if (active && (stateRef.current.status !== 'idle' || stateRef.current.error !== null)) {
            setState((prev) => ({ ...prev, loaded: true, status: 'idle', error: null }));
          }
        } catch (error) {
          if (isStaleWriteError(error)) {
            syncRef.current?.onStaleWrite(error.reason);
            return;
          }
          if (active) {
            setState((prev) => ({ ...prev, loaded: true, status: 'error', error: `変更を保存できません (${key}): ${String(error)}` }));
          }
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
  }, [key, value, current.loaded, current.appliedRevision, hasSync, snapshotRevision, delayMs, resetSignal, locked, autosaveEpoch]);

  return current;
}
