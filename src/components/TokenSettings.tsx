import { useId, useState, type FormEvent } from 'react';
import type { TokenState } from '../hooks/useToken';
import { maskToken, normalizeToken, validateToken, type TokenStorage } from '../lib/token';

interface Props {
  token: TokenState;
  notify: (message: string) => void;
}

const STORAGE_LABEL: Record<TokenStorage, string> = {
  session: 'このタブだけ（タブを閉じると消える）',
  local: 'このブラウザに保存（次回も使える）',
};

export function TokenSettings({ token, notify }: Props) {
  const id = useId();
  const [input, setInput] = useState('');
  const [storage, setStorage] = useState<TokenStorage>(token.storage);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = normalizeToken(input);
    if (!value) return;
    const validationError = validateToken(value);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    const ok = token.save(value, storage);
    setInput('');
    notify(ok ? 'トークンを保存しました' : 'ブラウザに保存できないため、このタブを開いている間だけ使います');
  };

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="card-title">
        NovelAI のトークン
      </h2>
      <p className="token-status">
        {token.token ? (
          <>
            設定済み <code>{maskToken(token.token)}</code>（{STORAGE_LABEL[token.storage]}）
            <button
              type="button"
              className="btn btn-small btn-danger"
              onClick={() => {
                token.clear();
                notify('トークンを削除しました');
              }}
            >
              削除
            </button>
          </>
        ) : (
          '未設定'
        )}
      </p>

      <form className="token-form" onSubmit={submit}>
        <label className="field" htmlFor={`${id}-token`}>
          <span>{token.token ? '新しいトークンに置き換える' : 'トークン'}</span>
          <input
            id={`${id}-token`}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="pst-…"
            value={input}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <fieldset className="radio-group">
          <legend>保存先</legend>
          {(['session', 'local'] as const).map((kind) => (
            <label key={kind} className="radio">
              <input
                type="radio"
                name={`${id}-storage`}
                value={kind}
                checked={storage === kind}
                onChange={() => setStorage(kind)}
              />
              {STORAGE_LABEL[kind]}
            </label>
          ))}
        </fieldset>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!normalizeToken(input)}>
            保存
          </button>
        </div>
      </form>
      <p className="hint">
        NovelAI のアカウント設定にある「Get Persistent API Token」で発行したトークンを使います。
        トークンは NovelAI への通信のヘッダーにだけ使い、このサイトのサーバーには送りません。
        共用の端末では「このタブだけ」を選んでください。
      </p>
    </section>
  );
}
