import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { backupImportMessage, type Backup, type BackupImportMode } from '../lib/backup';

interface Props {
  fileName: string;
  data: Pick<Backup, 'dictionary' | 'presets'>;
  warnings: readonly string[];
  dictionaryErrors: readonly string[];
  currentCounts?: { dictionary: number; presets: number };
  /** 中断されたら、このダイアログだけをキャンセルとして閉じる。 */
  signal?: AbortSignal;
  onCancel: () => void;
  onConfirm: (mode: BackupImportMode) => void;
}

/**
 * バックアップ読み込みの確認ダイアログ。取り込み方法（追加・上書き／すべて置き換え）を
 * ラジオで選び、選択に応じて確認文言・実行ボタンを切り替える。
 * 置き換え選択時は実行ボタンへフォーカスを置かず、キャンセルへフォーカスして
 * Enter 連打での即確定を避ける。
 */
export function BackupImportDialog({
  fileName,
  data,
  warnings,
  dictionaryErrors,
  currentCounts,
  signal,
  onCancel,
  onConfirm,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<BackupImportMode>('merge');
  const [scrollable, setScrollable] = useState(false);
  const settled = useRef(false);
  const id = useId();
  const message = backupImportMessage(fileName, data, warnings, dictionaryErrors, mode, currentCounts);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const overflows = () => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
    const update = () => setScrollable(overflows());
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.summary, message.details]);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    const resetScroll = () => {
      if (dialog.current) dialog.current.scrollTop = 0;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    };
    resetScroll();
    const element = scrollRef.current;
    if (element) {
      setScrollable(element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);
    }
    // merge は実行ボタン、replace はキャンセルへフォーカスする。
    (mode === 'replace' ? cancel.current : primary.current)?.focus({ preventScroll: true });
    resetScroll();
    const frame = requestAnimationFrame(resetScroll);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // モードが replace に切り替わったら、Enter 連打で確定しないようキャンセルへフォーカスを移す。
  useEffect(() => {
    if (mode === 'replace') cancel.current?.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    if (!signal) return;
    if (signal.aborted) {
      onCancel();
      return;
    }
    const onAbort = () => onCancel();
    signal.addEventListener('abort', onAbort, { once: true });
    return () => signal.removeEventListener('abort', onAbort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);

  const settle = (confirmed: boolean) => {
    if (settled.current) return;
    settled.current = true;
    dialog.current?.close();
    if (confirmed) onConfirm(mode);
    else onCancel();
  };

  return (
    <dialog
      ref={dialog}
      className="app-dialog app-dialog-confirm"
      aria-labelledby={`${id}-msg`}
      onClose={() => settle(false)}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          // replace 選択時は Enter での即確定を避け、ボタン操作でのみ確定させる。
          if (mode === 'replace') return;
          settle(true);
        }}
      >
        <div ref={scrollRef} className="app-dialog-scroll" tabIndex={scrollable ? 0 : undefined}>
          <p id={`${id}-msg`} className="app-dialog-message">
            {message.summary}
          </p>
          {message.details && <div className="app-dialog-details">{message.details}</div>}
        </div>
        <fieldset className="backup-import-modes">
          <legend>辞書・プリセットの取り込み方法</legend>
          <label className="backup-import-mode">
            <input
              type="radio"
              name={`${id}-mode`}
              value="merge"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
            />
            <span>
              <span className="backup-import-mode-label">追加・上書き（既定）</span>
              <span className="backup-import-mode-desc">
                既存の辞書・プリセットを残し、同じ項目だけバックアップで上書きする
              </span>
            </span>
          </label>
          <label className="backup-import-mode">
            <input
              type="radio"
              name={`${id}-mode`}
              value="replace"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            <span>
              <span className="backup-import-mode-label">すべて置き換え</span>
              <span className="backup-import-mode-desc">
                既存の辞書・プリセットをすべて削除し、バックアップの内容だけで置き換える
              </span>
            </span>
          </label>
        </fieldset>
        {mode === 'replace' && (
          <p className="backup-import-danger" role="note">
            現在の辞書・プリセットはすべて削除され、バックアップにない項目は元に戻せません。作業中のタグと設定も置き換わります。
          </p>
        )}
        <div className="app-dialog-actions">
          <button ref={cancel} type="button" className="btn" onClick={() => settle(false)}>
            キャンセル
          </button>
          <button
            ref={primary}
            type="submit"
            className={`btn ${mode === 'replace' ? 'btn-danger' : 'btn-primary'}`}
          >
            {mode === 'replace' ? 'すべて置き換えて読み込む' : '読み込む'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
