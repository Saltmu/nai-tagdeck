// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenSettings } from '../src/components/TokenSettings';
import { DialogProvider } from '../src/components/Dialogs';
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
          <DialogProvider>
            <TokenSettings token={token} notify={notify} />
          </DialogProvider>
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

  it('送信した正規化済みのプロンプトとパラメータを画像に記録する', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(png, { status: 200 }))));
    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      await generator.generate({
        token: 'pst-valid',
        prompt: '1girl',
        negative: 'lowres',
        characters: [
          { prompt: 'wolf', negative: 'alias', center: { x: 0.2, y: 0.8 } },
          { prompt: 'cat', negative: '' },
        ],
        settings: {
          ...DEFAULT_GENERATION,
          mode: 'furry',
          steps: 50,
          scale: 5.55,
          sampler: 'k_euler',
          noiseSchedule: 'exponential',
          seed: 42,
          cfgRescale: 0.234,
          dynamicThresholding: true,
        },
      });
    });

    expect(onImages).toHaveBeenCalledTimes(1);
    expect(onImages.mock.calls[0]![0][0]).toMatchObject({
      seed: 42,
      width: 832,
      height: 1216,
      prompt: 'fur dataset, 1girl',
      characterPrompts: ['wolf', 'cat'],
      negativePrompt: 'lowres',
      characterDetails: [
        { prompt: 'wolf', negative: 'alias', center: { x: 0.2, y: 0.8 } },
        { prompt: 'cat', negative: '', center: { x: 0.5, y: 0.5 } },
      ],
      params: {
        mode: 'furry',
        steps: 28,
        scale: 5.6,
        sampler: 'k_euler',
        noiseSchedule: 'exponential',
        cfgRescale: 0.23,
        dynamicThresholding: true,
      },
    });

    await act(async () => {
      await generator.generate({
        token: 'pst-valid',
        prompt: 'solo',
        negative: '',
        characters: [{ prompt: 'girl', negative: 'lowres' }],
        settings: DEFAULT_GENERATION,
      });
    });
    const second = onImages.mock.calls[1]![0][0]!;
    expect(second.prompt).toBe('solo');
    expect(second.negativePrompt).toBe('');
    expect(second.characterDetails).toEqual([{ prompt: 'girl', negative: 'lowres' }]);
    expect(second.params).toMatchObject({ mode: 'anime', dynamicThresholding: false });

    await act(async () => {
      await generator.generate({
        token: 'pst-valid',
        prompt: 'fur dataset, wolf',
        negative: '',
        characters: [],
        settings: { ...DEFAULT_GENERATION, mode: 'anime', seed: 1 },
      });
    });
    const third = onImages.mock.calls[2]![0][0]!;
    expect(third.prompt).toBe('fur dataset, wolf');
    expect(third.params?.mode).toBe('furry');
  });
});

describe('TokenSettings の保存理由と削除確認', () => {
  let container: HTMLDivElement;
  let root: Root;
  const dialogPrototype = HTMLDialogElement.prototype;
  const dialogMethods = ['showModal', 'close'] as const;
  const originalDialogMethods = dialogMethods.map((name) =>
    Object.getOwnPropertyDescriptor(dialogPrototype, name),
  );

  beforeEach(() => {
    Object.defineProperties(dialogPrototype, {
      showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    for (const [i, name] of dialogMethods.entries()) {
      const descriptor = originalDialogMethods[i];
      if (descriptor) Object.defineProperty(dialogPrototype, name, descriptor);
      else Reflect.deleteProperty(dialogPrototype, name);
    }
  });

  const renderSettings = (token: TokenState, notify: (message: string) => void) =>
    act(async () => {
      root.render(
        <StrictMode>
          <DialogProvider>
            <TokenSettings token={token} notify={notify} />
          </DialogProvider>
        </StrictMode>,
      );
    });

  const saveButton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const deleteButton = () =>
    [...container.querySelectorAll('button')].find((node) => node.textContent === '削除')!;
  const setTokenInput = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('入力が空の間は保存が押せない理由を表示し、入力すると消える', async () => {
    await renderSettings({ token: null, storage: 'session', save: vi.fn(), clear: vi.fn() }, vi.fn());
    expect(saveButton().disabled).toBe(true);
    expect(container.textContent).toContain('トークンを入力すると「保存」が押せるようになります');

    await setTokenInput('pst-valid_123');
    expect(saveButton().disabled).toBe(false);
    expect(container.textContent).not.toContain('トークンを入力すると「保存」が押せるようになります');
  });

  it('削除は確認ダイアログを出し、キャンセルでは消さず、確定で消す', async () => {
    const clear = vi.fn();
    const notify = vi.fn();
    await renderSettings({ token: 'pst-abcdefgh1234', storage: 'local', save: vi.fn(), clear }, notify);

    await act(async () => deleteButton().click());
    const dialog = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm')!;
    expect(dialog.textContent).toContain('削除すると生成ができなくなります');
    await act(async () => dialog.querySelector<HTMLButtonElement>('button.btn:not(.btn-danger)')!.click());
    expect(clear).not.toHaveBeenCalled();

    await act(async () => deleteButton().click());
    const confirm = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm')!;
    await act(async () => confirm.querySelector<HTMLButtonElement>('button.btn-danger')!.click());
    expect(clear).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith('トークンを削除しました');
  });
});
