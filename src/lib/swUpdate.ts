// 本番の Service Worker を登録し、すでにページを制御中のときだけ更新を知らせる。
// 初回の claim では再読み込みしない。再読み込みは、そのタブが更新を選んだときだけ行う。

const SKIP_WAITING = { type: 'skip-waiting' } as const;
const SW_RELOAD_KEY = 'nai-tagdeck-sw-reload';

export interface SwWaitingWorker {
  state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

interface SwRegistrationLike {
  waiting: SwWaitingWorker | null;
  installing: SwWaitingWorker | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

export interface SwUpdateClient {
  controller: SwWaitingWorker | null;
  addEventListener(type: 'controllerchange', listener: () => void): void;
  removeEventListener(type: 'controllerchange', listener: () => void): void;
  register(url: string): Promise<SwRegistrationLike>;
}

type WaitingListener = (worker: SwWaitingWorker | null) => void;

const waitingListeners = new Set<WaitingListener>();
let pendingWorker: SwWaitingWorker | null = null;
let started = false;

export function subscribeSwUpdate(listener: WaitingListener): () => void {
  waitingListeners.add(listener);
  if (pendingWorker) listener(pendingWorker);
  return () => {
    waitingListeners.delete(listener);
  };
}

export function reportWaitingServiceWorker(worker: SwWaitingWorker): void {
  pendingWorker = worker;
  for (const listener of waitingListeners) listener(worker);
}

export function dismissSwUpdate(): void {
  pendingWorker = null;
  for (const listener of waitingListeners) listener(null);
}

export function requestSwSkipWaiting(worker: SwWaitingWorker, reload: () => void = () => window.location.reload()): void {
  // 他タブが先に有効化したあとは controllerchange が来ないので、このタブはすぐ読み直す。
  if (worker.state === 'activated') {
    reload();
    return;
  }
  sessionStorage.setItem(SW_RELOAD_KEY, '1');
  worker.postMessage(SKIP_WAITING);
}

function announceInstalled(sw: SwUpdateClient, worker: SwWaitingWorker | null): void {
  if (!worker || worker.state !== 'installed' || !sw.controller) return;
  reportWaitingServiceWorker(worker);
}

/** 登録と controllerchange の監視を始める。戻った関数で監視を外す。 */
export function bindSwUpdates(sw: SwUpdateClient, reload: () => void): () => void {
  let hadController = sw.controller !== null;
  let reloading = false;
  const onControllerChange = () => {
    if (!hadController) {
      hadController = true;
      sessionStorage.removeItem(SW_RELOAD_KEY);
      return;
    }
    // 他タブの更新では読み直さない。このタブが「再読み込み」を押した印があるときだけ。
    if (sessionStorage.getItem(SW_RELOAD_KEY) !== '1') return;
    sessionStorage.removeItem(SW_RELOAD_KEY);
    if (reloading) return;
    reloading = true;
    reload();
  };
  sw.addEventListener('controllerchange', onControllerChange);

  let cancelled = false;
  sw.register('./sw.js')
    .then((reg) => {
      if (cancelled) return;
      announceInstalled(sw, reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        const onState = () => {
          if (worker.state === 'installed') announceInstalled(sw, worker);
        };
        worker.addEventListener('statechange', onState);
        onState();
      });
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    sw.removeEventListener('controllerchange', onControllerChange);
  };
}

export function startSwUpdates(): void {
  if (started || !('serviceWorker' in navigator)) return;
  started = true;
  bindSwUpdates(navigator.serviceWorker, () => window.location.reload());
}
