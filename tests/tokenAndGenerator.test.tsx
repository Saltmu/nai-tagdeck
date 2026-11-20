// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenSettings } from '../src/components/TokenSettings';
import { useGenerator, type Generator } from '../src/hooks/useGenerator';
import type { NewImage } from '../src/hooks/useImages';
import { useToken, type TokenState } from '../src/hooks/useToken';
import { DEFAULT_GENERATION } from '../src/lib/generation';
import { TOKEN_STORAGE_KEY } from '../src/lib/token';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('useToken', () => {
  let root: Root;
  let tokenState: TokenState;

  function Harness() {
    tokenState = useToken();
    return null;
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    root = createRoot(document.createElement('div'));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('他タブでのトークン削除・更新を storage イベントで同期する', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'pst-initial');
    await act(async () => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      );
    });
    expect(tokenState.token).toBe('pst-initial');
    expect(tokenState.storage).toBe('local');

    // 別タブで削除された場合
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, oldValue: 'pst-initial', newValue: null }));
    });
    expect(tokenState.token).toBeNull();
    expect(tokenState.storage).toBe('session');

    // 別タブで新しいトークンが保存された場合
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'pst-updated');
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, newValue: 'pst-updated' }));
    });
    expect(tokenState.token).toBe('pst-updated');
    expect(tokenState.storage).toBe('local');

    // 別タブで localStorage.clear() された場合（key === null）
    window.localStorage.clear();
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(tokenState.token).toBeNull();
  });

  it('このタブの sessionStorage にあるトークンは他タブの localStorage 変更で消えない', async () => {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, 'pst-session');
    await act(async () => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      );
    });
    expect(tokenState.token).toBe('pst-session');
    expect(tokenState.storage).toBe('session');

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, newValue: null }));
    });
    expect(tokenState.token).toBe('pst-session');
    expect(tokenState.storage).toBe('session');
  });

  it('保存失敗でメモリ保持中のトークンは他タブの storage イベントで消されない', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'pst-local');
    await act(async () => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      );
    });
    expect(tokenState.token).toBe('pst-local');

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    try {
      let saved = true;
      await act(async () => {
        saved = tokenState.save('pst-memory-only', 'session');
      });
      expect(saved).toBe(false);
      expect(tokenState.token).toBe('pst-memory-only');
      expect(tokenState.storage).toBe('session');
    } finally {
      setItemSpy.mockRestore();
    }

    // 別タブでローカル保存のトークンが削除されてもメモリ保持中の値は残る
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, oldValue: 'pst-local', newValue: null }));
    });
    expect(tokenState.token).toBe('pst-memory-only');
    expect(tokenState.storage).toBe('session');

    // 明示的に削除すれば同期が再開する
    await act(async () => {
      tokenState.clear();
    });
    expect(tokenState.token).toBeNull();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'pst-after-clear');
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, newValue: 'pst-after-clear' }));
    });
    expect(tokenState.token).toBe('pst-after-clear');
    expect(tokenState.storage).toBe('local');
  });
});

describe('TokenSettings', () => {
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

  it('不正な文字を含むトークンは保存せずエラーを表示する', async () => {
    const save = vi.fn().mockReturnValue(true);
    const notify = vi.fn();
    const token: TokenState = { token: null, storage: 'session', save, clear: vi.fn() };

    await act(async () => {
      root.render(
        <StrictMode>
          <TokenSettings token={token} notify={notify} />
        </StrictMode>,
      );
    });

    const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    const form = container.querySelector('form')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

    await act(async () => {
      setValue.call(input, 'pst-全角トークン');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(save).not.toHaveBeenCalled();
    const err = container.querySelector<HTMLElement>('.form-error[role="alert"]');
    expect(err?.textContent).toContain('半角英数字・記号以外');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    await act(async () => {
      setValue.call(input, 'Bearer pst-valid_123');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('.form-error')).toBeNull();

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(save).toHaveBeenCalledWith('pst-valid_123', 'session');
    expect(notify).toHaveBeenCalledWith('トークンを保存しました');
  });
});

describe('useGenerator', () => {
  let root: Root;
  let generator: Generator;
  let onImages: ReturnType<typeof vi.fn<(images: NewImage[]) => void>>;

  function Harness() {
    generator = useGenerator(onImages);
    return null;
  }

  beforeEach(() => {
    onImages = vi.fn<(images: NewImage[]) => void>();
    root = createRoot(document.createElement('div'));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it('タイムアウト時はエラーを表示し、手動キャンセル時はエラーを出さずロックも解除される', async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      );
    });

    // 1) タイムアウト相当（AbortSignal は未中断のまま TimeoutError で失敗）
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    await act(async () => {
      await generator.generate({
        token: 'pst-valid',
        prompt: '1girl',
        negative: '',
        characters: [],
        settings: DEFAULT_GENERATION,
      });
    });
    expect(generator.generating).toBe(false);
    expect(generator.error).toContain('タイムアウト');

    // 2) 手動キャンセル（ロックが解除されているので再実行でき、キャンセル時はエラーにならない）
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = generator.generate({
        token: 'pst-valid',
        prompt: '1girl',
        negative: '',
        characters: [],
        settings: DEFAULT_GENERATION,
      });
    });
    expect(generator.generating).toBe(true);
    await act(async () => {
      generator.cancel();
      await pending;
    });
    expect(generator.generating).toBe(false);
    expect(generator.error).toBeNull();
  });
});
