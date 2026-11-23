// 本番の Service Worker を登録し、すでにページを制御中のときだけ更新を知らせる。
// 初回の claim では再読み込みしない。再読み込みは、そのタブが更新を選んだときだけ行う。

const SKIP_WAITING = { type: 'skip-waiting' } as const;
const SW_RELOAD_MS = 15_000;
let reloadRequestedAt: number | null = null;

function controlsThisTab(worker: SwWaitingWorker): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller === worker;
}

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
  // 他タブが先に切り替えたあとは controllerchange がもう来ない。activating の途中でも、このタブはすぐ読み直す。
  if (worker.state === 'activating' || worker.state === 'activated' || controlsThisTab(worker)) {
    reloadRequestedAt = null;
    reload();
    return;
  }
  reloadRequestedAt = Date.now();
  worker.postMessage(SKIP_WAITING);
}

function announceInstalled(sw: SwUpdateClient, worker: SwWaitingWorker | null): void {
  if (worker?.state !== 'installed' || !sw.controller) return;
  reportWaitingServiceWorker(worker);
}

/** 登録と controllerchange の監視を始める。戻った関数で監視を外す。 */
export function bindSwUpdates(sw: SwUpdateClient, reload: () => void): () => void {
  let hadController = sw.controller !== null;
  let reloading = false;
  const onControllerChange = () => {
    if (!hadController) {
      hadController = true;
      reloadRequestedAt = null;
      return;
    }
    // 他タブの更新では読み直さない。このタブが直前に「再読み込み」を押したときだけ。
    const stamp = reloadRequestedAt;
    reloadRequestedAt = null;
    if (stamp === null) return;
    const age = Date.now() - Number(stamp);
    if (!Number.isFinite(age) || age < 0 || age > SW_RELOAD_MS) return;
    if (reloading) return;
    reloading = true;
    reload();
  };
  sw.addEventListener('controllerchange', onControllerChange);

  let cancelled = false;
  sw.register('./sw.js')
    .then((reg) => {
      if (cancelled) return;
      const watched = new Set<SwWaitingWorker>();
      const watch = (worker: SwWaitingWorker | null) => {
        if (!worker || watched.has(worker)) return;
        watched.add(worker);
        const onState = () => {
          if (worker.state === 'installed') announceInstalled(sw, worker);
        };
        worker.addEventListener('statechange', onState);
        onState();
      };
      announceInstalled(sw, reg.waiting);
      watch(reg.installing);
      reg.addEventListener('updatefound', () => {
        watch(reg.installing);
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
