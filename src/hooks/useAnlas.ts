import { useCallback, useEffect, useRef, useState } from 'react';
import { describeSubscriptionError, fetchSubscription, type Subscription } from '../lib/novelai';

export type AnlasStatus = 'unset' | 'loading' | 'ready' | 'error';

export interface AnlasState {
  status: AnlasStatus;
  subscription: Subscription | null;
  /** 直前の生成で消費した Anlas。まだ分からなければ null。 */
  lastConsumed: number | null;
  /** 取得失敗の理由（画面に出す短い文）。失敗していなければ null。 */
  error: string | null;
  loading: boolean;
  /** 今すぐ残高を取得し直す。消費の計算はしない。 */
  refresh: () => void;
  /** 生成完了後に呼ぶ。生成前後の残高の差から消費を出す。 */
  refreshAfterGeneration: () => void;
}

/**
 * Anlas 残高の表示用キャッシュ。メモリだけに持ち、IndexedDB やバックアップには
 * 保存しない。トークンが保存・変更されたら取得し直し、生成完了後の取得では
 * 生成前後の残高の差を「直前の生成で消費した Anlas」とする。残高が増えた
 * （期間更新や購入）ときは消費が分からないため「—」に戻す。
 */
export function useAnlas(token: string | null): AnlasState {
  const [status, setStatus] = useState<AnlasStatus>('unset');
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [lastConsumed, setLastConsumed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const prevTotalRef = useRef<number | null>(null);
  const expectDeltaRef = useRef(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const runFetch = useCallback(async (expectDelta: boolean) => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const id = ++requestIdRef.current;
    if (expectDelta) expectDeltaRef.current = true;
    setStatus('loading');
    setError(null);
    try {
      const data = await fetchSubscription(currentToken, controller.signal);
      if (controller.signal.aborted || requestIdRef.current !== id) return;
      const total = data.totalAnlas;
      if (expectDeltaRef.current) {
        const prev = prevTotalRef.current;
        if (prev !== null) {
          const delta = prev - total;
          setLastConsumed(delta >= 0 ? delta : null);
        } else {
          // 比較できる残高がない生成の消費は分からないので「—」にする。
          setLastConsumed(null);
        }
        expectDeltaRef.current = false;
      }
      prevTotalRef.current = total;
      setSubscription(data);
      setStatus('ready');
    } catch (e) {
      if (controller.signal.aborted || requestIdRef.current !== id) return;
      // 取得に失敗したら、差分の基準値は無効化する。失敗した取得の前後で残高が
      // 変わっているかもしれず、次に成功した取得で複数回分の消費を 1 回分として
      // 表示してしまうため。生成後の取得が失敗したときは、その生成の消費は
      // 分からないので消費表示も「—」に戻す。
      prevTotalRef.current = null;
      if (expectDeltaRef.current) setLastConsumed(null);
      expectDeltaRef.current = false;
      setError(describeSubscriptionError(e));
      setStatus('error');
    }
  }, []);

  const refresh = useCallback(() => {
    void runFetch(false);
  }, [runFetch]);

  const refreshAfterGeneration = useCallback(() => {
    void runFetch(true);
  }, [runFetch]);

  // トークンが保存・変更されたら残高を取得し直す。トークンが別の値に変わった
  // ときも、前のトークンの残高・消費が残ったまま表示されないよう、取得前に
  // キャッシュを消す。消えたら表示も消す。
  useEffect(() => {
    controllerRef.current?.abort();
    requestIdRef.current += 1;
    prevTotalRef.current = null;
    expectDeltaRef.current = false;
    setSubscription(null);
    setLastConsumed(null);
    setError(null);
    if (!token) {
      setStatus('unset');
      return;
    }
    void runFetch(false);
  }, [token, runFetch]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { status, subscription, lastConsumed, error, loading: status === 'loading', refresh, refreshAfterGeneration };
}
