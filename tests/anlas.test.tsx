// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnlasBalance, AnlasCostBadge, AnlasDetails } from '../src/components/AnlasBalance';
import { useAnlas, type AnlasState } from '../src/hooks/useAnlas';
import { estimateAnlasCost, formatAnlasEstimate, type AnlasEstimate } from '../src/lib/anlasEstimate';
import { readAllAppData } from '../src/lib/db';
import { fetchSubscription, type Subscription } from '../src/lib/novelai';

vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  fetchSubscription: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const opusSubscription: Subscription = {
  tier: 3,
  fixedTrainingStepsLeft: 10000,
  purchasedTrainingSteps: 8000,
  totalAnlas: 18000,
  expiresAt: 1798761600000,
  usage: { percent: 23, isNegative: false, timeUntilNextPercent: 5400 },
};

const mockedFetch = () => vi.mocked(fetchSubscription);

function fakeState(overrides: Partial<AnlasState>): AnlasState {
  return {
    status: 'ready',
    subscription: opusSubscription,
    error: null,
    loading: false,
    refresh: () => {},
    ...overrides,
  };
}

describe('anlasEstimate', () => {
  it('subscription が null のとき unknown を返し、参照なしは「—」、参照 1 枚は「+5〜」になる', () => {
    const none = estimateAnlasCost({ subscription: null, baseIsFree: true, referenceCount: 0 });
    expect(none).toEqual({ kind: 'unknown', minAdditional: 0 });
    expect(formatAnlasEstimate(none)).toBe('—');

    const one = estimateAnlasCost({ subscription: null, baseIsFree: true, referenceCount: 1 });
    expect(one).toEqual({ kind: 'unknown', minAdditional: 5 });
    expect(formatAnlasEstimate(one)).toBe('+5〜');
  });

  it('Opus 枠内かつ baseIsFree が true のとき exact を返す（isNegative: false および usage: null）', () => {
    const subs: Subscription[] = [
      opusSubscription,
      { ...opusSubscription, usage: null },
    ];
    for (const subscription of subs) {
      expect(formatAnlasEstimate(estimateAnlasCost({ subscription, baseIsFree: true, referenceCount: 0 }))).toBe('0');
      expect(formatAnlasEstimate(estimateAnlasCost({ subscription, baseIsFree: true, referenceCount: 1 }))).toBe('5');
      expect(formatAnlasEstimate(estimateAnlasCost({ subscription, baseIsFree: true, referenceCount: 2 }))).toBe('10');
    }
  });

  it('Opus 枠超過（isNegative: true）のとき paid を返し、参照なしは「有料」、参照 1 枚は「+5〜」になる', () => {
    const overLimit: Subscription = {
      ...opusSubscription,
      usage: { percent: 100, isNegative: true, timeUntilNextPercent: null },
    };
    const none = estimateAnlasCost({ subscription: overLimit, baseIsFree: true, referenceCount: 0 });
    expect(none).toEqual({ kind: 'paid', minAdditional: 0 });
    expect(formatAnlasEstimate(none)).toBe('有料');

    const one = estimateAnlasCost({ subscription: overLimit, baseIsFree: true, referenceCount: 1 });
    expect(one).toEqual({ kind: 'paid', minAdditional: 5 });
    expect(formatAnlasEstimate(one)).toBe('+5〜');
  });

  it('Opus でも baseIsFree が false のとき paid を返す', () => {
    const none = estimateAnlasCost({ subscription: opusSubscription, baseIsFree: false, referenceCount: 0 });
    expect(none).toEqual({ kind: 'paid', minAdditional: 0 });
    expect(formatAnlasEstimate(none)).toBe('有料');

    const one = estimateAnlasCost({ subscription: opusSubscription, baseIsFree: false, referenceCount: 1 });
    expect(one).toEqual({ kind: 'paid', minAdditional: 5 });
    expect(formatAnlasEstimate(one)).toBe('+5〜');
  });

  it('非 Opus（tier: 0 / 1 / 2）のとき paid を返す', () => {
    for (const tier of [0, 1, 2]) {
      const subscription: Subscription = { ...opusSubscription, tier, usage: null };
      const none = estimateAnlasCost({ subscription, baseIsFree: true, referenceCount: 0 });
      expect(none).toEqual({ kind: 'paid', minAdditional: 0 });
      expect(formatAnlasEstimate(none)).toBe('有料');

      const one = estimateAnlasCost({ subscription, baseIsFree: true, referenceCount: 1 });
      expect(one).toEqual({ kind: 'paid', minAdditional: 5 });
      expect(formatAnlasEstimate(one)).toBe('+5〜');
    }
  });

  it('未指定・負数・小数の referenceCount は安全に 0 以上へ切り捨てる', () => {
    expect(estimateAnlasCost({ subscription: opusSubscription, baseIsFree: true })).toEqual({
      kind: 'exact',
      amount: 0,
    });
    expect(estimateAnlasCost({ subscription: opusSubscription, baseIsFree: true, referenceCount: -3 })).toEqual({
      kind: 'exact',
      amount: 0,
    });
    expect(estimateAnlasCost({ subscription: opusSubscription, baseIsFree: true, referenceCount: 1.9 })).toEqual({
      kind: 'exact',
      amount: 5,
    });
  });
});

describe('AnlasBalance', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const renderBalance = async (state: AnlasState) => {
    await act(async () => root.render(<AnlasBalance anlas={state} />));
    return container.querySelector('.header-anlas')!;
  };

  it('未設定のときは「残高 未設定」と出し、更新ボタンを出さない', async () => {
    const el = await renderBalance(fakeState({ status: 'unset', subscription: null }));
    expect(el.textContent).toContain('残高 未設定');
    expect(el.querySelector('[aria-label="残高を更新"]')).toBeNull();
  });

  it('読み込み中は残高を「読み込み中…」と出す', async () => {
    const el = await renderBalance(fakeState({ status: 'loading', subscription: null, loading: true }));
    expect(el.textContent).toContain('読み込み中…');
  });

  it('取得済みのときは「残高 18,000」と出す', async () => {
    const el = await renderBalance(fakeState({}));
    expect(el.textContent).toContain('残高 18,000');
  });

  it('取得失敗のときは「取得失敗」と理由を出し、更新ボタンも出す', async () => {
    const el = await renderBalance(
      fakeState({ status: 'error', subscription: null, error: 'トークンが無効です' }),
    );
    expect(el.classList.contains('is-error')).toBe(true);
    expect(el.textContent).toContain('残高 取得失敗');
    expect(el.textContent).toContain('トークンが無効です');
    expect(el.querySelector('[aria-label="残高を更新"]')).not.toBeNull();
  });

  it('手動の更新ボタンを押すと refresh が呼ばれる', async () => {
    const refresh = vi.fn();
    const el = await renderBalance(fakeState({ refresh }));
    await act(async () => {
      (el.querySelector('[aria-label="残高を更新"]') as HTMLButtonElement).click();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('AnlasCostBadge', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const renderBadge = async (estimate: AnlasEstimate) => {
    await act(async () => root.render(<AnlasCostBadge estimate={estimate} />));
    return container.querySelector('.gen-cost-badge')!;
  };

  it('Opus 無料枠なら「0」を出し、is-paid を付けない', async () => {
    const badge = await renderBadge({ kind: 'exact', amount: 0 });
    expect(badge.textContent?.trim()).toBe('0');
    expect(badge.classList.contains('is-paid')).toBe(false);
    expect(badge.getAttribute('aria-label')).toBe('消費見積 0 Anlas');
  });

  it('精密参照 1 枚なら「5」を出し、is-paid を付ける', async () => {
    const badge = await renderBadge({ kind: 'exact', amount: 5 });
    expect(badge.textContent?.trim()).toBe('5');
    expect(badge.classList.contains('is-paid')).toBe(true);
    expect(badge.getAttribute('aria-label')).toBe('消費見積 5 Anlas');
  });

  it('非 Opus の有料見積もりなら「有料」と「+5〜」を出し、is-paid を付ける', async () => {
    const paid = await renderBadge({ kind: 'paid', minAdditional: 0 });
    expect(paid.textContent?.trim()).toBe('有料');
    expect(paid.classList.contains('is-paid')).toBe(true);
    expect(paid.getAttribute('aria-label')).toBe('消費見積 有料');

    const paidWithRef = await renderBadge({ kind: 'paid', minAdditional: 5 });
    expect(paidWithRef.textContent?.trim()).toBe('+5〜');
    expect(paidWithRef.classList.contains('is-paid')).toBe(true);
    expect(paidWithRef.getAttribute('aria-label')).toBe('消費見積 +5〜');
  });

  it('購読不明のときは「—」を出す', async () => {
    const badge = await renderBadge({ kind: 'unknown', minAdditional: 0 });
    expect(badge.textContent?.trim()).toBe('—');
    expect(badge.classList.contains('is-paid')).toBe(false);
    expect(badge.getAttribute('aria-label')).toBe('消費見積 不明');
  });
});

describe('AnlasDetails', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const renderDetails = async (state: AnlasState) => {
    await act(async () => root.render(<AnlasDetails anlas={state} />));
    return container;
  };

  it('Opus ではプラン・内訳・V5 利用枠・リセットを出す', async () => {
    const el = await renderDetails(fakeState({}));
    expect(el.textContent).toContain('Opus');
    expect(el.textContent).toContain('18,000 Anlas（付与分 10,000／購入分 8,000）');
    expect(el.textContent).toContain('23%');
    expect(el.textContent).toContain('次の1%回復まであと1時間30分');
    expect(el.textContent).toContain('付与分の Anlas は期間の終了時にリセットされます');
    expect(el.textContent).toContain('次回更新日：');
  });

  it('Opus 以外では V5 利用枠を出さない', async () => {
    const el = await renderDetails(
      fakeState({
        subscription: { ...opusSubscription, tier: 1, usage: null },
      }),
    );
    expect(el.textContent).toContain('Tablet');
    expect(el.textContent).not.toContain('V5 利用枠');
  });

  it('利用枠を超過しているときはその旨を出す', async () => {
    const el = await renderDetails(
      fakeState({
        subscription: { ...opusSubscription, usage: { percent: 100, isNegative: true, timeUntilNextPercent: null } },
      }),
    );
    expect(el.textContent).toContain('利用枠を超過しています');
  });

  it('未設定のときはトークン保存後に表示される旨を出す', async () => {
    const el = await renderDetails(fakeState({ status: 'unset', subscription: null }));
    expect(el.textContent).toContain('トークンを保存すると、Anlas 残高とプランがここに表示されます。');
  });
});

describe('useAnlas', () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: AnlasState;

  function Harness({ token }: { token: string | null }) {
    state = useAnlas(token);
    return null;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.mocked(fetchSubscription).mockReset();
  });

  const renderHarness = async (token: string | null) => {
    await act(async () => root.render(<Harness token={token} />));
  };

  const waitForStatus = async (status: AnlasState['status']) => {
    await vi.waitFor(() => expect(state.status).toBe(status));
  };

  it('トークンがないときは取得せず「未設定」になる', async () => {
    await renderHarness(null);
    expect(state.status).toBe('unset');
    expect(state.subscription).toBeNull();
    expect(mockedFetch()).not.toHaveBeenCalled();
  });

  it('トークン保存時に取得し、残高が表示される', async () => {
    mockedFetch().mockResolvedValue(opusSubscription);
    await renderHarness('pst-secret');
    await waitForStatus('ready');
    expect(mockedFetch()).toHaveBeenCalledTimes(1);
    expect(mockedFetch()).toHaveBeenCalledWith('pst-secret', expect.anything());
    expect(state.subscription?.totalAnlas).toBe(18000);
  });

  it('取得失敗のときは error になり、例外は外へ漏れない', async () => {
    mockedFetch().mockRejectedValue(new Error('boom'));
    await renderHarness('pst-secret');
    await waitForStatus('error');
    expect(state.error).toBe('取得できませんでした');
    expect(state.subscription).toBeNull();
  });

  it('refresh() で最新残高に更新される', async () => {
    mockedFetch().mockResolvedValueOnce(opusSubscription);
    await renderHarness('pst-secret');
    await waitForStatus('ready');
    mockedFetch().mockResolvedValueOnce({ ...opusSubscription, totalAnlas: 17995 });
    await act(async () => {
      state.refresh();
    });
    await waitForStatus('ready');
    expect(state.subscription?.totalAnlas).toBe(17995);
  });

  it('トークンを別の値に置き換えたら、前のトークンの残高は残らない', async () => {
    mockedFetch().mockResolvedValueOnce(opusSubscription);
    await renderHarness('pst-first');
    await waitForStatus('ready');
    expect(state.subscription?.totalAnlas).toBe(18000);

    // 新しいトークンでの取得が失敗しても、前の残高は表示されない
    mockedFetch().mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      root.render(<Harness token="pst-second" />);
    });
    await waitForStatus('error');
    expect(state.subscription).toBeNull();
  });

  it('トークンを消すと表示も消え、残高はどこにも保存されない', async () => {
    mockedFetch().mockResolvedValue(opusSubscription);
    await renderHarness('pst-secret');
    await waitForStatus('ready');
    await act(async () => {
      root.render(<Harness token={null} />);
    });
    expect(state.status).toBe('unset');
    expect(state.subscription).toBeNull();
    // IndexedDB・ストレージのどちらにも残高が残らない
    const saved = await readAllAppData();
    expect(JSON.stringify(saved)).not.toContain('18000');
    expect(JSON.stringify(saved)).not.toContain('fixedTrainingStepsLeft');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
