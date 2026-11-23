import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  clearTabSyncConflict,
  getTabSyncConflict,
  getTabSyncEpoch,
  startTabSync,
  subscribeTabSyncConflict,
  type TabSyncConflict,
} from '../lib/tabSync';

interface TabSyncPorts {
  confirmOverwrite: () => Promise<boolean>;
  /** 画面を破棄せず、IndexedDB の最新値を読み直す。 */
  reloadStores: () => Promise<void>;
  /** ロックを残したまま、このタブの内容を書き戻して他タブへ通知する。 */
  saveLocal: (conflict: TabSyncConflict) => Promise<void>;
  resyncToken: () => void;
}

export interface TabSyncController {
  conflict: TabSyncConflict | null;
  busy: boolean;
  error: string | null;
  reloadLatest: () => void;
  preferLocal: () => void;
}

/**
 * 他タブの保存・全削除を受けて自動保存を止め、読み込み直すかこのタブを優先して保存する。
 * 生成画像の履歴は reloadStores 側で残す（ページは再読み込みしない）。
 */
export function useTabSync(ports: TabSyncPorts): TabSyncController {
  const conflict = useSyncExternalStore(subscribeTabSyncConflict, getTabSyncConflict, () => null);
  const portsRef = useRef(ports);
  portsRef.current = ports;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startTabSync();
  }, []);

  const reloadLatest = useCallback(() => {
    const current = getTabSyncConflict();
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const epoch = getTabSyncEpoch();
    const kind = current.kind;
    void (async () => {
      try {
        await portsRef.current.reloadStores();
        if (kind === 'reset') portsRef.current.resyncToken();
        if (getTabSyncEpoch() === epoch) clearTabSyncConflict();
      } catch (caught) {
        setError(`最新のデータを読み込めません: ${String(caught)}`);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, []);

  const preferLocal = useCallback(() => {
    const current = getTabSyncConflict();
    if (!current || busyRef.current) return;
    void (async () => {
      const ok = await portsRef.current.confirmOverwrite();
      const latest = getTabSyncConflict();
      if (!ok || !latest || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const epoch = getTabSyncEpoch();
      try {
        await portsRef.current.saveLocal(latest);
        if (getTabSyncEpoch() === epoch) clearTabSyncConflict();
      } catch (caught) {
        setError(`このタブの内容を保存できません: ${String(caught)}`);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, []);

  return { conflict, busy, error, reloadLatest, preferLocal };
}
