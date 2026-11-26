import type { AnlasState } from '../hooks/useAnlas';
import { formatAnlasEstimate, type AnlasEstimate } from '../lib/anlasEstimate';
import { tierName } from '../lib/novelai';
import { AnlasIcon, RefreshIcon } from './icons';

/** 残高の数字は 3 桁区切りで出す（18000 → 18,000）。 */
export function formatAnlas(value: number): string {
  return value.toLocaleString('ja-JP');
}

function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
  }
  if (totalMinutes > 0) return `${totalMinutes}分`;
  return `${Math.floor(seconds)}秒`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/**
 * 生成ボタンの上に置く 1 行の表示。「消費 xxx / 残高 yyy」の形で、
 * 消費は生成前の見積もり、残高は合計 Anlas（付与分＋購入分）。
 */
export function AnlasLine({ anlas, estimate }: { anlas: AnlasState; estimate: AnlasEstimate }) {
  const { status, subscription, error, loading } = anlas;
  const consumedText = formatAnlasEstimate(estimate);
  const balanceText =
    status === 'unset'
      ? '未設定'
      : status === 'loading'
        ? '読み込み中…'
        : status === 'error'
          ? '取得できませんでした'
          : subscription
            ? formatAnlas(subscription.totalAnlas)
            : '—';
  return (
    <p className="anlas-line" role="status">
      <AnlasIcon />
      <span>
        消費 {consumedText} / 残高 {balanceText}
      </span>
      {status !== 'unset' && (
        <button
          type="button"
          className="btn btn-small anlas-refresh"
          onClick={anlas.refresh}
          disabled={loading}
          aria-label="残高を更新"
          title="残高を更新"
        >
          <RefreshIcon />
        </button>
      )}
      {status === 'error' && error && <span className="anlas-error">{error}</span>}
    </p>
  );
}

/**
 * 設定画面のトークン欄に置く詳細。プラン名、付与分・購入分の内訳、
 * Opus の V5 利用枠（Opus のときだけ）、付与分の期間終了時リセットを出す。
 */
export function AnlasDetails({ anlas }: { anlas: AnlasState }) {
  const { status, subscription, error, loading } = anlas;
  if (status === 'unset') {
    return <p className="hint">トークンを保存すると、Anlas 残高とプランがここに表示されます。</p>;
  }
  if (status === 'loading' && !subscription) {
    return (
      <p className="hint" role="status">
        Anlas 残高を読み込み中…
      </p>
    );
  }
  if (status === 'error' && !subscription) {
    return (
      <div className="anlas-details">
        <p className="form-error" role="alert">
          Anlas 残高を取得できませんでした。{error}
        </p>
        <button type="button" className="btn btn-small" onClick={anlas.refresh} disabled={loading}>
          残高を更新
        </button>
      </div>
    );
  }
  if (!subscription) return null;
  const { tier, fixedTrainingStepsLeft, purchasedTrainingSteps, totalAnlas, expiresAt, usage } = subscription;
  const showUsage = tier === 3 && usage !== null;
  const untilNext = usage?.timeUntilNextPercent !== null && usage?.timeUntilNextPercent !== undefined
    ? formatDuration(usage.timeUntilNextPercent)
    : '';
  return (
    <dl className="anlas-details">
      <div>
        <dt>プラン</dt>
        <dd>{tierName(tier)}</dd>
      </div>
      <div>
        <dt>残高</dt>
        <dd>
          {formatAnlas(totalAnlas)} Anlas（付与分 {formatAnlas(fixedTrainingStepsLeft)}／購入分{' '}
          {formatAnlas(purchasedTrainingSteps)}）
        </dd>
      </div>
      {showUsage && usage && (
        <div>
          <dt>V5 利用枠</dt>
          <dd>
            {formatPercent(usage.percent)}%
            {usage.isNegative ? '（利用枠を超過しています）' : ''}
            {untilNext ? `／次の1%回復まであと${untilNext}` : ''}
          </dd>
        </div>
      )}
      <div>
        <dt>付与分のリセット</dt>
        <dd>
          付与分の Anlas は期間の終了時にリセットされます
          {expiresAt !== null ? `（次回更新日：${formatDate(expiresAt)}）` : ''}
        </dd>
      </div>
    </dl>
  );
}
