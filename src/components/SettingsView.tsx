import type { TokenState } from '../hooks/useToken';
import { TokenSettings } from './TokenSettings';
import { BackupCard } from './BackupCard';
import type { Backup } from '../lib/backup';
import { DangerZone } from './DangerZone';

interface Props {
  token: TokenState;
  notify: (message: string) => void;
  getBackup: () => Backup;
  onImportBackup: (data: Backup) => Promise<void>;
  onResetAll: () => void;
  onShowFirstRun: () => void;
  firstRunDisabled: boolean;
}

export function SettingsView({ token, notify, getBackup, onImportBackup, onResetAll, onShowFirstRun, firstRunDisabled }: Props) {
  return (
    <div className="settings">
      <section className="card" aria-label="使い方">
        <h2 className="card-title">使い方</h2>
        <p className="hint">サンプルと初期辞書の読み込みを選び直せます。辞書と保存済みプリセットは残ります。作業中のタグをサンプルで置き換える前には確認します。</p>
        <button type="button" className="btn" disabled={firstRunDisabled} onClick={onShowFirstRun}>
          初回案内をもう一度表示
        </button>
      </section>
      <TokenSettings token={token} notify={notify} />
      <BackupCard getData={getBackup} onImport={onImportBackup} notify={notify} />
      <DangerZone onReset={onResetAll} />
    </div>
  );
}
