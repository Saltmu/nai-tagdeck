import { useEffect, useState } from 'react';
import { dismissSwUpdate, requestSwSkipWaiting, subscribeSwUpdate, type SwWaitingWorker } from '../lib/swUpdate';

/** 制御中のページに新しい Service Worker が待っているときだけ出す。 */
export function SwUpdateNotice() {
  const [waiting, setWaiting] = useState<SwWaitingWorker | null>(null);
  useEffect(() => subscribeSwUpdate(setWaiting), []);
  if (!waiting) return null;
  return (
    <div className="sw-update" role="region" aria-label="アプリの更新">
      <p>新しいバージョンがあります。再読み込みすると反映されます。</p>
      <button type="button" className="btn btn-primary btn-small" onClick={() => requestSwSkipWaiting(waiting)}>
        再読み込み
      </button>
      <button type="button" className="btn btn-small" onClick={() => dismissSwUpdate()}>
        あとで
      </button>
    </div>
  );
}
