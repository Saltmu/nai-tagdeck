import type { TabSyncType } from '../lib/tabSync';

interface Props {
  conflict: TabSyncType | null;
  dbBlocked: boolean;
  busy: boolean;
  error: string | null;
  onReload: () => void;
  onPrefer: () => void;
}

/** 他タブの更新で自動保存を止めている間、または旧タブにより DB 更新待ちの間、ヘッダー直下に出す。 */
export function TabSyncNotice({ conflict, dbBlocked, busy, error, onReload, onPrefer }: Props) {
  if (!conflict && !dbBlocked) return null;
  if (!conflict && dbBlocked) {
    return (
      <div className="tab-sync" role="alert">
        <p>古いバージョンの別タブが開いているため保存データを読み込めません。他のタブを閉じるか再読み込みしてください。</p>
      </div>
    );
  }
  const message = conflict === 'reset'
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
