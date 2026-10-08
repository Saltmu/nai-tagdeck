import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

/** window.confirm / prompt / alert の代わりに、アプリ内で描画するダイアログ。 */
export interface DialogApi {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string, options?: { okLabel?: string }) => Promise<string | null>;
  alert: (message: string) => Promise<void>;
}

export interface ConfirmOptions {
  okLabel?: string;
  /** 削除など、取り消せない操作のとき赤いボタンにする。 */
  danger?: boolean;
}

type Request = { id: number } & (
  | { kind: 'confirm'; message: string; okLabel?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; defaultValue: string; okLabel?: string; resolve: (v: string | null) => void }
  | { kind: 'alert'; message: string; resolve: () => void }
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
  const [value, setValue] = useState(request.kind === 'prompt' ? request.defaultValue : '');
  const settled = useRef(false);
  const id = useId();

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    if (request.kind === 'prompt') input.current?.select();
  }, [request.kind]);

  const settle = (ok: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (request.kind === 'confirm') request.resolve(ok);
    else if (request.kind === 'prompt') request.resolve(ok ? value : null);
    else request.resolve();
    dialog.current?.close();
    onDone();
  };

  const okLabel = request.kind === 'alert' ? 'OK' : (request.okLabel ?? 'OK');
  const danger = request.kind === 'confirm' && request.danger;

  return (
    <dialog
      ref={dialog}
      className="app-dialog"
      aria-labelledby={`${id}-msg`}
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
        <p id={`${id}-msg`} className="app-dialog-message">
          {request.message}
        </p>
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
        <div className="app-dialog-actions">
          {request.kind !== 'alert' && (
            <button type="button" className="btn" onClick={() => settle(false)}>
              キャンセル
            </button>
          )}
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} autoFocus={request.kind !== 'prompt'}>
            {okLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
