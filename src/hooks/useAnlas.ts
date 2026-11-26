import { useCallback, useEffect, useRef, useState } from 'react';
import { describeSubscriptionError, fetchSubscription, type Subscription } from '../lib/novelai';

export type AnlasStatus = 'unset' | 'loading' | 'ready' | 'error';

export interface AnlasState {
  status: AnlasStatus;
  subscription: Subscription | null;
  /** 取得失敗の理由（画面に出す短い文）。失敗していなければ null。 */
  error: string | null;
  loading: boolean;
  /** 今すぐ残高を取得し直す。 */
  refresh: () => void;
}

/**
 * Anlas 残高の表示用キャッシュ。メモリだけに持ち、IndexedDB やバックアップには
 * 保存しない。トークンが保存・変更されたら取得し直し、生成完了後も呼び出し側から
 * refresh() で最新残高を取得し直す。
 */
export function useAnlas(token: string | null): AnlasState {
  const [status, setStatus] = useState<AnlasStatus>('unset');
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const runFetch = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const id = ++requestIdRef.current;
    setStatus('loading');
    setError(null);
    try {
      const data = await fetchSubscription(currentToken, controller.signal);
      if (controller.signal.aborted || requestIdRef.current !== id) return;
      setSubscription(data);
      setStatus('ready');
    } catch (e) {
      if (controller.signal.aborted || requestIdRef.current !== id) return;
      setError(describeSubscriptionError(e));
      setStatus('error');
    }
  }, []);

  const refresh = useCallback(() => {
    void runFetch();
  }, [runFetch]);

  // トークンが保存・変更されたら残高を取得し直す。トークンが別の値に変わった
  // ときも、前のトークンの残高が残ったまま表示されないよう、取得前に
  // キャッシュを消す。消えたら表示も消す。
  useEffect(() => {
    controllerRef.current?.abort();
    requestIdRef.current += 1;
    setSubscription(null);
    setError(null);
    if (!token) {
      setStatus('unset');
      return;
    }
    void runFetch();
  }, [token, runFetch]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { status, subscription, error, loading: status === 'loading', refresh };
}
