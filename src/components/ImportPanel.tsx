import { useState } from 'react';
import type { ImportMode, ImportResult } from '../lib/io';
import { useDialogs } from './Dialogs';

interface Props {
  fileName: string;
  result: ImportResult;
  existingCount: number;
  onImport: (mode: ImportMode) => Promise<void>;
  onCancel: () => void;
}

const MAX_ERRORS_SHOWN = 10;

export function ImportPanel({ fileName, result, existingCount, onImport, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const dialogs = useDialogs();
  const { entries, errors } = result;

  const run = async (mode: ImportMode) => {
    if (
      mode === 'replace' &&
      !(await dialogs.confirm(
        `今の辞書（${existingCount}件）を消して、読み込んだ ${entries.length}件 に置き換えます。よろしいですか？`,
        { okLabel: '置き換える', danger: true },
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      await onImport(mode);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card import-panel" aria-label="読み込みの確認">
      <p>
        <strong>{fileName}</strong>：{entries.length}件を読み込めます
        {errors.length > 0 && `（${errors.length}件はスキップ）`}
      </p>
      {errors.length > 0 && (
        <ul className="import-errors">
          {errors.slice(0, MAX_ERRORS_SHOWN).map((err) => (
            <li key={err}>{err}</li>
          ))}
          {errors.length > MAX_ERRORS_SHOWN && <li>ほか {errors.length - MAX_ERRORS_SHOWN}件</li>}
        </ul>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || entries.length === 0}
          onClick={() => run('merge')}
          title="同じカテゴリ＋タグは上書きし、新しいものは追加します"
        >
          追加・上書き
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy || entries.length === 0}
          onClick={() => run('replace')}
        >
          すべて置き換え
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </section>
  );
}
