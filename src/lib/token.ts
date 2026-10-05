/**
 * NovelAI のトークンはソースやサーバーには置かず、画面から入力してブラウザにだけ保存する。
 * session: タブを閉じると消える / local: このブラウザに残る。
 */
export type TokenStorage = 'session' | 'local';

const KEY = 'nai-tagdeck.token';

function storage(kind: TokenStorage): Storage | null {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function read(kind: TokenStorage): string | null {
  try {
    return storage(kind)?.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export interface StoredToken {
  token: string | null;
  storage: TokenStorage;
}

export function loadToken(): StoredToken {
  const session = read('session');
  if (session) return { token: session, storage: 'session' };
  const local = read('local');
  if (local) return { token: local, storage: 'local' };
  return { token: null, storage: 'session' };
}

export function clearToken(): void {
  for (const kind of ['session', 'local'] as const) {
    try {
      storage(kind)?.removeItem(KEY);
    } catch {
      // 保存できない環境では何もしない
    }
  }
}

/** 選んだ保存先だけに残す（もう一方からは消す）。保存できなければ false。 */
export function saveToken(token: string, kind: TokenStorage): boolean {
  clearToken();
  try {
    storage(kind)?.setItem(KEY, token);
    return read(kind) === token;
  } catch {
    return false;
  }
}

/** 貼り付けたときの前後の空白や「Bearer 」を取り除く。 */
export function normalizeToken(input: string): string {
  return input.trim().replace(/^Bearer\s+/i, '').trim();
}

export function maskToken(token: string): string {
  return token.length <= 10 ? '••••' : `${token.slice(0, 4)}…${token.slice(-4)}`;
}
