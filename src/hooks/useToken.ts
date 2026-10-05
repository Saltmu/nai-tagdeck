import { useCallback, useState } from 'react';
import { clearToken, loadToken, saveToken, type StoredToken, type TokenStorage } from '../lib/token';

export interface TokenState extends StoredToken {
  save: (token: string, storage: TokenStorage) => boolean;
  clear: () => void;
}

export function useToken(): TokenState {
  const [state, setState] = useState<StoredToken>(loadToken);

  const save = useCallback((token: string, storage: TokenStorage) => {
    const ok = saveToken(token, storage);
    // 保存できない環境でも、このタブを開いている間は使えるようにする
    setState({ token, storage });
    return ok;
  }, []);

  const clear = useCallback(() => {
    clearToken();
    setState({ token: null, storage: 'session' });
  }, []);

  return { ...state, save, clear };
}
