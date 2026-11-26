import type { Subscription } from './novelai';

/** 精密参照 1 枚あたりの追加消費 Anlas。 */
export const PRECISE_REFERENCE_ANLAS = 5;

export interface AnlasEstimateInput {
  /** 取得済みの購読状態。未設定・読み込み中・取得失敗時は null。 */
  subscription: Subscription | null;
  /** ベース生成設定が Opus 無料枠（1024×1024 相当以下・28 steps 以下）に収まるか。 */
  baseIsFree: boolean;
  /** 有効な精密参照の枚数（将来の #130 用。未指定・0 以下は 0 扱い）。 */
  referenceCount?: number;
}

export type AnlasEstimate =
  | { kind: 'exact'; amount: number }
  | { kind: 'paid'; minAdditional: number }
  | { kind: 'unknown'; minAdditional: number };

/** 生成設定と購読状態から、生成前の消費 Anlas を見積もる。 */
export function estimateAnlasCost(input: AnlasEstimateInput): AnlasEstimate {
  const count = Number.isFinite(input.referenceCount) ? Math.max(0, Math.trunc(input.referenceCount!)) : 0;
  const additional = count * PRECISE_REFERENCE_ANLAS;

  if (!input.subscription) {
    return { kind: 'unknown', minAdditional: additional };
  }

  if (input.subscription.tier === 3 && !input.subscription.usage?.isNegative && input.baseIsFree) {
    return { kind: 'exact', amount: additional };
  }

  return { kind: 'paid', minAdditional: additional };
}

/** 見積もり結果を `AnlasLine` 左側の表示文字列へ整形する。 */
export function formatAnlasEstimate(estimate: AnlasEstimate): string {
  switch (estimate.kind) {
    case 'exact':
      return estimate.amount.toLocaleString('ja-JP');
    case 'paid':
      return estimate.minAdditional > 0 ? `+${estimate.minAdditional.toLocaleString('ja-JP')}〜` : '有料';
    case 'unknown':
      return estimate.minAdditional > 0 ? `+${estimate.minAdditional.toLocaleString('ja-JP')}〜` : '—';
  }
}
