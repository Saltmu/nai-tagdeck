// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
import { TabSyncNotice } from '../src/components/TabSyncNotice';
import { useImages } from '../src/hooks/useImages';
import { useTabSync } from '../src/hooks/useTabSync';
import { getKV, listEntries, replaceAllEntries, replaceKV, setKV } from '../src/lib/db';
import { requestImages } from '../src/lib/novelai';
import { getTabSyncConflict, receiveTabSyncMessage, resetTabSyncForTests } from '../src/lib/tabSync';

vi.mock('../src/lib/db', () => {
  class StaleWriteError extends Error {
    readonly name = 'StaleWriteError';
    constructor(readonly scope: string) { super(`stale ${scope}`); }
  }
  return {
    getKV: vi.fn(),
    setKV: vi.fn(),
    listEntries: vi.fn(),
    replaceAllEntries: vi.fn(),
    replaceKV: vi.fn(),
    readSyncEpoch: vi.fn(async () => 0),
    putEntry: vi.fn(),
    putEntries: vi.fn(),
    deleteEntry: vi.fn(),
    clearAllData: vi.fn(),
    KV_KEYS: ['workspace', 'settings', 'generation', 'presets', 'activePreset'],
    StaleWriteError,
  };
});
vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  requestImages: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));

let container: HTMLDivElement;
let root: Root;
let workspaceValue: { base: { quality: Array<{ tag: string; enabled: boolean; weight: number }> }; negative: [] };

function button(text: string, scope: ParentNode = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find((node) => node.textContent?.trim() === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

beforeEach(() => {
  resetTabSyncForTests();
  vi.clearAllMocks();
  workspaceValue = { base: { quality: [{ tag: 'tab-sync-local', enabled: true, weight: 1 }] }, negative: [] };
  vi.mocked(getKV).mockImplementation(async (key) => (key === 'workspace' ? workspaceValue : undefined));
  vi.mocked(setKV).mockResolvedValue(undefined);
  vi.mocked(listEntries).mockResolvedValue([]);
  vi.mocked(replaceAllEntries).mockResolvedValue(undefined);
  vi.mocked(replaceKV).mockResolvedValue(undefined);
  vi.mocked(requestImages).mockResolvedValue([{ blob: new Blob(['png'], { type: 'image/png' }) }]);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:tab-sync';
    static revokeObjectURL = () => {};
  });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function show(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function hide(this: HTMLDialogElement) { this.open = false; } },
  });
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  sessionStorage.setItem('nai-tagdeck.token', 'test-token');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  resetTabSyncForTests();
  dialogMethods.forEach((name, index) => {
    const descriptor = originalDialogMethods[index];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

describe('TabSyncNotice', () => {
  it('shows the updated and reset copy', () => {
    const onReload = vi.fn();
    const onPrefer = vi.fn();
    act(() => {
      root.render(
        <TabSyncNotice
          conflict={{ kind: 'updated', scopes: ['workspace'] }}
          busy={false}
          error={null}
          onReload={onReload}
          onPrefer={onPrefer}
        />,
      );
    });
    expect(container.textContent).toContain('別のタブでデータが更新されました。上書きを防ぐため、このタブの自動保存を停止しています。');
    act(() => {
      root.render(
        <TabSyncNotice
          conflict={{ kind: 'reset', scopes: ['reset'] }}
          busy={false}
          error={null}
          onReload={onReload}
          onPrefer={onPrefer}
        />,
      );
    });
    expect(container.textContent).toContain('別のタブですべてのデータが削除されました。このタブの自動保存を停止しています。');
  });

  it('reloads indexed data without dropping in-memory images', async () => {
    function Harness() {
      const images = useImages();
      const [note, setNote] = useState('before');
      const sync = useTabSync({
        confirmOverwrite: async () => false,
        reloadStores: async () => { setNote('after'); },
        saveLocal: async () => {},
        readEpoch: async () => 0,
        resyncToken: () => {},
      });
      return (
        <>
          <button type="button" onClick={() => images.add([{
            blob: new Blob(['png']), seed: 1, width: 64, height: 64, prompt: '1girl', characterPrompts: [], createdAt: 1,
          }])}>画像を足す</button>
          <p data-images={images.images.length}>{note}</p>
          <TabSyncNotice conflict={sync.conflict} busy={sync.busy} error={sync.error} onReload={sync.reloadLatest} onPrefer={sync.preferLocal} />
        </>
      );
    }
    await act(async () => root.render(<Harness />));
    await act(async () => button('画像を足す').click());
    expect(container.querySelector('[data-images]')?.getAttribute('data-images')).toBe('1');
    await act(async () => {
      receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'workspace', seq: 1, at: 1 });
    });
    expect(container.textContent).toContain('別のタブでデータが更新されました');
    await act(async () => button('最新のデータを読み込む').click());
    expect(container.textContent).toContain('after');
    expect(container.querySelector('[data-images]')?.getAttribute('data-images')).toBe('1');
    expect(getTabSyncConflict()).toBeNull();
  });

  it('resyncs the token only when the other tab reset everything', async () => {
    const resyncToken = vi.fn();
    function Harness() {
      const sync = useTabSync({
        confirmOverwrite: async () => false,
        reloadStores: async () => {},
        saveLocal: async () => {},
        readEpoch: async () => 0,
        resyncToken,
      });
      return <TabSyncNotice conflict={sync.conflict} busy={sync.busy} error={sync.error} onReload={sync.reloadLatest} onPrefer={sync.preferLocal} />;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => {
      receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'settings', seq: 1, at: 1 });
    });
    await act(async () => button('最新のデータを読み込む').click());
    expect(resyncToken).not.toHaveBeenCalled();
    await act(async () => {
      receiveTabSyncMessage({ type: 'reset', senderId: 'other-tab', scope: 'reset', seq: 2, at: 2 });
    });
    await act(async () => button('最新のデータを読み込む').click());
    expect(resyncToken).toHaveBeenCalledOnce();
  });

  it('includes a scope that arrives while the reset generation is checked again', async () => {
    let releaseEpoch!: (epoch: number) => void;
    const saveLocal = vi.fn(async () => {});
    function Harness() {
      const sync = useTabSync({
        confirmOverwrite: async () => true,
        reloadStores: async () => {},
        saveLocal,
        readEpoch: vi.fn()
          .mockResolvedValueOnce(0)
          .mockImplementationOnce(() => new Promise<number>((resolve) => { releaseEpoch = resolve; })),
        resyncToken: () => {},
      });
      return <TabSyncNotice conflict={sync.conflict} busy={sync.busy} error={sync.error} onReload={sync.reloadLatest} onPrefer={sync.preferLocal} />;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => {
      receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'settings', seq: 1, at: 1 });
    });
    await act(async () => button('このタブの内容を優先して保存する').click());
    await act(async () => {
      receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'workspace', seq: 2, at: 2 });
      releaseEpoch(0);
    });
    expect(saveLocal).toHaveBeenCalledWith(expect.objectContaining({
      scopes: expect.arrayContaining(['settings', 'workspace']),
    }), 0);
  });

  it('shows a notice when the reset generation cannot be read', async () => {
    function Harness() {
      const sync = useTabSync({
        confirmOverwrite: async () => true,
        reloadStores: async () => {},
        saveLocal: async () => {},
        readEpoch: async () => { throw new Error('idb down'); },
        resyncToken: () => {},
      });
      return <TabSyncNotice conflict={sync.conflict} busy={sync.busy} error={sync.error} onReload={sync.reloadLatest} onPrefer={sync.preferLocal} />;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => {
      receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'settings', seq: 1, at: 1 });
    });
    await act(async () => button('このタブの内容を優先して保存する').click());
    expect(container.textContent).toContain('このタブの内容を保存できません');
    expect(container.textContent).toContain('idb down');
  });
});

describe('App tab sync', () => {
  it('stops autosave, reloads the latest workspace, and can save this tab over the other one', async () => {
    await act(async () => root.render(<DialogProvider><App onResetAll={() => {}} /></DialogProvider>));
    expect(container.textContent).toContain('tab-sync-local');
    await act(async () => {
      receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'workspace', seq: 1, at: 1 });
    });
    expect(container.textContent).toContain('別のタブでデータが更新されました。上書きを防ぐため、このタブの自動保存を停止しています。');

    workspaceValue = { base: { quality: [{ tag: 'tab-sync-remote', enabled: true, weight: 1 }] }, negative: [] };
    await act(async () => button('最新のデータを読み込む').click());
    expect(container.textContent).toContain('tab-sync-remote');
    expect(container.textContent).not.toContain('このタブの自動保存を停止しています');

    await act(async () => {
      receiveTabSyncMessage({ type: 'reset', senderId: 'other-tab', scope: 'reset', seq: 2, at: 2 });
    });
    expect(container.textContent).toContain('別のタブですべてのデータが削除されました');
    await act(async () => button('このタブの内容を優先して保存する').click());
    const dialog = container.querySelector('dialog');
    expect(dialog?.textContent).toContain('別のタブでの変更を上書きし、このタブの内容を保存しますか？');
    await act(async () => button('上書きして保存', dialog!).click());
    expect(replaceKV).toHaveBeenCalledWith('workspace', expect.objectContaining({
      base: expect.objectContaining({
        quality: expect.arrayContaining([expect.objectContaining({ tag: 'tab-sync-remote' })]),
      }),
    }), 0);
    expect(replaceAllEntries).toHaveBeenCalledWith([], 0);
    expect(container.textContent).not.toContain('このタブの自動保存を停止しています');
  });

  it('keeps a generated image when the latest data is loaded', async () => {
    await act(async () => root.render(<DialogProvider><App onResetAll={() => {}} /></DialogProvider>));
    await act(async () => button('生成').click());
    await act(async () => button('生成する').click());
    expect(requestImages).toHaveBeenCalled();
    expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
    const imagesBefore = container.querySelectorAll('img').length;
    await act(async () => {
      receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'generation', seq: 3, at: 3 });
    });
    workspaceValue = { base: { quality: [{ tag: 'tab-sync-reloaded', enabled: true, weight: 1 }] }, negative: [] };
    await act(async () => button('最新のデータを読み込む').click());
    expect(container.textContent).toContain('tab-sync-reloaded');
    expect(container.querySelectorAll('img').length).toBe(imagesBefore);
  });

  it('keeps this tab when reloading fails before every store is read', async () => {
    await act(async () => root.render(<DialogProvider><App onResetAll={() => {}} /></DialogProvider>));
    expect(container.textContent).toContain('tab-sync-local');
    await act(async () => {
      receiveTabSyncMessage({ type: 'updated', senderId: 'other-tab', scope: 'workspace', seq: 4, at: 4 });
    });
    vi.mocked(listEntries).mockRejectedValueOnce(new Error('dict down'));
    workspaceValue = { base: { quality: [{ tag: 'tab-sync-should-stay', enabled: true, weight: 1 }] }, negative: [] };
    await act(async () => button('最新のデータを読み込む').click());
    expect(container.textContent).toContain('最新のデータを読み込めません');
    expect(container.textContent).toContain('tab-sync-local');
    expect(container.textContent).not.toContain('tab-sync-should-stay');
  });
});
