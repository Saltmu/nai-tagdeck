import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { parseBackup, toBackupJSON, type Backup, type BackupImportMode } from '../lib/backup';
import { dateStamp, downloadText } from '../lib/browser';
import { BackupImportDialog } from './BackupImportDialog';

interface Props {
  getData: () => Backup;
  onImport: (data: Backup, mode?: BackupImportMode) => Promise<void>;
  notify: (message: string) => void;
  importDisabled?: boolean;
  /** 他タブから再読み込みされた回数。読み込み途中で増えたら保留中の確認を中止する。 */
  reloadCount?: number;
}

interface PendingImport {
  fileName: string;
  data: Backup;
  warnings: string[];
  dictionaryErrors: string[];
  currentCounts?: { dictionary: number; presets: number };
  controller: AbortController;
  startedReloadCount: number;
  /** 確認ダイアログを開いた時点でバックアップ読み込みが無効だったか。 */
  startedImportDisabled: boolean;
}

const RELOAD_ABORT_MESSAGE =
  '別のタブから最新データを読み込んだため、バックアップの読み込みを中止しました。もう一度選択してください';

export function BackupCard({ getData, onImport, notify, importDisabled = false, reloadCount = 0 }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const importingRef = useRef(false);
  const onImportRef = useRef(onImport);
  onImportRef.current = onImport;
  const importDisabledRef = useRef(importDisabled);
  importDisabledRef.current = importDisabled;
  const reloadCountRef = useRef(reloadCount);
  reloadCountRef.current = reloadCount;
  const mountedRef = useRef(true);
  const activeOpAbortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<PendingImport | null>(null);
  pendingRef.current = pending;

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

  // 確認ダイアログを開いている途中で他タブから再読み込みされたら、確認を中止する。
  useEffect(() => {
    if (!pendingRef.current) return;
    setPending(null);
    setError(RELOAD_ABORT_MESSAGE);
  }, [reloadCount]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || importingRef.current) return;
    activeOpAbortRef.current?.abort();
    const controller = new AbortController();
    activeOpAbortRef.current = controller;
    const startedReloadCount = reloadCountRef.current;
    // 読み込み入力は importDisabled の間は無効化されているため、ここに来た時点で
    // 読み込みは許可されていたはず。読み取り中に無効になった場合は、再読み込み
    // などの同期ロックが読み取り中に始まったことを示す。
    const startedImportDisabled = importDisabledRef.current;
    try {
      const parsed = parseBackup(await file.text());
      if (!mountedRef.current) return;
      if (reloadCountRef.current !== startedReloadCount) {
        setError(RELOAD_ABORT_MESSAGE);
        return;
      }
      if (controller.signal.aborted) return;
      if (importDisabledRef.current) {
        // 読み取り中に同期ロックがかかった場合は、再読み込みによる中止として扱う。
        // ロックがかかった時点で読み取り中のバックアップは古いデータに対する
        // ものになるため、読み込み中メッセージではなく中止メッセージを出す。
        // 読み取り開始時点ですでに無効だった場合だけ、従来の読み込み中メッセージを出す。
        setError(
          startedImportDisabled
            ? '保存データの読み込み中または同期ロック中のため、バックアップを読み込めません'
            : RELOAD_ABORT_MESSAGE,
        );
        return;
      }
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setError(null);
      const { data, warnings, dictionaryErrors } = parsed;
      let currentCounts: { dictionary: number; presets: number } | undefined;
      try {
        const current = getData();
        if (Array.isArray(current?.dictionary) && Array.isArray(current?.presets)) {
          currentCounts = { dictionary: current.dictionary.length, presets: current.presets.length };
        }
      } catch {
        currentCounts = undefined;
      }
      setPending({ fileName: file.name, data, warnings, dictionaryErrors, currentCounts, controller, startedReloadCount, startedImportDisabled });
    } finally {
      if (activeOpAbortRef.current === controller) activeOpAbortRef.current = null;
    }
  };

  const handleDialogCancel = () => {
    setPending(null);
  };

  const handleDialogConfirm = async (mode: BackupImportMode) => {
    const confirmed = pendingRef.current;
    setPending(null);
    if (!confirmed) return;
    const { data, controller, startedReloadCount, startedImportDisabled } = confirmed;
    if (controller.signal.aborted || !mountedRef.current) return;
    if (reloadCountRef.current !== startedReloadCount) {
      setError(RELOAD_ABORT_MESSAGE);
      return;
    }
    if (importDisabledRef.current) {
      // 確認ダイアログを開いている間に同期ロックがかかった場合も、読み取り時と
      // 同じく再読み込みによる中止として扱う。
      setError(
        startedImportDisabled
          ? '保存データの読み込み中または同期ロック中のため、バックアップを読み込めません'
          : RELOAD_ABORT_MESSAGE,
      );
      return;
    }
    if (importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    try {
      await onImportRef.current(data, mode);
      if (mountedRef.current) {
        notify(mode === 'replace' ? 'バックアップの内容ですべて置き換えました' : 'バックアップを読み込みました');
      }
    } catch (err) {
      if (mountedRef.current) setError(`読み込めませんでした: ${String(err)}`);
    } finally {
      importingRef.current = false;
      if (mountedRef.current) setImporting(false);
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
      <p className="hint">すべてのデータを削除するときは、下の「Dangerゾーン」を使います。</p>
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
            disabled={importDisabled || importing}
            onChange={handleFile}
          />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <BackupImportDialog
          fileName={pending.fileName}
          data={pending.data}
          warnings={pending.warnings}
          dictionaryErrors={pending.dictionaryErrors}
          currentCounts={pending.currentCounts}
          signal={pending.controller.signal}
          onCancel={handleDialogCancel}
          onConfirm={handleDialogConfirm}
        />
      )}
    </section>
  );
}
