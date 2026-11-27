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
 * ドックバーに統合する Anlas 残高表示。閉じた状態でも残高と更新ボタンを常時確認できる。
 */
export function AnlasBalance({ anlas }: { anlas: AnlasState }) {
  const { status, subscription, error, loading } = anlas;
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
    <div className={`dock-anlas${status === 'error' ? ' is-error' : ''}`} role="status">
      <AnlasIcon />
      <span className="dock-anlas-text">残高 {balanceText}</span>
      {status !== 'unset' && (
        <button
          type="button"
          className="icon-btn anlas-refresh"
          onClick={anlas.refresh}
          disabled={loading}
          aria-label="残高を更新"
          title="残高を更新"
        >
          <RefreshIcon />
        </button>
      )}
      {status === 'error' && error && <span className="anlas-error">{error}</span>}
    </div>
  );
}

/**
 * 「生成する」ボタンの右上にオーバーレイ表示する消費見積 Anlas バッジ。
 */
export function AnlasCostBadge({ estimate, id }: { estimate: AnlasEstimate; id?: string }) {
  const consumedText = formatAnlasEstimate(estimate);
  const isPaid =
    (estimate.kind === 'exact' && estimate.amount > 0) ||
    estimate.kind === 'paid' ||
    (estimate.kind === 'unknown' && estimate.minAdditional > 0);
  const ariaLabel =
    estimate.kind === 'exact'
      ? `消費見積 ${consumedText} Anlas`
      : estimate.kind === 'paid'
        ? `消費見積 ${consumedText}`
        : estimate.minAdditional > 0
          ? `消費見積 ${consumedText} Anlas`
          : '消費見積 不明';
  return (
    <span
      id={id}
      className={`gen-cost-badge${isPaid ? ' is-paid' : ''}`}
      role="status"
      aria-label={ariaLabel}
    >
      <AnlasIcon />
      <span>{consumedText}</span>
    </span>
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
