import { useState, type ChangeEvent } from 'react';
import { parseBackup, toBackupJSON, type Backup } from '../lib/backup';
import { dateStamp, downloadText } from '../lib/browser';
import { useDialogs } from './Dialogs';

interface Props {
  getData: () => Backup;
  onImport: (data: Backup) => Promise<void>;
  notify: (message: string) => void;
}

export function BackupCard({ getData, onImport, notify }: Props) {
  const dialogs = useDialogs();
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const { data, warnings } = parsed;
    const ok = await dialogs.confirm(
      [
        `${file.name} を読み込みます。`,
        `・辞書 ${data.dictionary.length}件、プリセット ${data.presets.length}件を追加・上書きします`,
        '・作業中のタグと設定（ネガティブ・生成の設定）は置き換わります',
        warnings.length ? `・辞書のうち ${warnings.length}件は読めなかったためスキップします` : '',
        '',
        'よろしいですか？',
      ]
        .filter(Boolean)
        .join('\n'),
      { okLabel: '読み込む' },
    );
    if (!ok) return;
    try {
      await onImport(data);
      notify('バックアップを読み込みました');
    } catch (err) {
      setError(`読み込めませんでした: ${String(err)}`);
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
          書き出し
        </button>
        <label className="btn file-btn">
          読み込み
          <input type="file" className="visually-hidden" accept=".json,application/json" onChange={handleFile} />
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
