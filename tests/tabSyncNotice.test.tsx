// @vitest-environment jsdom
import { openDB } from 'idb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DialogProvider } from '../src/components/Dialogs';
import { clearAllData, DB_VERSION, readAllAppData, setBaseMetaForTests } from '../src/lib/db';
import * as dbModule from '../src/lib/db';
import { requestImages } from '../src/lib/novelai';
import { resetTabSyncForTests, TAB_SYNC_STORAGE_KEY } from '../src/lib/tabSync';
import { loadToken, saveToken } from '../src/lib/token';
import { emptyWorkspace, workspaceReducer } from '../src/lib/workspace';

vi.mock('../src/lib/novelai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/novelai')>(),
  requestImages: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

class FakeBroadcastChannel {
  static instances = new Set<FakeBroadcastChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.add(this);
  }

  postMessage(data: unknown): void {
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer !== this && !peer.closed && peer.name === this.name) {
        peer.onmessage?.({ data } as MessageEvent);
      }
    }
  }

  close(): void {
    this.closed = true;
    FakeBroadcastChannel.instances.delete(this);
  }
}

let container: HTMLDivElement;
let root: Root;
const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function button(text: string, scope: ParentNode = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find(
    (node) =>
      node.textContent?.trim() === text ||
      node.getAttribute('aria-label') === text ||
      node.getAttribute('title') === text,
  );
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

const click = (node: HTMLElement) => act(async () => node.click());
const flush = async (ms = 50) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

async function writeFromOtherTab(
  patch: {
    workspace?: unknown;
    dictionary?: Array<{ id: string; tag: string; category: string; alias: string; default_weight: number; sort_order: number; updated_at: string }>;
  },
  notify = true,
): Promise<void> {
  const db = await openDB('nai-tagdeck', DB_VERSION);
  try {
    const tx = db.transaction(['dictionary', 'kv', 'meta'], 'readwrite');
    const raw = (await tx.objectStore('meta').get('sync')) as { rev?: number; epoch?: number } | undefined;
    const next = { rev: (raw?.rev ?? 0) + 1, epoch: raw?.epoch ?? 0 };
    if (patch.workspace !== undefined) await tx.objectStore('kv').put(patch.workspace, 'workspace');
    if (patch.dictionary !== undefined) {
      await tx.objectStore('dictionary').clear();
      for (const entry of patch.dictionary) await tx.objectStore('dictionary').put(entry);
    }
    await tx.objectStore('meta').put(next, 'sync');
    await tx.done;
  } finally {
    db.close();
  }
  if (notify) {
    const peer = new FakeBroadcastChannel('nai-tagdeck:sync');
    peer.postMessage({ type: 'updated', senderId: 'other-tab', seq: Date.now(), at: Date.now() });
    peer.close();
  }
}

async function resetFromOtherTab(notify = true): Promise<void> {
  const db = await openDB('nai-tagdeck', DB_VERSION);
  try {
    const tx = db.transaction(['dictionary', 'kv', 'meta'], 'readwrite');
    const raw = (await tx.objectStore('meta').get('sync')) as { rev?: number; epoch?: number } | undefined;
    const next = { rev: (raw?.rev ?? 0) + 1, epoch: (raw?.epoch ?? 0) + 1 };
    await tx.objectStore('dictionary').clear();
    await tx.objectStore('kv').clear();
    await tx.objectStore('meta').put(next, 'sync');
    await tx.done;
  } finally {
    db.close();
  }
  localStorage.removeItem('nai-tagdeck.token');
  if (notify) {
    const peer = new FakeBroadcastChannel('nai-tagdeck:sync');
    peer.postMessage({ type: 'reset', senderId: 'other-tab', seq: Date.now(), at: Date.now() });
    peer.close();
  }
}

beforeEach(async () => {
  FakeBroadcastChannel.instances.clear();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  resetTabSyncForTests();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('nai-tagdeck:first-run-complete', 'true');
  setBaseMetaForTests(null);
  await clearAllData();

  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  let urlSeq = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${++urlSeq}`);
  URL.revokeObjectURL = vi.fn();

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetTabSyncForTests();
  FakeBroadcastChannel.instances.clear();
  vi.unstubAllGlobals();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  dialogMethods.forEach((name, i) => {
    const d = originalDialogMethods[i];
    if (d) Object.defineProperty(HTMLDialogElement.prototype, name, d);
  });
  localStorage.removeItem(TAB_SYNC_STORAGE_KEY);
});

async function mountApp() {
  await act(async () => {
    root.render(
      <DialogProvider>
        <App onResetAll={() => {}} />
      </DialogProvider>,
    );
  });
  await flush(80);
}

describe('multi-tab sync notice & conflict resolution', () => {
  it('pauses autosave on other-tab update, reloads latest without losing generated images, and closes dictionary drafts', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'masterpiece' });
    await writeFromOtherTab({
      workspace: initialWs,
      dictionary: [{ id: 'd1', tag: 'smile', category: 'appearance', alias: '笑顔', default_weight: 1, sort_order: 0, updated_at: '2026-01-01' }],
    }, false);
    saveToken('pst-valid-token', 'local');
    vi.mocked(requestImages).mockResolvedValueOnce([{ blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), seed: 777 }]);

    await mountApp();
    // 1 枚生成してメモリ上の画像履歴を作る
    await click(button('生成する（Ctrl+Enter）'));
    await flush(50);
    expect(container.querySelectorAll('.gallery .thumb-frame')).toHaveLength(1);

    // 辞書タブで編集フォームを開く
    await click(button('辞書'));
    await click(button('編集', container.querySelector('.dictionary')!));
    expect(container.querySelector('.entry-form')).not.toBeNull();

    // 別タブが workspace と辞書を更新する
    const otherWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'from-other-tab' });
    await act(async () => {
      await writeFromOtherTab({
        workspace: otherWs,
        dictionary: [{ id: 'd2', tag: 'moonlight', category: 'background', alias: '月明かり', default_weight: 1, sort_order: 0, updated_at: '2026-01-02' }],
      }, true);
    });

    const notice = container.querySelector('.tab-sync');
    expect(notice?.textContent).toContain('別のタブでデータが更新されました');

    // ロック中は編集タブで変更して pagehide しても IndexedDB を上書きしない
    await click(button('編集'));
    const quickPick = button('best quality');
    await click(quickPick);
    window.dispatchEvent(new Event('pagehide'));
    await flush(350);
    const dbWhileLocked = await readAllAppData();
    expect((dbWhileLocked.kv.workspace as typeof otherWs).base.quality.map((t) => t.tag)).toEqual(['from-other-tab']);

    // 「最新のデータを読み込む」を実行
    await click(button('最新のデータを読み込む', notice!));
    await flush(80);

    expect(container.querySelector('.tab-sync')).toBeNull();
    // 生成画像履歴は維持されている
    expect(container.querySelectorAll('.gallery .thumb-frame')).toHaveLength(1);
    // 最新ワークスペースが反映されている
    expect(container.querySelector('output.preview-text')?.textContent).toContain('from-other-tab');
    // 辞書タブの下書きが閉じ、最新辞書が表示される
    await click(button('辞書'));
    expect(container.querySelector('.entry-form')).toBeNull();
    expect(container.textContent).toContain('moonlight');
  });

  it('resyncs token and clears workspace when reloading after other-tab reset', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'masterpiece' });
    await writeFromOtherTab({ workspace: initialWs }, false);
    saveToken('pst-token-123', 'local');

    await mountApp();
    expect(loadToken().token).toBe('pst-token-123');

    await act(async () => {
      await resetFromOtherTab(true);
    });
    const notice = container.querySelector('.tab-sync');
    expect(notice?.textContent).toContain('別のタブですべてのデータが削除されました');

    await click(button('最新のデータを読み込む', notice!));
    await flush(80);

    expect(container.querySelector('.tab-sync')).toBeNull();
    expect(container.querySelector('output.preview-text')?.textContent).toBe('ONのタグがありません');
    // トークンも削除状態に同期されている
    await click(button('設定'));
    expect(container.querySelector('.token-status')?.textContent).toContain('未設定');
  });

  it('prefers local state atomically after confirmation and rejects if another tab writes during confirmation', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'local-tag' });
    await writeFromOtherTab({ workspace: initialWs }, false);

    await mountApp();
    // 別タブが更新
    const otherWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'other-tab-tag' });
    await act(async () => {
      await writeFromOtherTab({ workspace: otherWs }, true);
    });

    // 1 回目: 確認ダイアログ表示中にさらに別タブが更新 → 上書き拒否でロック維持
    await click(button('このタブの内容を優先して保存する'));
    await flush(30);
    // 確認中も header/main は inert
    expect(container.querySelector('header')?.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('main')?.hasAttribute('inert')).toBe(true);

    const confirm1 = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm');
    expect(confirm1?.open).toBe(true);

    const thirdWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'third-update' });
    await act(async () => {
      await writeFromOtherTab({ workspace: thirdWs }, true);
    });
    await click(button('上書きして保存', confirm1!));
    await flush(80);

    expect(container.querySelector('.tab-sync')?.textContent).toContain('確認のあとで別のタブが保存したため');
    expect((await readAllAppData()).kv.workspace).toMatchObject({ base: { quality: [expect.objectContaining({ tag: 'third-update' })] } });

    // 2 回目: 妨害なしで優先保存 → 成功してロック解除
    await click(button('このタブの内容を優先して保存する'));
    await flush(30);
    const confirm2 = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm');
    await click(button('上書きして保存', confirm2!));
    await flush(80);

    expect(container.querySelector('.tab-sync')).toBeNull();
    const after = await readAllAppData();
    expect((after.kv.workspace as typeof initialWs).base.quality.map((t) => t.tag)).toEqual(['local-tag']);
  });

  it('transitions to conflict notice without error banner when autosave hits StaleWriteError', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'masterpiece' });
    await writeFromOtherTab({ workspace: initialWs }, false);

    await mountApp();
    // 通知なしで別タブが DB を更新する（通知遅延・未着の再現）
    const silentWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'silent-other' });
    await writeFromOtherTab({ workspace: silentWs }, false);

    // このタブで編集して保存を試みる
    await click(button('best quality'));
    await flush(400);

    // エラーバナーではなく競合バナーになり、DB は silent-other のまま守られる
    expect(container.querySelector('.error-banner')).toBeNull();
    expect(container.querySelector('.tab-sync')?.textContent).toContain('別のタブでデータが更新されました');
    const saved = await readAllAppData();
    expect((saved.kv.workspace as typeof silentWs).base.quality.map((t) => t.tag)).toEqual(['silent-other']);
  });

  it('disables Ctrl+Enter generation and Ctrl+Z undo while reloadLatest is in flight', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'masterpiece' });
    await writeFromOtherTab({ workspace: initialWs }, false);
    saveToken('pst-valid-token', 'local');
    vi.mocked(requestImages).mockReset();

    await mountApp();
    // 1 つ操作して Undo 履歴を作る
    await click(button('best quality'));
    expect(container.querySelector('output.preview-text')?.textContent).toContain('best quality');

    const otherWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'reloaded-tag' });
    await act(async () => {
      await writeFromOtherTab({ workspace: otherWs }, true);
    });

    // readAllAppData を一時的に保留して busy 中のショートカットを検証する
    let releaseReload!: () => void;
    const realReadAll = dbModule.readAllAppData;
    const spy = vi.spyOn(dbModule, 'readAllAppData').mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseReload = resolve; });
      return realReadAll();
    });

    await click(button('最新のデータを読み込む'));
    await flush(10);
    expect(container.querySelector('main')?.hasAttribute('inert')).toBe(true);

    // busy 中は Ctrl+Enter も Ctrl+Z も効かない
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    });
    expect(requestImages).not.toHaveBeenCalled();
    expect(container.querySelector('output.preview-text')?.textContent).toContain('best quality');

    await act(async () => { releaseReload(); });
    await flush(80);
    spy.mockRestore();

    expect(container.querySelector('output.preview-text')?.textContent).toContain('reloaded-tag');
  });

  it('resyncs deleted shared token when epoch changes even if reset notification was missed, while keeping session token', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'masterpiece' });
    await writeFromOtherTab({ workspace: initialWs }, false);
    saveToken('pst-shared-local-token', 'local');

    await mountApp();
    // リセット通知を見逃し、後から通常更新通知だけ届いたケースを再現
    await resetFromOtherTab(false);
    const postResetWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'after-reset' });
    await act(async () => {
      await writeFromOtherTab({ workspace: postResetWs }, true);
    });

    const notice = container.querySelector('.tab-sync');
    expect(notice?.textContent).toContain('別のタブでデータが更新されました');
    await click(button('最新のデータを読み込む', notice!));
    await flush(80);

    await click(button('設定'));
    expect(container.querySelector('.token-status')?.textContent).toContain('未設定');

    // タブ限定の sessionStorage トークンは別タブの削除で消えないことも確認
    saveToken('pst-tab-only-token', 'session');
    await act(async () => root.unmount());
    root = createRoot(container);
    await mountApp();
    await resetFromOtherTab(false);
    await act(async () => {
      await writeFromOtherTab({ workspace: postResetWs }, true);
    });
    await click(button('最新のデータを読み込む'));
    await flush(80);
    await click(button('設定'));
    expect(container.querySelector('.token-status')?.textContent).toContain('設定済み');
    expect(container.querySelector('.token-status')?.textContent).toContain('このタブだけ');
  });

  it('aborts a pending backup import when latest data is reloaded while reading the file, preserving reloaded presets', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'masterpiece' });
    await writeFromOtherTab({ workspace: initialWs }, false);
    await mountApp();
    await click(button('設定'));

    // バックアップファイルの text() 読み取りを保留し、その間に他タブがプリセットを追加してこのタブで再読み込みする
    let releaseFileText!: (text: string) => void;
    const emptyBackupJson = JSON.stringify({
      app: 'nai-tagdeck',
      kind: 'backup',
      version: 1,
      dictionary: [],
      presets: [],
      workspace: emptyWorkspace(),
      settings: { weightSyntax: 'numeric', characterNegativePrompt: 'lowres, aliasing, ' },
      generation: { mode: 'anime', size: 'portrait', steps: 28, scale: 5, sampler: 'k_euler_ancestral', noiseSchedule: 'karras', seed: null, cfgRescale: 0, dynamicThresholding: false },
    });
    const file = new File([emptyBackupJson], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: () => new Promise<string>((resolve) => { releaseFileText = resolve; }),
    });

    const input = container.querySelector<HTMLInputElement>('.backup-actions input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // 他タブでプリセットを保存して通知
    const db = await openDB('nai-tagdeck', DB_VERSION);
    try {
      const tx = db.transaction(['kv', 'meta'], 'readwrite');
      const raw = (await tx.objectStore('meta').get('sync')) as { rev?: number; epoch?: number } | undefined;
      await tx.objectStore('kv').put([{ id: 'p-remote', name: '別タブのプリセット', workspace: initialWs, updated_at: '2026-01-01' }], 'presets');
      await tx.objectStore('meta').put({ rev: (raw?.rev ?? 0) + 1, epoch: raw?.epoch ?? 0 }, 'sync');
      await tx.done;
    } finally {
      db.close();
    }
    await act(async () => {
      const peer = new FakeBroadcastChannel('nai-tagdeck:sync');
      peer.postMessage({ type: 'updated', senderId: 'other-tab', seq: Date.now(), at: Date.now() });
      peer.close();
    });
    await click(button('最新のデータを読み込む'));
    await flush(80);

    // 保留していたファイル読み取りを完了させても、バックアップ適用は中止され別タブのプリセットが残る
    await act(async () => { releaseFileText(emptyBackupJson); });
    await flush(80);

    expect(container.querySelector('.form-error')?.textContent).toContain('中止しました');
    const saved = await readAllAppData();
    expect((saved.kv.presets as Array<{ name: string }>).map((p) => p.name)).toEqual(['別タブのプリセット']);
  });

  it('cancels a pending backup file read when Settings unmounts before file.text resolves', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'masterpiece' });
    await writeFromOtherTab({ workspace: initialWs }, false);
    await mountApp();
    await click(button('設定'));

    let releaseFileText!: (text: string) => void;
    const backupJson = JSON.stringify({
      app: 'nai-tagdeck',
      kind: 'backup',
      version: 1,
      dictionary: [],
      presets: [],
      workspace: emptyWorkspace(),
      settings: { weightSyntax: 'numeric', characterNegativePrompt: 'lowres, aliasing, ' },
      generation: { mode: 'anime', size: 'portrait', steps: 28, scale: 5, sampler: 'k_euler_ancestral', noiseSchedule: 'karras', seed: null, cfgRescale: 0, dynamicThresholding: false },
    });
    const file = new File([backupJson], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: () => new Promise<string>((resolve) => { releaseFileText = resolve; }),
    });

    const input = container.querySelector<HTMLInputElement>('.backup-actions input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // file.text() 完了前に編集タブへ移動して SettingsView / BackupCard をアンマウントする
    await click(button('編集'));
    await act(async () => { releaseFileText(backupJson); });
    await flush(50);

    expect(container.querySelector('dialog[open]')).toBeNull();
  });

  it('discards a dictionary file read started before reloading latest data', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'masterpiece' });
    await writeFromOtherTab({
      workspace: initialWs,
      dictionary: [{ id: 'd1', tag: 'smile', category: 'appearance', alias: '笑顔', default_weight: 1, sort_order: 0, updated_at: '2026-01-01' }],
    }, false);
    await mountApp();
    await click(button('辞書'));

    let releaseFileText!: (text: string) => void;
    const dictJson = JSON.stringify({ app: 'nai-tagdeck', version: 1, entries: [{ tag: 'old-import', category: 'quality' }] });
    const file = new File([dictJson], 'dict.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: () => new Promise<string>((resolve) => { releaseFileText = resolve; }),
    });

    const input = container.querySelector<HTMLInputElement>('.dict-toolbar input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      await writeFromOtherTab({
        dictionary: [{ id: 'd2', tag: 'fresh-tag', category: 'quality', alias: '', default_weight: 1, sort_order: 0, updated_at: '2026-01-02' }],
      }, true);
    });
    await click(button('最新のデータを読み込む'));
    await flush(80);

    // 再読み込み前に開始された file.text() が完了しても ImportPanel は開かない
    await act(async () => { releaseFileText(dictJson); });
    await flush(50);

    expect(container.querySelector('.import-panel')).toBeNull();
    expect(container.textContent).toContain('fresh-tag');
  });

  it('keeps existing screen intact if legacy workspace migration fails during reload, and migrates before unlocking on success', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'keep-me' });
    await writeFromOtherTab({
      workspace: initialWs,
      dictionary: [{ id: 'd1', tag: 'old-dict', category: 'quality', alias: '', default_weight: 1, sort_order: 0, updated_at: '2026-01-01' }],
    }, false);
    await mountApp();

    // 別タブが旧形式（negative なし）workspace と新辞書を保存した状態を再現
    const db = await openDB('nai-tagdeck', DB_VERSION);
    try {
      const tx = db.transaction(['dictionary', 'kv', 'meta'], 'readwrite');
      const raw = (await tx.objectStore('meta').get('sync')) as { rev?: number; epoch?: number } | undefined;
      await tx.objectStore('kv').put({ base: { quality: [{ id: 'q1', tag: 'legacy-tag', enabled: true, weight: 1 }] }, characters: [] }, 'workspace');
      await tx.objectStore('kv').put({ weightSyntax: 'numeric', negativePrompt: 'legacy-neg' }, 'settings');
      await tx.objectStore('dictionary').clear();
      await tx.objectStore('dictionary').put({ id: 'd2', tag: 'new-dict', category: 'quality', alias: '', default_weight: 1, sort_order: 0, updated_at: '2026-01-02' });
      await tx.objectStore('meta').put({ rev: (raw?.rev ?? 0) + 1, epoch: raw?.epoch ?? 0 }, 'sync');
      await tx.done;
    } finally {
      db.close();
    }
    await act(async () => {
      const peer = new FakeBroadcastChannel('nai-tagdeck:sync');
      peer.postMessage({ type: 'updated', senderId: 'other-tab', seq: Date.now(), at: Date.now() });
      peer.close();
    });

    // 1 回目: 移行保存に失敗 → 辞書も含め部分反映されず元の画面を維持
    const setKvSpy = vi.spyOn(dbModule, 'setKV').mockRejectedValueOnce(new Error('migration failed'));
    await click(button('最新のデータを読み込む'));
    await flush(80);
    setKvSpy.mockRestore();

    expect(container.querySelector('.tab-sync')?.textContent).toContain('migration failed');
    expect(container.querySelector('output.preview-text')?.textContent).toContain('keep-me');
    await click(button('辞書'));
    expect(container.textContent).toContain('old-dict');
    expect(container.textContent).not.toContain('new-dict');

    // 2 回目: 移行保存成功 → workspace 移行と辞書が揃って反映されロック解除
    await click(button('最新のデータを読み込む'));
    await flush(80);
    expect(container.querySelector('.tab-sync')).toBeNull();
    expect(container.textContent).toContain('new-dict');
    await click(button('編集'));
    expect(container.querySelector('output.preview-text')?.textContent).toContain('legacy-tag');
  });

  it('commits backup restore in one transaction before notifying peers so another tab never sees partial state', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'before-backup' });
    await writeFromOtherTab({
      workspace: initialWs,
      dictionary: [{ id: 'd1', tag: 'existing-tag', category: 'quality', alias: '', default_weight: 1, sort_order: 0, updated_at: '2026-01-01' }],
    }, false);
    await mountApp();
    await click(button('設定'));

    // 別タブのリスナーで通知を受けた瞬間の DB 状態を検査する
    const peer = new FakeBroadcastChannel('nai-tagdeck:sync');
    const observedAtNotice: Array<{ msg: unknown; snapshot: Awaited<ReturnType<typeof readAllAppData>> }> = [];
    peer.onmessage = (event) => {
      void readAllAppData().then((snapshot) => {
        observedAtNotice.push({ msg: event.data, snapshot });
      });
    };

    const backupWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'restored-ws-tag' });
    const backupJson = JSON.stringify({
      app: 'nai-tagdeck',
      kind: 'backup',
      version: 1,
      dictionary: [{ id: 'd2', tag: 'restored-dict-tag', category: 'quality', alias: '', default_weight: 1, sort_order: 0, updated_at: '2026-01-02' }],
      presets: [{ id: 'p1', name: '復元プリセット', workspace: backupWs, updated_at: '2026-01-02' }],
      workspace: backupWs,
      settings: { weightSyntax: 'brace', characterNegativePrompt: 'custom-neg' },
      generation: { mode: 'furry', size: 'square', steps: 20, scale: 6, sampler: 'k_euler_ancestral', noiseSchedule: 'karras', seed: null, cfgRescale: 0, dynamicThresholding: false },
    });
    const file = new File([backupJson], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => backupJson });
    const input = container.querySelector<HTMLInputElement>('.backup-actions input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(30);
    const confirm = container.querySelector<HTMLDialogElement>('dialog.app-dialog-confirm');
    await click(button('読み込む', confirm!));
    await flush(100);
    peer.close();

    // 通知は 1 回だけで、その時点で辞書・プリセット・workspace・settings・generation すべてが揃っている
    expect(observedAtNotice).toHaveLength(1);
    const { snapshot } = observedAtNotice[0]!;
    expect(snapshot.dictionary.map((e) => e.tag)).toEqual(['existing-tag', 'restored-dict-tag']);
    expect((snapshot.kv.presets as Array<{ name: string }>).map((p) => p.name)).toEqual(['復元プリセット']);
    expect((snapshot.kv.workspace as typeof backupWs).base.quality.map((t) => t.tag)).toEqual(['restored-ws-tag']);
    expect(snapshot.kv.settings).toMatchObject({ weightSyntax: 'brace', characterNegativePrompt: 'custom-neg' });
    expect(snapshot.kv.generation).toMatchObject({ mode: 'furry', size: 'square' });
  });

  it('ignores delayed notifications whose meta rev/epoch is already covered by the loaded snapshot', async () => {
    const initialWs = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'masterpiece' });
    await writeFromOtherTab({ workspace: initialWs }, false);
    const loadedSnapshot = await readAllAppData();

    await mountApp();

    // 読み込み済みスナップショットと同じまたは古い rev/epoch の遅延通知が届いてもロックしない
    const peer = new FakeBroadcastChannel('nai-tagdeck:sync');
    await act(async () => {
      peer.postMessage({
        type: 'updated',
        senderId: 'other-tab',
        seq: 1,
        at: Date.now(),
        meta: { rev: loadedSnapshot.meta.rev, epoch: loadedSnapshot.meta.epoch },
      });
    });
    expect(container.querySelector('.tab-sync')).toBeNull();

    // より新しい rev の通知は従来どおりロックする
    await act(async () => {
      peer.postMessage({
        type: 'updated',
        senderId: 'other-tab',
        seq: 2,
        at: Date.now(),
        meta: { rev: loadedSnapshot.meta.rev + 1, epoch: loadedSnapshot.meta.epoch },
      });
    });
    peer.close();
    expect(container.querySelector('.tab-sync')?.textContent).toContain('別のタブでデータが更新されました');
  });
});
