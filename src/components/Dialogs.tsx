import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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
  /** 中断されたら、このダイアログだけをキャンセルとして閉じる。 */
  signal?: AbortSignal;
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
  /** 中断されたら、このダイアログだけをキャンセルとして閉じる。 */
  signal?: AbortSignal;
}

type Request = { id: number } & (
  | { kind: 'confirm'; message: string; okLabel?: string; danger?: boolean; details?: string; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; defaultValue: string; okLabel?: string; resolve: (v: string | null) => void }
  | { kind: 'alert'; message: string; resolve: () => void }
  | ({ kind: 'choose'; message: string; choices: readonly Choice[]; resolve: (v: string | null) => void } & Omit<ChooseOptions, 'signal'>)
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
  const enqueue = useCallback(
    <R,>(make: (resolve: (value: R) => void) => NewRequest, cancelledValue: R, signal?: AbortSignal): Promise<R> => {
      if (signal?.aborted) return Promise.resolve(cancelledValue);
      return new Promise<R>((resolve) => {
        let done = false;
        const id = ++nextId.current;
        const onAbort = () => {
          if (done) return;
          done = true;
          signal?.removeEventListener('abort', onAbort);
          setQueue((q) => q.filter((item) => item.id !== id));
          resolve(cancelledValue);
        };
        const settle = (value: R) => {
          if (done) return;
          done = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        setQueue((q) => [...q, { ...make(settle), id } as Request]);
      });
    },
    [],
  );

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (message, options) => {
        const { signal, ...rest } = options ?? {};
        return enqueue((resolve) => ({ kind: 'confirm', message, ...rest, resolve }), false, signal);
      },
      prompt: (message, defaultValue = '', options) =>
        enqueue<string | null>((resolve) => ({ kind: 'prompt', message, defaultValue, ...options, resolve }), null),
      alert: (message) => enqueue<void>((resolve) => ({ kind: 'alert', message, resolve }), undefined),
      choose: <V extends string>(message: string, choices: readonly Choice<V>[], options?: ChooseOptions) => {
        const { signal, ...rest } = options ?? {};
        return enqueue<V | null>(
          (resolve) => ({ kind: 'choose', message, choices, ...rest, resolve: resolve as (v: string | null) => void }),
          null,
          signal,
        );
      },
    }),
    [enqueue],
  );

  const current = queue[0];
  const finish = useCallback((id: number) => setQueue((q) => q.filter((item) => item.id !== id)), []);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <AppDialog key={current.id} request={current} onDone={() => finish(current.id)} />}
    </DialogContext.Provider>
  );
}

function AppDialog({ request, onDone }: { request: Request; onDone: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(request.kind === 'prompt' ? request.defaultValue : '');
  const [scrollable, setScrollable] = useState(false);
  const settled = useRef(false);
  const id = useId();

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const overflows = () => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
    const update = () => setScrollable(overflows());
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [request]);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    // autoFocus は showModal より先に効いてしまい、先頭の「キャンセル」にフォーカスが移るので、開いた後で当て直す。
    const resetScroll = () => {
      if (dialog.current) dialog.current.scrollTop = 0;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    };
    if (request.kind === 'prompt') input.current?.select();
    else if (request.kind === 'confirm') {
      // showModal がキャンセルへスクロールした後でも、警告の先頭を見せる。開いた後の寸法でタブ可否を決める。
      resetScroll();
      const element = scrollRef.current;
      if (element) {
        setScrollable(element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);
      }
      (request.danger ? cancel.current : primary.current)?.focus({ preventScroll: true });
      resetScroll();
      const frame = requestAnimationFrame(resetScroll);
      return () => cancelAnimationFrame(frame);
    } else primary.current?.focus();
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
        {request.kind === 'confirm' ? (
          <div ref={scrollRef} className="app-dialog-scroll" tabIndex={scrollable ? 0 : undefined}>
            <p id={`${id}-msg`} className="app-dialog-message">
              {request.message}
            </p>
            {request.details && <div className="app-dialog-details">{request.details}</div>}
          </div>
        ) : (
          <p id={`${id}-msg`} className="app-dialog-message">
            {request.message}
          </p>
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
