import { useId, useState } from 'react';

interface Props {
  onReset: () => void;
}

export function DangerZone({ onReset }: Props) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="card danger-zone" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="card-title">Dangerゾーン</h2>
      <p>このブラウザに保存されたすべての設定とデータを削除し、初期状態に戻します。</p>
      <p className="hint">
        辞書・プリセット・作業中のタグとキャラクター・生成設定・トークン・カテゴリと生成エリアの開閉状態が削除されます。
        生成画像も消えます。必要なデータは上のバックアップから書き出し、画像はダウンロードしてください。
      </p>
      {confirming ? (
        <div className="danger-confirm" role="group" aria-labelledby={`${id}-confirm`}>
          <p id={`${id}-confirm`}>本当にすべて削除しますか？ この操作は取り消せません。</p>
          <div className="form-actions">
            <button type="button" className="btn btn-danger" onClick={onReset}>すべて削除する</button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} autoFocus>キャンセル</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>すべての設定とデータを削除</button>
      )}
    </section>
  );
}
