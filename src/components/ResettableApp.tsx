import { useEffect, useState } from 'react';
import App from '../App';
import { resetAppData } from '../lib/reset';

/** 削除中はアプリを外して自動保存のタイマーを止め、成功後に新しい状態で起動する。 */
export function ResettableApp() {
  const [status, setStatus] = useState<'idle' | 'resetting' | 'failed'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'resetting') return;
    let active = true;
    resetAppData().then(() => {
      if (active) setStatus('idle');
    }).catch((err: unknown) => {
      if (!active) return;
      setError(String(err));
      setStatus('failed');
    });
    return () => { active = false; };
  }, [status]);

  if (status === 'idle') return <App onResetAll={() => setStatus('resetting')} />;

  return (
    <main className="app-main">
      <section className="card" aria-busy={status === 'resetting'}>
        {status === 'resetting' ? (
          <p role="status">設定とデータを削除しています…</p>
        ) : (
          <>
            <p className="form-error" role="alert">削除を完了できませんでした。一部のデータは削除済みの可能性があります。{error}</p>
            <button type="button" className="btn btn-danger" onClick={() => setStatus('resetting')}>削除を再試行</button>
          </>
        )}
      </section>
    </main>
  );
}
