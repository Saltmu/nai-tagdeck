// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorialApp } from '../src/tutorial/TutorialApp';
import { SettingsView } from '../src/components/SettingsView';
import { TokenSettings } from '../src/components/TokenSettings';
import { DialogProvider, useDialogs } from '../src/components/Dialogs';
import { tutorialUrl } from '../src/lib/tutorialLinks';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function clickButton(label: string) {
  const buttons = Array.from(container.querySelectorAll('button'));
  const target = buttons.find((b) => b.textContent?.trim() === label);
  if (!target) throw new Error(`Button not found: ${label}`);
  act(() => {
    target.click();
  });
}

describe('tutorial entry links', () => {
  it('renders tutorial links in SettingsView and TokenSettings opening in a new tab', async () => {
    const token = { token: '', storage: 'session' as const, save: vi.fn(), clear: vi.fn(), resync: vi.fn() };
    await act(async () => {
      root.render(
        <DialogProvider>
          <SettingsView
            token={token}
            notify={vi.fn()}
            getBackup={vi.fn() as never}
            onImportBackup={vi.fn()}
            onResetAll={vi.fn()}
            onShowFirstRun={vi.fn()}
            firstRunDisabled={false}
          />
        </DialogProvider>,
      );
    });

    const howtoLink = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === '操作チュートリアルを開く',
    );
    expect(howtoLink?.getAttribute('target')).toBe('_blank');
    expect(howtoLink?.getAttribute('href')).toContain('tutorial/?view=chapters');

    const tokenLink = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'APIトークンの発行方法を見る',
    );
    expect(tokenLink?.getAttribute('target')).toBe('_blank');
    expect(tokenLink?.getAttribute('href')).toContain('scene=issue-token');
    expect(tokenLink?.getAttribute('href')).toContain('from=token-settings');
  });

  it('renders external tutorial link inside Dialogs choose options', async () => {
    let openChoose: (() => void) | undefined;
    function Trigger() {
      const dialogs = useDialogs();
      openChoose = () => {
        void dialogs.choose('説明', [{ value: 'sample', label: '見本', description: 'desc', primary: true }], {
          title: '初回案内',
          links: [{ label: 'チュートリアルで試す', href: tutorialUrl({ scene: 'example', from: 'first-run' }) }],
        });
      };
      return null;
    }

    // jsdom の HTMLDialogElement.showModal モック
    HTMLDialogElement.prototype.showModal ??= function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.removeAttribute('open');
    };

    await act(async () => {
      root.render(
        <DialogProvider>
          <Trigger />
        </DialogProvider>,
      );
    });
    await act(async () => {
      openChoose?.();
    });

    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.includes('チュートリアルで試す'),
    );
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('href')).toContain('scene=example');
  });

  it('renders TokenSettings standalone with tutorial link', async () => {
    const token = { token: '', storage: 'session' as const, save: vi.fn(), clear: vi.fn(), resync: vi.fn() };
    await act(async () => {
      root.render(<TokenSettings token={token} notify={vi.fn()} />);
    });
    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'APIトークンの発行方法を見る',
    );
    expect(link).toBeTruthy();
  });
});

describe('TutorialApp', () => {
  it('completes the full flow without API calls or persistent storage writes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    await act(async () => {
      root.render(<TutorialApp initialSearch="" />);
    });

    expect(container.textContent).toContain('夕暮れの街を歩く人物');
    clickButton('トークン発行から体験する');
    clickButton('Settings');
    clickButton('Account');
    clickButton('Get Persistent API Token');
    expect(container.textContent).toContain('Overwrite');
    clickButton('Overwrite');
    clickButton('コピー');
    clickButton('練習用トークンを貼り付け');
    clickButton('保存');
    clickButton('タグの例と辞書を読み込む');

    // 日本語「夕焼け」で候補から sunset を選び、同じ画面で反映を確認してから次へ進む
    const tagInput = container.querySelector('input[placeholder*="夕焼け"]') as HTMLInputElement | null;
    expect(tagInput).toBeTruthy();
    await act(async () => {
      tagInput!.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(tagInput!, '夕焼け');
      tagInput!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sunsetOption = Array.from(container.querySelectorAll('[role="option"]')).find((el) =>
      el.textContent?.includes('sunset'),
    ) as HTMLElement | undefined;
    expect(sunsetOption).toBeTruthy();
    await act(async () => {
      sunsetOption!.click();
    });
    // 追加直後も編集画面に留まり、プロンプトに sunset が反映されていることを確認できる
    expect(container.textContent).toContain('sunset');
    expect(container.textContent).toContain('カテゴリとプロンプトに反映されました');
    clickButton('確認して次へ');

    // キャラの hat を OFF にする（編集欄に残ったままプロンプトから外れ、その場で確認できる）
    const hatCheckbox = Array.from(container.querySelectorAll('input[type="checkbox"]')).find((el) =>
      el.parentElement?.textContent?.includes('hat'),
    ) as HTMLInputElement | undefined;
    expect(hatCheckbox).toBeTruthy();
    await act(async () => {
      hatCheckbox!.click();
    });
    expect(container.textContent).toContain('OFF（編集欄に残る）');
    expect(container.textContent).toContain('タグは編集欄に残ったまま、プロンプトから外れました');
    clickButton('確認して次へ');

    // 生成ボタンを押して完了画面へ
    clickButton('生成');
    expect(container.textContent).toContain('準備完了です！');
    expect(container.textContent).toContain('nai-tagdeckで実際に生成する');

    // コピー手順を表示
    clickButton('プロンプトのコピー手順を見る');
    expect(container.textContent).toContain('ベースとキャラそれぞれの「コピー」ボタン');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('supports jumping directly to tag editing and opening via URL query', async () => {
    await act(async () => {
      root.render(<TutorialApp initialSearch="?view=chapters" />);
    });
    expect(container.querySelector('.tutorial-chapters')).toBeTruthy();

    clickButton('設定済み・タグ編集から始める');
    expect(container.textContent).toContain('タグの例と辞書を読み込む');
  });

  it('shows token-settings return guidance when opened from token settings', async () => {
    await act(async () => {
      root.render(<TutorialApp initialSearch="?scene=issue-token&from=token-settings" />);
    });
    expect(container.textContent).toContain('NovelAIで実際に発行');

    // 完了画面までスキップ
    for (let i = 0; i < 12; i++) {
      const nextBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === '次へ' && !b.disabled,
      );
      if (!nextBtn) break;
      act(() => nextBtn.click());
    }
    expect(container.textContent).toContain('元のタブでは「NovelAI のトークン」欄が開いたまま');
  });

  it('supports watch mode pause and resume', async () => {
    await act(async () => {
      root.render(<TutorialApp initialSearch="" />);
    });
    clickButton('見るだけ');
    clickButton('一時停止');
    expect(container.textContent).toContain('再生');
  });

  it('rejects real tokens in the practice input and does not overwrite system clipboard on practice copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    await act(async () => {
      root.render(<TutorialApp initialSearch="?scene=issue-token" />);
    });
    clickButton('Settings');
    clickButton('Account');
    clickButton('Get Persistent API Token');
    clickButton('Overwrite');
    clickButton('コピー');
    expect(writeText).not.toHaveBeenCalled();

    const tokenField = container.querySelector('input[type="password"]') as HTMLInputElement | null;
    expect(tokenField).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(tokenField!, 'pst-real-user-secret-token-123456');
      tokenField!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(tokenField!.value).toBe('');
    expect(container.textContent).toContain('実トークンは練習画面には入力できません');
  });
});
