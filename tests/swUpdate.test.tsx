// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SwUpdateNotice } from '../src/components/SwUpdateNotice';
import {
  bindSwUpdates,
  dismissSwUpdate,
  reportWaitingServiceWorker,
  requestSwSkipWaiting,
  subscribeSwUpdate,
  type SwUpdateClient,
  type SwWaitingWorker,
} from '../src/lib/swUpdate';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface FakeWorker extends SwWaitingWorker {
  state: string;
  listeners: Set<() => void>;
  messages: unknown[];
}

function fakeWorker(state: string): FakeWorker {
  const listeners = new Set<() => void>();
  const messages: unknown[] = [];
  return {
    state,
    listeners,
    messages,
    postMessage(message: unknown) {
      messages.push(message);
    },
    addEventListener(type: 'statechange', listener: () => void) {
      if (type === 'statechange') listeners.add(listener);
    },
  };
}

function createClient(controller: SwWaitingWorker | null) {
  const controllerListeners = new Set<() => void>();
  const updateListeners = new Set<() => void>();
  let waiting: SwWaitingWorker | null = null;
  let installing: SwWaitingWorker | null = null;
  const sw: SwUpdateClient = {
    controller,
    addEventListener(type, listener) {
      if (type === 'controllerchange') controllerListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'controllerchange') controllerListeners.delete(listener);
    },
    register: vi.fn(async () => ({
      get waiting() {
        return waiting;
      },
      get installing() {
        return installing;
      },
      addEventListener(type: 'updatefound', listener: () => void) {
        if (type === 'updatefound') updateListeners.add(listener);
      },
    })),
  };
  return {
    sw,
    setWaiting(worker: SwWaitingWorker | null) {
      waiting = worker;
    },
    setInstalling(worker: SwWaitingWorker | null) {
      installing = worker;
    },
    fireControllerChange() {
      for (const listener of controllerListeners) listener();
    },
    fireUpdateFound() {
      for (const listener of updateListeners) listener();
    },
    setState(worker: FakeWorker, state: string) {
      worker.state = state;
      for (const listener of worker.listeners) listener();
    },
  };
}

describe('bindSwUpdates', () => {
  beforeEach(() => {
    dismissSwUpdate();
    sessionStorage.removeItem('nai-tagdeck-sw-reload');
  });

  afterEach(() => {
    dismissSwUpdate();
  });

  it('reloads only the tab that accepted the update', () => {
    const client = createClient(fakeWorker('activated'));
    const reload = vi.fn();
    bindSwUpdates(client.sw, reload);
    client.fireControllerChange();
    client.fireControllerChange();
    expect(reload).not.toHaveBeenCalled();

    const worker = fakeWorker('installed');
    requestSwSkipWaiting(worker, reload);
    expect(worker.messages).toEqual([{ type: 'skip-waiting' }]);
    const stamp = Number(sessionStorage.getItem('nai-tagdeck-sw-reload'));
    expect(Number.isFinite(stamp)).toBe(true);
    expect(Date.now() - stamp).toBeLessThan(5_000);
    client.fireControllerChange();
    client.fireControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('nai-tagdeck-sw-reload')).toBeNull();
  });

  it('does not reload on the first controller even if a reload was requested', () => {
    const client = createClient(null);
    const reload = vi.fn();
    sessionStorage.setItem('nai-tagdeck-sw-reload', '1');
    bindSwUpdates(client.sw, reload);
    client.fireControllerChange();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('nai-tagdeck-sw-reload')).toBeNull();
  });

  it('reloads immediately while the worker is still activating', () => {
    const reload = vi.fn();
    const worker = fakeWorker('activating');
    requestSwSkipWaiting(worker, reload);
    expect(worker.messages).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('nai-tagdeck-sw-reload')).toBeNull();
  });

  it('drops a stale reload request instead of using it for a later update', () => {
    const client = createClient(fakeWorker('activated'));
    const reload = vi.fn();
    bindSwUpdates(client.sw, reload);
    sessionStorage.setItem('nai-tagdeck-sw-reload', String(Date.now() - 20_000));
    client.fireControllerChange();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('nai-tagdeck-sw-reload')).toBeNull();
  });

  it('reloads immediately when the waiting worker is already active', () => {
    const reload = vi.fn();
    const worker = fakeWorker('activated');
    requestSwSkipWaiting(worker, reload);
    expect(worker.messages).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('nai-tagdeck-sw-reload')).toBeNull();
  });

  it('reports a waiting worker only when a controller already exists', async () => {
    const seen: Array<SwWaitingWorker | null> = [];
    const stop = subscribeSwUpdate((worker) => seen.push(worker));

    const idle = createClient(null);
    const installed = fakeWorker('installed');
    idle.setWaiting(installed);
    bindSwUpdates(idle.sw, vi.fn());
    await vi.waitFor(() => expect(idle.sw.register).toHaveBeenCalledWith('./sw.js'));
    await Promise.resolve();
    expect(seen).toEqual([]);

    const active = createClient(fakeWorker('activated'));
    const waiting = fakeWorker('installed');
    active.setWaiting(waiting);
    bindSwUpdates(active.sw, vi.fn());
    await vi.waitFor(() => expect(seen).toEqual([waiting]));
    stop();
  });

  it('reports an update found while the page is controlled, and ignores a rejected registration', async () => {
    const seen: SwWaitingWorker[] = [];
    const stop = subscribeSwUpdate((worker) => {
      if (worker) seen.push(worker);
    });
    const client = createClient(fakeWorker('activated'));
    const installing = fakeWorker('installing');
    client.setInstalling(installing);
    bindSwUpdates(client.sw, vi.fn());
    await vi.waitFor(() => expect(client.sw.register).toHaveBeenCalled());
    await Promise.resolve();
    client.fireUpdateFound();
    expect(seen).toEqual([]);
    client.setState(installing, 'installed');
    expect(seen).toEqual([installing]);

    const broken: SwUpdateClient = {
      controller: null,
      addEventListener() {},
      removeEventListener() {},
      register: vi.fn(async () => {
        throw new Error('register failed');
      }),
    };
    expect(() => bindSwUpdates(broken, vi.fn())).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    stop();
  });

  it('posts skip-waiting and hides a dismissed notice until the next report', () => {
    const worker = fakeWorker('installed');
    requestSwSkipWaiting(worker);
    expect(worker.messages).toEqual([{ type: 'skip-waiting' }]);

    const seen: Array<SwWaitingWorker | null> = [];
    const stop = subscribeSwUpdate((next) => seen.push(next));
    reportWaitingServiceWorker(worker);
    dismissSwUpdate();
    const later: Array<SwWaitingWorker | null> = [];
    const stopLater = subscribeSwUpdate((next) => later.push(next));
    expect(seen.map((item) => item?.state ?? null)).toEqual(['installed', null]);
    expect(later).toEqual([]);
    stop();
    stopLater();
  });
});

describe('SwUpdateNotice', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dismissSwUpdate();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    dismissSwUpdate();
  });

  it('shows the update actions and can dismiss them', async () => {
    await act(async () => {
      root.render(createElement(SwUpdateNotice));
    });
    expect(container.textContent).not.toContain('新しいバージョン');

    const worker = fakeWorker('installed');
    await act(async () => {
      reportWaitingServiceWorker(worker);
    });
    expect(container.textContent).toContain('新しいバージョンがあります。再読み込みすると反映されます。');

    const reload = [...container.querySelectorAll('button')].find((button) => button.textContent === '再読み込み');
    const later = [...container.querySelectorAll('button')].find((button) => button.textContent === 'あとで');
    expect(reload).toBeTruthy();
    expect(later).toBeTruthy();

    await act(async () => {
      reload?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(worker.messages).toEqual([{ type: 'skip-waiting' }]);

    await act(async () => {
      later?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('新しいバージョン');
  });
});
