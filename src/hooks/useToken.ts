import { useCallback, useEffect, useState } from 'react';
import {
  TOKEN_STORAGE_KEY,
  clearToken,
  loadToken,
  saveToken,
  type StoredToken,
  type TokenStorage,
} from '../lib/token';

export interface TokenState extends StoredToken {
  save: (token: string, storage: TokenStorage) => boolean;
  clear: () => void;
  /** 保存先を読み直し、他タブが削除したトークンをメモリから外す。 */
  resync: () => void;
}

interface InternalTokenState extends StoredToken {
  memoryOnly: boolean;
}

export function useToken(): TokenState {
  const [state, setState] = useState<InternalTokenState>(() => ({ ...loadToken(), memoryOnly: false }));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== TOKEN_STORAGE_KEY) return;
      setState((prev) => {
        if (prev.memoryOnly) return prev;
        const next = loadToken();
        return prev.token === next.token && prev.storage === next.storage
          ? prev
          : { ...next, memoryOnly: false };
      });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const save = useCallback((token: string, storage: TokenStorage) => {
    const ok = saveToken(token, storage);
    // 保存できない環境でも、このタブを開いている間は使えるようにする
    setState({ token, storage, memoryOnly: !ok });
    return ok;
  }, []);

  const clear = useCallback(() => {
    clearToken();
    setState({ token: null, storage: 'session', memoryOnly: false });
  }, []);

  const resync = useCallback(() => {
    setState((prev) => {
      if (prev.memoryOnly) return prev;
      const next = loadToken();
      return prev.token === next.token && prev.storage === next.storage ? prev : { ...next, memoryOnly: false };
    });
  }, []);

  return { token: state.token, storage: state.storage, save, clear, resync };
}
