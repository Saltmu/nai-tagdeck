import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { migrateNegative } from '../lib/backup';
import * as db from '../lib/db';
import type { AppDataReplacement, AppDataSnapshot, KVKey, SyncMeta } from '../lib/db';
import { getDataResetSignal } from '../lib/reset';
import { isStaleWriteError, publishTabSync, subscribeTabSync, type TabSyncMeta, type TabSyncType } from '../lib/tabSync';
import { hasNegative } from '../lib/workspace';

const DEFAULT_KV_KEYS: readonly KVKey[] = ['workspace', 'settings', 'generation', 'presets', 'activePreset'];

function currentDbMeta(): SyncMeta | undefined {
  return 'getBaseMeta' in db && typeof db.getBaseMeta === 'function' ? db.getBaseMeta() ?? undefined : undefined;
}

/** 受信した通知のリビジョンが、すでに読み込み・反映済みのメタに含まれているか。 */
function isCoveredByLoaded(incoming: TabSyncMeta | undefined, loaded: SyncMeta | null): boolean {
  if (!incoming || !loaded) return false;
  if (incoming.epoch < loaded.epoch) return true;
  if (incoming.epoch === loaded.epoch && incoming.rev <= loaded.rev) return true;
  return false;
}

/** 既存テストが db.ts の一部だけをモックしている場合でも動作する読み込みアダプタ。 */
async function loadAllSnapshot(): Promise<AppDataSnapshot> {
  if ('readAllAppData' in db && typeof db.readAllAppData === 'function') return db.readAllAppData();
  const keys = 'KV_KEYS' in db && Array.isArray(db.KV_KEYS) ? db.KV_KEYS : DEFAULT_KV_KEYS;
  const [dictionary, ...values] = await Promise.all([
    db.listEntries(),
    ...keys.map((key) => db.getKV(key)),
  ]);
  const kv = Object.fromEntries(keys.map((key, i) => [key, values[i]])) as Record<KVKey, unknown>;
  return { dictionary, kv, meta: { rev: 0, epoch: 0 } };
}

/**
 * 旧形式（negative を持たない）workspace を画面反映前に移行・保存する。
 * 反映前に完了させることで、再読み込み時の部分反映やアンロック後の遅延上書きを防ぐ。
 */
async function migrateLegacyWorkspaceInSnapshot(data: AppDataSnapshot): Promise<AppDataSnapshot> {
  const rawWorkspace = data.kv.workspace;
  if (rawWorkspace === undefined || hasNegative(rawWorkspace)) return data;
  const migrated = migrateNegative(rawWorkspace, data.kv.settings);
  await db.setKV('workspace', migrated);
  const meta = currentDbMeta() ?? { rev: data.meta.rev + 1, epoch: data.meta.epoch };
  publishTabSync('updated', meta);
  return {
    ...data,
    meta,
    kv: { ...data.kv, workspace: migrated },
  };
}

export interface SyncSnapshot {
  revision: number;
  data: AppDataSnapshot;
}

export interface CommittedSnapshot {
  revision: number;
  kv: Record<KVKey, unknown>;
}

/** 永続化・辞書フックへ渡す同期ブリッジ（モジュールグローバルを持たず React 経由で連携する）。 */
export interface SyncBridge {
  locked: boolean;
  isLocked: () => boolean;
  onStaleWrite: (reason: TabSyncType) => void;
  onPersisted: () => void;
  snapshot: SyncSnapshot | null;
  loadError: string | null;
  committed: CommittedSnapshot | null;
}

interface TabSyncPorts {
  confirmOverwrite: () => Promise<boolean>;
  isReadyToSave: () => boolean;
  captureLocal: () => AppDataReplacement;
  onBeforeReloadApply: () => void;
  resyncToken: () => void;
}

export interface TabSyncController {
  bridge: SyncBridge;
  conflict: TabSyncType | null;
  dbBlocked: boolean;
  busy: boolean;
  error: string | null;
  loadError: string | null;
  reloadCount: number;
  reloadLatest: () => void;
  preferLocal: () => void;
  /** バックアップ復元など全ストアを 1 トランザクションで保存・通知する。未対応環境（部分モック）は false。 */
  commitAll: (replacement: AppDataReplacement) => Promise<boolean>;
}

function mergeConflict(prev: TabSyncType | null, next: TabSyncType): TabSyncType {
  return prev === 'reset' || next === 'reset' ? 'reset' : 'updated';
}

/**
 * 複数タブ間の保存・全削除競合を単一リビジョン＋全量 1 トランザクションで制御する。
 * 再読み込み時も App をアンマウントせず、タブ内メモリの生成画像履歴を維持する。
 */
export function useTabSync(ports: TabSyncPorts): TabSyncController {
  const [resetSignal] = useState(getDataResetSignal);
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<CommittedSnapshot | null>(null);
  const [conflict, setConflict] = useState<TabSyncType | null>(null);
  const [dbBlocked, setDbBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  const portsRef = useRef(ports);
  portsRef.current = ports;
  const conflictRef = useRef<TabSyncType | null>(null);
  const noticeSeqRef = useRef(0);
  const snapshotRevRef = useRef(0);
  const lastLoadedMetaRef = useRef<SyncMeta | null>(null);
  const commitRevRef = useRef(0);
  const busyRef = useRef(false);

  const noteConflict = useCallback((reason: TabSyncType) => {
    noticeSeqRef.current += 1;
    const next = mergeConflict(conflictRef.current, reason);
    conflictRef.current = next;
    setConflict(next);
  }, []);

  const clearConflict = useCallback(() => {
    conflictRef.current = null;
    setConflict(null);
    setError(null);
  }, []);

  // 初回起動時に全ストア＋同期メタを 1 トランザクションで読み込む
  useEffect(() => {
    let active = true;
    const isCurrent = () => active && !resetSignal.aborted;
    loadAllSnapshot()
      .then(async (raw) => {
        if (!isCurrent()) return;
        const data = await migrateLegacyWorkspaceInSnapshot(raw);
        if (!isCurrent()) return;
        lastLoadedMetaRef.current = data.meta;
        const rev = ++snapshotRevRef.current;
        setSnapshot({ revision: rev, data });
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (!isCurrent()) return;
        if (isStaleWriteError(caught)) {
          noteConflict(caught.reason);
          return;
        }
        setLoadError(`保存データを読み込めません: ${String(caught)}`);
      });
    return () => { active = false; };
  }, [noteConflict, resetSignal]);

  // 他タブからの更新・全削除通知および DB ブロック状態を購読する
  useEffect(() => subscribeTabSync((message) => {
    if (isCoveredByLoaded(message.meta, lastLoadedMetaRef.current)) return;
    noteConflict(message.type);
  }), [noteConflict]);

  useEffect(() => (
    'subscribeDbBlocked' in db && typeof db.subscribeDbBlocked === 'function'
      ? db.subscribeDbBlocked(setDbBlocked)
      : undefined
  ), []);

  const isLocked = useCallback(() => conflictRef.current !== null, []);
  const onPersisted = useCallback(() => {
    const meta = currentDbMeta();
    if (meta) lastLoadedMetaRef.current = meta;
    publishTabSync('updated', meta);
  }, []);

  const reloadLatest = useCallback(() => {
    const current = conflictRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const startNoticeSeq = noticeSeqRef.current;
    void (async () => {
      try {
        const raw = await loadAllSnapshot();
        if (resetSignal.aborted) return;
        const data = await migrateLegacyWorkspaceInSnapshot(raw);
        if (resetSignal.aborted) return;
        const epochChanged = lastLoadedMetaRef.current !== null && data.meta.epoch !== lastLoadedMetaRef.current.epoch;
        lastLoadedMetaRef.current = data.meta;
        portsRef.current.onBeforeReloadApply();
        const rev = ++snapshotRevRef.current;
        setSnapshot({ revision: rev, data });
        setLoadError(null);
        setReloadCount((n) => n + 1);
        if (current === 'reset' || epochChanged) portsRef.current.resyncToken();
        if (noticeSeqRef.current === startNoticeSeq) clearConflict();
      } catch (caught) {
        if (isStaleWriteError(caught)) {
          noteConflict(caught.reason);
          setError('読み込みの途中で別のタブが更新したため、もう一度読み込んでください。');
        } else {
          setError(`最新のデータを読み込めません: ${String(caught)}`);
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [clearConflict, noteConflict, resetSignal]);

  const preferLocal = useCallback(() => {
    if (!conflictRef.current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        if (!portsRef.current.isReadyToSave()) {
          setError('読み込みが終わっていないデータがあるため、保存を中止しました');
          return;
        }
        const capturedMeta = 'readSyncMeta' in db && typeof db.readSyncMeta === 'function'
          ? await db.readSyncMeta()
          : { rev: 0, epoch: 0 };
        if (resetSignal.aborted) return;
        const ok = await portsRef.current.confirmOverwrite();
        if (!ok || resetSignal.aborted || !conflictRef.current) return;
        const startNoticeSeq = noticeSeqRef.current;
        const replacement = portsRef.current.captureLocal();
        const nextMeta = await db.replaceAllAppData(replacement, capturedMeta);
        if (resetSignal.aborted) return;
        lastLoadedMetaRef.current = nextMeta;
        const commitRev = ++commitRevRef.current;
        setCommitted({ revision: commitRev, kv: replacement.kv });
        publishTabSync('updated', nextMeta);
        if (noticeSeqRef.current === startNoticeSeq) clearConflict();
      } catch (caught) {
        if (isStaleWriteError(caught)) {
          noteConflict(caught.reason);
          setError(
            caught.reason === 'reset'
              ? '別のタブでデータが削除されたため、保存を中止しました。内容を確認してからもう一度選んでください。'
              : '確認のあとで別のタブが保存したため、もう一度確認してください。',
          );
        } else {
          setError(`このタブの内容を保存できません: ${String(caught)}`);
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [clearConflict, noteConflict, resetSignal]);

  const commitAll = useCallback(async (replacement: AppDataReplacement): Promise<boolean> => {
    if (!('replaceAllAppData' in db) || typeof db.replaceAllAppData !== 'function') return false;
    resetSignal.throwIfAborted();
    if (conflictRef.current !== null) {
      throw new DOMException('別のタブでデータが更新されたため、このタブの保存を停止しています', 'AbortError');
    }
    try {
      const nextMeta = await db.replaceAllAppData(replacement);
      resetSignal.throwIfAborted();
      lastLoadedMetaRef.current = nextMeta;
      portsRef.current.onBeforeReloadApply();
      const rev = ++snapshotRevRef.current;
      // 各フックへスナップショットとして適用することで、正規化後の実参照がそのまま保存基準になり不要な再保存を防ぐ
      setSnapshot({
        revision: rev,
        data: {
          dictionary: [...replacement.dictionary],
          kv: { ...replacement.kv },
          meta: nextMeta,
        },
      });
      setLoadError(null);
      publishTabSync('updated', nextMeta);
      return true;
    } catch (caught) {
      if (isStaleWriteError(caught)) noteConflict(caught.reason);
      throw caught;
    }
  }, [noteConflict, resetSignal]);

  const bridge = useMemo<SyncBridge>(() => ({
    locked: conflict !== null,
    isLocked,
    onStaleWrite: noteConflict,
    onPersisted,
    snapshot,
    loadError,
    committed,
  }), [conflict, isLocked, noteConflict, onPersisted, snapshot, loadError, committed]);

  return {
    bridge,
    conflict,
    dbBlocked,
    busy,
    error,
    loadError,
    reloadCount,
    reloadLatest,
    preferLocal,
    commitAll,
  };
}
