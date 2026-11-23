import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { backupImportMessage, parseBackup, toBackupJSON, type Backup } from '../lib/backup';
import { dateStamp, downloadText } from '../lib/browser';
import { useDialogs } from './Dialogs';

interface Props {
  getData: () => Backup;
  onImport: (data: Backup) => Promise<void>;
  notify: (message: string) => void;
  importDisabled?: boolean;
  /** 他タブから再読み込みされた回数。読み込み途中で増えたら保留中の確認を中止する。 */
  reloadCount?: number;
}

export function BackupCard({ getData, onImport, notify, importDisabled = false, reloadCount = 0 }: Props) {
  const dialogs = useDialogs();
  const [error, setError] = useState<string | null>(null);
  const onImportRef = useRef(onImport);
  onImportRef.current = onImport;
  const importDisabledRef = useRef(importDisabled);
  importDisabledRef.current = importDisabled;
  const reloadCountRef = useRef(reloadCount);
  reloadCountRef.current = reloadCount;
  const mountedRef = useRef(true);
  const activeOpAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeOpAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    activeOpAbortRef.current?.abort();
  }, [reloadCount]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    activeOpAbortRef.current?.abort();
    const controller = new AbortController();
    activeOpAbortRef.current = controller;
    const startedReloadCount = reloadCountRef.current;
    try {
      const parsed = parseBackup(await file.text());
      if (!mountedRef.current) return;
      if (reloadCountRef.current !== startedReloadCount) {
        setError('別のタブから最新データを読み込んだため、バックアップの読み込みを中止しました。もう一度選択してください');
        return;
      }
      if (controller.signal.aborted) return;
      if (importDisabledRef.current) {
        setError('保存データの読み込み中または同期ロック中のため、バックアップを読み込めません');
        return;
      }
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setError(null);
      const { data, warnings, dictionaryErrors } = parsed;
      const message = backupImportMessage(file.name, data, warnings, dictionaryErrors);
      const ok = await dialogs.confirm(message.summary, {
        okLabel: '読み込む',
        details: message.details || undefined,
        signal: controller.signal,
      });
      if (!ok || controller.signal.aborted || !mountedRef.current) return;
      if (reloadCountRef.current !== startedReloadCount) {
        setError('別のタブから最新データを読み込んだため、バックアップの読み込みを中止しました。もう一度選択してください');
        return;
      }
      if (importDisabledRef.current) {
        setError('保存データの読み込み中または同期ロック中のため、バックアップを読み込めません');
        return;
      }
      try {
        await onImportRef.current(data);
        if (mountedRef.current) notify('バックアップを読み込みました');
      } catch (err) {
        if (mountedRef.current) setError(`読み込めませんでした: ${String(err)}`);
      }
    } finally {
      if (activeOpAbortRef.current === controller) activeOpAbortRef.current = null;
    }
  };

  return (
    <section className="card" aria-labelledby="backup-title">
      <h2 id="backup-title" className="card-title">
        バックアップ
      </h2>
      <p className="hint">
        辞書・プリセット・作業中のタグ・設定を1つのファイルにまとめます。データはブラウザごとに保存されるので、
        別の端末やサイトに移すときに使います。トークンは含めません。
      </p>
      <div className="form-actions backup-actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            downloadText(`nai-tagdeck-backup-${dateStamp()}.json`, toBackupJSON(getData()), 'application/json')
          }
        >
          バックアップを書き出す
        </button>
        <label className="btn file-btn">
          バックアップを読み込む
          <input
            type="file"
            className="visually-hidden"
            accept=".json,application/json"
            disabled={importDisabled}
            onChange={handleFile}
          />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
