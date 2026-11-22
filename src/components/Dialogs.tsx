import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

/** window.confirm / prompt / alert の代わりに、アプリ内で描画するダイアログ。 */
export interface DialogApi {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string, options?: { okLabel?: string }) => Promise<string | null>;
  alert: (message: string) => Promise<void>;
  /** ボタンを複数並べて選ばせる。キャンセル（Esc を含む）なら null。 */
  choose: <V extends string>(message: string, choices: readonly Choice<V>[], options?: ChooseOptions) => Promise<V | null>;
}

export interface DialogLink {
  label: string;
  description?: string;
  href: string;
}

export interface ChooseOptions {
  dismissOnBackdrop?: boolean;
  /** メッセージの上に出す見出し。 */
  title?: string;
  /** 選択肢の下に出す別タブリンク。 */
  links?: readonly DialogLink[];
  /** 選択肢の下に小さく出す補足。 */
  note?: string;
}

export interface Choice<V extends string = string> {
  value: V;
  label: string;
  /** Enter で選ばれる主ボタンにする（1つだけ）。 */
  primary?: boolean;
  danger?: boolean;
  /** ボタンの中にラベルと並べて出す説明。1つでもあれば選択肢を縦に並べる。 */
  description?: string;
}

export interface ConfirmOptions {
  okLabel?: string;
  /** 削除など、取り消せない操作のとき赤いボタンにする。 */
  danger?: boolean;
  /** 本文の下に、高さ制限つきで出す詳細。 */
  details?: string;
}

type Request = { id: number } & (
  | { kind: 'confirm'; message: string; okLabel?: string; danger?: boolean; details?: string; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; defaultValue: string; okLabel?: string; resolve: (v: string | null) => void }
  | { kind: 'alert'; message: string; resolve: () => void }
  | ({ kind: 'choose'; message: string; choices: readonly Choice[]; resolve: (v: string | null) => void } & ChooseOptions)
);
type NewRequest = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;

const DialogContext = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialogs は DialogProvider の中で使ってください');
  return api;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  // 同時に複数出たときは順番に表示する
  const [queue, setQueue] = useState<Request[]>([]);
  const nextId = useRef(0);
  const push = useCallback((req: NewRequest) => {
    const id = ++nextId.current;
    setQueue((q) => [...q, { ...req, id } as Request]);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (message, options) =>
        new Promise((resolve) => push({ kind: 'confirm', message, ...options, resolve })),
      prompt: (message, defaultValue = '', options) =>
        new Promise((resolve) => push({ kind: 'prompt', message, defaultValue, ...options, resolve })),
      alert: (message) => new Promise((resolve) => push({ kind: 'alert', message, resolve })),
      choose: <V extends string>(message: string, choices: readonly Choice<V>[], options?: ChooseOptions) =>
        new Promise<V | null>((resolve) =>
          push({ kind: 'choose', message, choices, ...options, resolve: resolve as (v: string | null) => void }),
        ),
    }),
    [push],
  );

  const current = queue[0];
  const finish = useCallback(() => setQueue((q) => q.slice(1)), []);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <AppDialog key={current.id} request={current} onDone={finish} />}
    </DialogContext.Provider>
  );
}

function AppDialog({ request, onDone }: { request: Request; onDone: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(request.kind === 'prompt' ? request.defaultValue : '');
  const settled = useRef(false);
  const id = useId();

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    // autoFocus は showModal より先に効いてしまい、先頭の「キャンセル」にフォーカスが移るので、開いた後で当て直す。
    // preventScroll は、長い確認文の先頭を画面外へ押し出さないため。
    const focusWithoutScroll = (element: HTMLElement | null) => element?.focus({ preventScroll: true });
    if (request.kind === 'prompt') {
      focusWithoutScroll(input.current);
      input.current?.select();
    } else if (request.kind === 'confirm' && request.danger) focusWithoutScroll(cancel.current);
    else focusWithoutScroll(primary.current);
  }, [request]);

  // choice: choose で押されたボタンの値（Enter で主ボタンを押したときは省略）
  const settle = (ok: boolean, choice?: string) => {
    if (settled.current) return;
    settled.current = true;
    if (request.kind === 'confirm') request.resolve(ok);
    else if (request.kind === 'prompt') request.resolve(ok ? value : null);
    else if (request.kind === 'choose') {
      request.resolve(ok ? (choice ?? request.choices.find((c) => c.primary)?.value ?? null) : null);
    } else request.resolve();
    dialog.current?.close();
    onDone();
  };

  const okLabel = request.kind === 'confirm' || request.kind === 'prompt' ? (request.okLabel ?? 'OK') : 'OK';
  const danger = request.kind === 'confirm' && request.danger;
  // 説明付きの選択肢は縦に並べ、下の行にはキャンセルだけを残す
  const stacked = request.kind === 'choose' && request.choices.some((c) => c.description);

  return (
    <dialog
      ref={dialog}
      className={request.kind === 'confirm' ? 'app-dialog app-dialog-confirm' : 'app-dialog'}
      aria-labelledby={request.kind === 'choose' && request.title ? `${id}-title` : `${id}-msg`}
      aria-describedby={request.kind === 'choose' && request.title ? `${id}-msg` : undefined}
      onClick={(e) => {
        if (request.kind !== 'choose' || !request.dismissOnBackdrop || e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) settle(false);
      }}
      // Esc やブラウザの操作で閉じたときはキャンセル扱い
      onClose={() => settle(false)}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          settle(true);
        }}
      >
        {request.kind === 'choose' && request.title && (
          <h2 id={`${id}-title`} className="app-dialog-title">
            {request.title}
          </h2>
        )}
        <p id={`${id}-msg`} className="app-dialog-message">
          {request.message}
        </p>
        {request.kind === 'confirm' && request.details && (
          <div className="app-dialog-details">{request.details}</div>
        )}
        {request.kind === 'prompt' && (
          <input
            ref={input}
            type="text"
            className="app-dialog-input"
            aria-labelledby={`${id}-msg`}
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        {stacked && request.kind === 'choose' && (
          <div className="app-dialog-choices">
            {request.choices.map((c) => (
              <button
                key={c.value}
                type={c.primary ? 'submit' : 'button'}
                className={`app-dialog-choice${c.primary ? ' is-primary' : ''}`}
                ref={c.primary ? primary : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  settle(true, c.value);
                }}
              >
                <span className="app-dialog-choice-label">{c.label}</span>
                {c.description && <span className="app-dialog-choice-desc">{c.description}</span>}
              </button>
            ))}
          </div>
        )}
        {request.kind === 'choose' && request.links && request.links.length > 0 && (
          <div className="app-dialog-links">
            {request.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="app-dialog-link"
              >
                <span className="app-dialog-link-label">{link.label}</span>
                {link.description && <span className="app-dialog-choice-desc">{link.description}</span>}
              </a>
            ))}
          </div>
        )}
        {request.kind === 'choose' && request.note && <p className="hint app-dialog-note">{request.note}</p>}
        <div className="app-dialog-actions">
          {request.kind !== 'alert' && (
            <button ref={cancel} type="button" className="btn" onClick={() => settle(false)}>
              キャンセル
            </button>
          )}
          {stacked ? null : request.kind === 'choose' ? (
            request.choices.map((c) => (
              <button
                key={c.value}
                type={c.primary ? 'submit' : 'button'}
                className={`btn${c.danger ? ' btn-danger' : c.primary ? ' btn-primary' : ''}`}
                ref={c.primary ? primary : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  settle(true, c.value);
                }}
              >
                {c.label}
              </button>
            ))
          ) : (
            <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} ref={primary}>
              {okLabel}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
