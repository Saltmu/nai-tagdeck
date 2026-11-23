import type { TabSyncConflict } from '../lib/tabSync';

interface Props {
  conflict: TabSyncConflict | null;
  busy: boolean;
  error: string | null;
  onReload: () => void;
  onPrefer: () => void;
}

/** 他タブの更新で自動保存を止めているあいだ、ヘッダー直下に出す。 */
export function TabSyncNotice({ conflict, busy, error, onReload, onPrefer }: Props) {
  if (!conflict) return null;
  const message = conflict.kind === 'reset'
    ? '別のタブですべてのデータが削除されました。このタブの自動保存を停止しています。'
    : '別のタブでデータが更新されました。上書きを防ぐため、このタブの自動保存を停止しています。';
  return (
    <div className="tab-sync" role="region" aria-label="別タブでの更新">
      <p>{message}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="btn btn-primary btn-small" onClick={onReload} disabled={busy}>
        最新のデータを読み込む
      </button>
      <button type="button" className="btn btn-small" onClick={onPrefer} disabled={busy}>
        このタブの内容を優先して保存する
      </button>
    </div>
  );
}
