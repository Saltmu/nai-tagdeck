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
}

export function SettingsView({ token, notify, getBackup, onImportBackup, onResetAll }: Props) {
  return (
    <div className="settings">
      <TokenSettings token={token} notify={notify} />
      <BackupCard getData={getBackup} onImport={onImportBackup} notify={notify} />
      <DangerZone onReset={onResetAll} />
    </div>
  );
}
