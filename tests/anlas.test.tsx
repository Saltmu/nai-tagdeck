// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnlasDetails, AnlasLine } from '../src/components/AnlasBalance';
import { useAnlas, type AnlasState } from '../src/hooks/useAnlas';
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
    lastConsumed: null,
    error: null,
    loading: false,
    refresh: () => {},
    refreshAfterGeneration: () => {},
    ...overrides,
  };
}

describe('AnlasLine', () => {
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

  const renderLine = async (state: AnlasState) => {
    await act(async () => root.render(<AnlasLine anlas={state} />));
    return container.querySelector('.anlas-line')!;
  };

  it('未設定のときは「消費 — / 残高 未設定」と出す', async () => {
    const line = await renderLine(fakeState({ status: 'unset', subscription: null }));
    expect(line.textContent).toContain('消費 — / 残高 未設定');
    expect(line.querySelector('[aria-label="残高を更新"]')).toBeNull();
  });

  it('読み込み中は残高を「読み込み中…」と出す', async () => {
    const line = await renderLine(fakeState({ status: 'loading', subscription: null, loading: true }));
    expect(line.textContent).toContain('消費 — / 残高 読み込み中…');
  });

  it('残高が分かれば「消費 — / 残高 18,000」と出す', async () => {
    const line = await renderLine(fakeState({}));
    expect(line.textContent).toContain('消費 — / 残高 18,000');
  });

  it('直前の生成で消費が分かれば左側に消費を出す（精密参照 1 枚なら 5 / 18000 の形）', async () => {
    const line = await renderLine(fakeState({ lastConsumed: 5 }));
    expect(line.textContent).toContain('消費 5 / 残高 18,000');
  });

  it('取得失敗のときは「取得できませんでした」と理由を出し、生成を止めない文言は出さない', async () => {
    const line = await renderLine(
      fakeState({ status: 'error', subscription: null, error: 'トークンが無効です' }),
    );
    expect(line.textContent).toContain('消費 — / 残高 取得できませんでした');
    expect(line.textContent).toContain('トークンが無効です');
    expect(line.querySelector('[aria-label="残高を更新"]')).not.toBeNull();
  });

  it('手動の更新ボタンを押すと refresh が呼ばれる', async () => {
    const refresh = vi.fn();
    const line = await renderLine(fakeState({ refresh }));
    await act(async () => {
      (line.querySelector('[aria-label="残高を更新"]') as HTMLButtonElement).click();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
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
    expect(state.lastConsumed).toBeNull();
    expect(mockedFetch()).not.toHaveBeenCalled();
  });

  it('トークン保存時に取得し、残高が表示される', async () => {
    mockedFetch().mockResolvedValue(opusSubscription);
    await renderHarness('pst-secret');
    await waitForStatus('ready');
    expect(mockedFetch()).toHaveBeenCalledTimes(1);
    expect(mockedFetch()).toHaveBeenCalledWith('pst-secret', expect.anything());
    expect(state.subscription?.totalAnlas).toBe(18000);
    expect(state.lastConsumed).toBeNull();
  });

  it('取得失敗のときは error になり、例外は外へ漏れない', async () => {
    mockedFetch().mockRejectedValue(new Error('boom'));
    await renderHarness('pst-secret');
    await waitForStatus('error');
    expect(state.error).toBe('取得できませんでした');
    expect(state.subscription).toBeNull();
  });

  it('生成後の取得で残高が減っていれば、その差が消費になる', async () => {
    mockedFetch().mockResolvedValueOnce(opusSubscription);
    await renderHarness('pst-secret');
    await waitForStatus('ready');
    expect(state.lastConsumed).toBeNull();

    mockedFetch().mockResolvedValueOnce({ ...opusSubscription, totalAnlas: 17995 });
    await act(async () => {
      state.refreshAfterGeneration();
    });
    await waitForStatus('ready');
    expect(state.lastConsumed).toBe(5);
    expect(state.subscription?.totalAnlas).toBe(17995);
  });

  it('生成後の取得で残高が変わらなければ消費は 0 になる', async () => {
    mockedFetch().mockResolvedValueOnce(opusSubscription);
    await renderHarness('pst-secret');
    await waitForStatus('ready');
    mockedFetch().mockResolvedValueOnce(opusSubscription);
    await act(async () => {
      state.refreshAfterGeneration();
    });
    await waitForStatus('ready');
    expect(state.lastConsumed).toBe(0);
  });

  it('生成後の取得で残高が増えていれば消費は「—」に戻る', async () => {
    mockedFetch().mockResolvedValueOnce(opusSubscription);
    await renderHarness('pst-secret');
    await waitForStatus('ready');
    mockedFetch().mockResolvedValueOnce({ ...opusSubscription, totalAnlas: 28000 });
    await act(async () => {
      state.refreshAfterGeneration();
    });
    await waitForStatus('ready');
    expect(state.lastConsumed).toBeNull();
  });

  it('手動の更新では消費の計算をしない', async () => {
    mockedFetch().mockResolvedValueOnce(opusSubscription);
    await renderHarness('pst-secret');
    await waitForStatus('ready');
    mockedFetch().mockResolvedValueOnce({ ...opusSubscription, totalAnlas: 17995 });
    await act(async () => {
      state.refresh();
    });
    await waitForStatus('ready');
    expect(state.lastConsumed).toBeNull();
    expect(state.subscription?.totalAnlas).toBe(17995);
  });

  it('生成後の取得が失敗したら基準値と消費表示が無効化され、次の成功では複数回分の消費を表示しない', async () => {
    mockedFetch().mockResolvedValueOnce(opusSubscription);
    await renderHarness('pst-secret');
    await waitForStatus('ready');

    // 1 回目の生成で 5 消費し、表示が 5 になる
    mockedFetch().mockResolvedValueOnce({ ...opusSubscription, totalAnlas: 17995 });
    await act(async () => {
      state.refreshAfterGeneration();
    });
    await waitForStatus('ready');
    expect(state.lastConsumed).toBe(5);

    // 2 回目の生成後の取得が失敗する（この生成の消費は分からない）
    mockedFetch().mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      state.refreshAfterGeneration();
    });
    await waitForStatus('error');
    expect(state.lastConsumed).toBeNull();

    // 3 回目の生成後の取得が成功しても、基準値がないため消費は「—」のまま（10 とは表示しない）
    mockedFetch().mockResolvedValueOnce({ ...opusSubscription, totalAnlas: 17990 });
    await act(async () => {
      state.refreshAfterGeneration();
    });
    await waitForStatus('ready');
    expect(state.subscription?.totalAnlas).toBe(17990);
    expect(state.lastConsumed).toBeNull();
  });

  it('トークンを別の値に置き換えたら、前のトークンの残高・消費は残らない', async () => {
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
    expect(state.lastConsumed).toBeNull();
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
    expect(state.lastConsumed).toBeNull();
    // IndexedDB・ストレージのどちらにも残高が残らない
    const saved = await readAllAppData();
    expect(JSON.stringify(saved)).not.toContain('18000');
    expect(JSON.stringify(saved)).not.toContain('fixedTrainingStepsLeft');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
