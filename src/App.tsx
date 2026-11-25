import { lazy, Suspense, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Editor } from './components/Editor';
import { GeneratePanel } from './components/GeneratePanel';
import { PromptPreview } from './components/PromptPreview';
import { Gallery } from './components/Gallery';
import { GenerateDock } from './components/GenerateDock';
import { QuickGenerate } from './components/QuickGenerate';
import { LatestPreview } from './components/LatestPreview';
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';
import { useDictionary } from './hooks/useDictionary';
import { useGenerationSettings, useSettings, useWorkspace } from './hooks/useWorkspace';
import { Toast, type ToastHandle } from './components/Toast';
import { useToken } from './hooks/useToken';
import { useTagUndo, type UndoExtrasSync } from './hooks/useTagUndo';
import { useImages } from './hooks/useImages';
import { useGenerator } from './hooks/useGenerator';
import { usePresets } from './hooks/usePresets';
import { useBackupTransfer } from './hooks/useBackupTransfer';
import { useGenerationControls } from './hooks/useGenerationControls';
import { useLatestImageNotice } from './hooks/useLatestImageNotice';
import { useFirstRun } from './hooks/useFirstRun';
import { usePromptImportApply } from './hooks/usePromptImportApply';
import { useDialogs } from './components/Dialogs';
import { isEmptyWorkspace } from './lib/presets';
import { isDefaultSettings } from './lib/settings';
import { isDefaultGeneration, resolveSize, type SizeKey } from './lib/generation';
import { buildCategoryPrompt, buildCharacterPrompts, buildPrompt } from './lib/prompt';
import { SwUpdateNotice } from './components/SwUpdateNotice';
import { TabSyncNotice } from './components/TabSyncNotice';
import { useTabSync } from './hooks/useTabSync';
import { BookIcon, BrandIcon, BrandWordmark, EditIcon, SettingsIcon, SparkleIcon } from './components/icons';
import { copyText } from './lib/browser';
import { applyTheme } from './lib/theme';
import type { WorkspaceAction } from './lib/workspace';
import type { ThemePreference, WeightSyntax } from './types';

// 初期表示に不要なサブ画面・モーダルは、タブやダイアログを開くときだけ読む。
const DictionaryView = lazy(() => import('./components/DictionaryView').then((m) => ({ default: m.DictionaryView })));
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));
const PromptImportDialog = lazy(() => import('./components/PromptImportDialog').then((m) => ({ default: m.PromptImportDialog })));

function ScreenLoadingFallback() {
  return (
    <section className="card" role="status" aria-busy="true">
      <p>画面を読み込んでいます…</p>
    </section>
  );
}

type Tab = 'editor' | 'generate' | 'dictionary' | 'settings';

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'editor', label: '編集', icon: <EditIcon /> },
  { key: 'generate', label: '生成', icon: <SparkleIcon /> },
  { key: 'dictionary', label: '辞書', icon: <BookIcon /> },
  { key: 'settings', label: '設定', icon: <SettingsIcon /> },
];

export default function App({ onResetAll }: { onResetAll: () => void }) {
  const dialogs = useDialogs();
  const token = useToken();
  const allLoadedRef = useRef(false);
  const discardHistoryRef = useRef<() => void>(() => {});
  const captureLocalRef = useRef<() => {
    dictionary: ReturnType<typeof useDictionary>['entries'];
    kv: {
      workspace: unknown;
      settings: unknown;
      generation: unknown;
      presets: unknown;
      activePreset: unknown;
    };
  }>(() => ({
    dictionary: [],
    kv: { workspace: undefined, settings: undefined, generation: undefined, presets: [], activePreset: null },
  }));
  const tabSync = useTabSync({
    confirmOverwrite: () =>
      dialogs.confirm('別のタブでの変更を上書きし、このタブの内容を保存しますか？', { okLabel: '上書きして保存' }),
    isReadyToSave: () => allLoadedRef.current,
    captureLocal: () => captureLocalRef.current(),
    onBeforeReloadApply: () => discardHistoryRef.current(),
    resyncToken: () => token.resync?.(),
  });
  const dictionary = useDictionary(tabSync.bridge);
  const { workspace, dispatch: rawDispatch, loaded, migrationHeld, persistence } = useWorkspace(tabSync.bridge);
  const [settings, updateSettings, settingsPersistence] = useSettings(loaded && !migrationHeld, tabSync.bridge);
  const [generation, updateGeneration, generationPersistence] = useGenerationSettings(tabSync.bridge);
  // 設定の読み込みが終わってからテーマを反映する。読み込み前に既定値で上書きすると、
  // theme-init.js が設定した data-theme がちらついて消えてしまう。
  // バックアップ復元・他タブ同期で settings.theme が変わったときもここで追従する。
  useEffect(() => {
    if (!settingsPersistence.loaded) return;
    return applyTheme(settings.theme);
  }, [settings.theme, settingsPersistence.loaded]);
  // 読み込み成功だけを見る。書き込み失敗の error では、今の値をプリセットへ保存できなくしない。
  const settingsReady = generationPersistence.loaded && settingsPersistence.loaded;
  const presets = usePresets(tabSync.bridge);
  const toastRef = useRef<ToastHandle>(null);
  const show = useCallback((message: string, durationMs?: number) => {
    toastRef.current?.show(message, durationMs);
  }, []);
  const onEvict = useCallback(
    (count: number) => show(`履歴上限のため、古い画像 ${count}枚を削除しました`, 6000),
    [show],
  );
  const imageStore = useImages({ onEvict });
  const generator = useGenerator(imageStore.add);
  const [tab, setTab] = useState<Tab>('editor');
  // 広い画面では、画像エリアをクリックしたらドックを閉じる（バーは初期表示と同じ形で残る）
  const [dockCollapse, setDockCollapse] = useState(0);
  const hideDockOnImageClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.dock')) return;
    if (window.matchMedia?.('(min-width: 1100px)').matches) setDockCollapse((n) => n + 1);
  };
  const settingsRef = useRef(settings);
  const generationRef = useRef(generation);
  const workspaceRef = useRef(workspace);
  const presetsRef = useRef(presets);
  const entriesRef = useRef(dictionary.entries);
  settingsRef.current = settings;
  generationRef.current = generation;
  workspaceRef.current = workspace;
  presetsRef.current = presets;
  entriesRef.current = dictionary.entries;
  const storesLoaded =
    dictionary.loaded &&
    [persistence, settingsPersistence, generationPersistence, ...presets.persistence].every((state) => state.loaded);
  allLoadedRef.current = storesLoaded;
  captureLocalRef.current = () => ({
    dictionary: entriesRef.current,
    kv: {
      workspace: workspaceRef.current,
      settings: settingsRef.current,
      generation: generationRef.current,
      presets: presetsRef.current.presets,
      activePreset: presetsRef.current.activeId,
    },
  });
  const extrasSync = useMemo<UndoExtrasSync>(() => ({
    capture: () => ({
      characterNegativePrompt: settingsRef.current.characterNegativePrompt,
      generation: { ...generationRef.current },
    }),
    restore: (extras) => {
      if (extras.characterNegativePrompt !== undefined) {
        updateSettings({ characterNegativePrompt: extras.characterNegativePrompt });
      }
      if (extras.generation) updateGeneration(extras.generation);
    },
  }), [updateGeneration, updateSettings]);
  const tagUndo = useTagUndo(workspace, rawDispatch, {
    activeId: presets.activeId,
    setActiveId: presets.setActiveId,
  }, extrasSync, tabSync.busy);
  discardHistoryRef.current = tagUndo.discardHistory;
  const dispatch = tagUndo.dispatch;
  // 辞書・プリセット・設定と同時に置き換える経路。履歴は描画を待たずに捨てる。
  // 描画前の Ctrl+Z が、読み込み前の作業状態だけを戻すのを防ぐ。
  const replaceWithoutHistory = useCallback((action: WorkspaceAction) => {
    tagUndo.discardHistory();
    rawDispatch(action);
  }, [rawDispatch, tagUndo.discardHistory]);
  const openEditor = useCallback(() => setTab('editor'), []);
  const firstRunReady = dictionary.loaded && !dictionary.error &&
    [persistence, settingsPersistence, generationPersistence, ...presets.persistence].every((state) => state.loaded && !state.error);
  const hasExistingData = useMemo(
    () =>
      !isEmptyWorkspace(workspace) ||
      dictionary.entries.length > 0 ||
      presets.presets.length > 0 ||
      !!token.token ||
      !isDefaultSettings(settings) ||
      !isDefaultGeneration(generation),
    [workspace, dictionary.entries.length, presets.presets.length, token.token, settings, generation],
  );
  const firstRun = useFirstRun({
    ready: firstRunReady,
    hasExistingData,
    dictionary, workspace, dispatch: replaceWithoutHistory, presets, notify: show, onOpenEditor: openEditor,
  });

  const basePrompt = useMemo(
    () => buildPrompt(workspace.base, settings.weightSyntax),
    [workspace.base, settings.weightSyntax],
  );
  const characterPrompts = useMemo(
    () => buildCharacterPrompts(workspace.characters, settings.weightSyntax),
    [workspace.characters, settings.weightSyntax],
  );
  const negativePrompt = useMemo(
    () => buildCategoryPrompt(workspace.negative, settings.weightSyntax),
    [workspace.negative, settings.weightSyntax],
  );

  const copy = useCallback(
    async (text: string, label: string) => {
      if (!text) {
        show('ONのタグがありません');
        return;
      }
      show((await copyText(text)) ? `${label}をコピーしました` : 'コピーできませんでした');
    },
    [show],
  );

  const applySeed = useCallback(
    (seed: number) => {
      updateGeneration({ seed });
      show(`シード ${seed} を次の生成に使います`);
    },
    [updateGeneration, show],
  );

  const { getBackup, importBackup } = useBackupTransfer({
    dictionary,
    presets,
    workspace,
    dispatch: replaceWithoutHistory,
    settings,
    updateSettings,
    generation,
    updateGeneration,
    commitAll: tabSync.commitAll,
  });
  const openSettings = useCallback(() => setTab('settings'), []);
  const { blocker, startGenerate } = useGenerationControls({
    generator,
    token: token.token,
    basePrompt,
    characterPrompts,
    negativePrompt,
    settings,
    generation,
    show,
    onOpenSettings: openSettings,
    shortcutsDisabled: tabSync.busy,
  });
  const latest = imageStore.images[0];
  const { unseenId, dismiss } = useLatestImageNotice(latest?.id, tab === 'generate');
  const showLatest = tab === 'editor' && !!latest && unseenId === latest.id;
  const promptImport = usePromptImportApply({
    ready: firstRunReady,
    settingsReady,
    workspace,
    presets,
    settings,
    generation,
    dictionaryEntries: dictionary.entries,
    dispatch,
    openEditor,
    notify: show,
  });
  const handleCharacterNegativeChange = useCallback(
    (characterNegativePrompt: string) => updateSettings({ characterNegativePrompt }),
    [updateSettings],
  );
  const handleThemeChange = useCallback(
    (theme: ThemePreference) => updateSettings({ theme }),
    [updateSettings],
  );
  const handleSyntaxChange = useCallback(
    (weightSyntax: WeightSyntax) => updateSettings({ weightSyntax }),
    [updateSettings],
  );
  const handleSizeChange = useCallback(
    (size: SizeKey) => updateGeneration({ size }),
    [updateGeneration],
  );
  const handleClearSeed = useCallback(() => {
    updateGeneration({ seed: null });
    show('シードをランダムに戻しました');
  }, [updateGeneration, show]);

  const headerRef = useRef<HTMLElement>(null);
  // 固定ヘッダーの高さに合わせて .app の上余白を揃える（Android Firefox での sticky ちらつき回避のため fixed 化）
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => {
      const height = el.getBoundingClientRect().height;
      if (height > 0) document.documentElement.style.setProperty('--header-height', `${height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el, { box: 'border-box' });
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--header-height');
    };
  }, []);

  const showWorkbench = tab === 'editor' || tab === 'generate';

  return (
    <div className="app">
      <header ref={headerRef} className="app-header" data-occludes inert={tabSync.busy || undefined}>
        <h1 className="app-title" aria-label="nai-tagdeck">
          <BrandIcon className="brand-icon" width={24} height={24} />
          <BrandWordmark className="brand-wordmark" width={108} height={24} />
        </h1>
        <nav className="tabbar" aria-label="画面切り替え" data-occludes>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tab tab-${t.key}`}
              title={t.label}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.icon}
              <span className="tab-label">{t.label}</span>
              {t.key === 'generate' &&
                (generator.generating ? (
                  <>
                    <span className="spinner spinner-small" aria-hidden="true" />
                    <span className="visually-hidden">（生成中）</span>
                  </>
                ) : (
                  imageStore.images.length > 0 && (
                    <span className="tab-count">
                      {imageStore.images.length}
                      <span className="visually-hidden">枚</span>
                    </span>
                  )
                ))}
              {t.key === 'dictionary' && (
                <span className="tab-count">
                  {dictionary.entries.length}
                  <span className="visually-hidden">件</span>
                </span>
              )}
            </button>
          ))}
        </nav>
        <QuickGenerate
          size={generation.size}
          customSize={generation.size === 'custom' ? resolveSize(generation) : undefined}
          seed={generation.seed}
          onSizeChange={handleSizeChange}
          onClearSeed={handleClearSeed}
          generating={generator.generating}
          blocker={blocker}
          onGenerate={startGenerate}
        />
      </header>
      <SwUpdateNotice />
      <TabSyncNotice
        conflict={tabSync.conflict}
        dbBlocked={tabSync.dbBlocked}
        busy={tabSync.busy}
        error={tabSync.error}
        onReload={tabSync.reloadLatest}
        onPrefer={tabSync.preferLocal}
      />

      {tabSync.loadError && (
        <p className="error-banner" role="alert">
          {tabSync.loadError}。再読み込みして再試行してください。
        </p>
      )}

      {tabSync.migrationError && (
        <div className="error-banner" role="alert">
          <span>{tabSync.migrationError}</span>{' '}
          <button
            type="button"
            className="btn btn-small"
            onClick={tabSync.retryMigration}
            disabled={tabSync.busy || tabSync.bridge.locked}
          >
            移行を再試行
          </button>
        </div>
      )}

      {dictionary.error && (
        <p className="error-banner" role="alert">
          {dictionary.error}
        </p>
      )}

      {[
        ...(tabSync.migrationError ? [] : [persistence]),
        settingsPersistence,
        generationPersistence,
        ...presets.persistence,
      ].filter((state) => state.error).map((state) => (
        <p className="error-banner" role="alert" key={state.error}>{state.error}。再読み込みして再試行してください。</p>
      ))}
      <main className="app-main" inert={tabSync.busy || undefined}>
        {/* 編集と生成は、広い画面では左右に並べ、狭い画面ではタブで切り替える（どちらも表示したまま CSS で隠す） */}
        <div className="workbench" data-tab={tab} hidden={!showWorkbench}>
          <div className="pane pane-editor">
            <Editor
              workspace={workspace}
              dispatch={dispatch}
              history={tagUndo}
              loaded={loaded}
              dictionary={dictionary}
              syntax={settings.weightSyntax}
              onCopy={copy}
              notify={show}
              presets={presets}
              onPickPng={promptImport.pickPng}
              onReadPng={promptImport.openPromptImport}
              characterNegative={settings.characterNegativePrompt}
              onCharacterNegativeChange={handleCharacterNegativeChange}
              generation={generation}
              settingsReady={settingsReady}
              workspaceReady={loaded}
              canvasSize={resolveSize(generation)}
              shown={tab === 'editor'}
            />
          </div>
          <div className="pane pane-generate" onClick={hideDockOnImageClick}>
            <Gallery
              images={imageStore.images}
              generating={generator.generating}
              pendingSize={resolveSize(generation)}
              evictedCount={imageStore.evictedCount}
              onDismissEviction={imageStore.dismissEviction}
              onRemove={imageStore.remove}
              onClear={imageStore.clear}
              onUseSeed={applySeed}
              onDownloaded={imageStore.markDownloaded}
              onTogglePin={imageStore.togglePinned}
              onPickPng={promptImport.pickPng}
              onReadPng={promptImport.openPromptImport}
            />
            {/* プロンプトと生成設定は下部のドックにまとめ、画像を広く見せる */}
            <GenerateDock
              collapseSignal={dockCollapse}
              generating={generator.generating}
              error={generator.error}
              onDismissError={generator.dismissError}
              promptPanel={
                <PromptPreview
                  basePrompt={basePrompt}
                  characterPrompts={characterPrompts}
                  syntax={settings.weightSyntax}
                  onSyntaxChange={handleSyntaxChange}
                  onCopy={copy}
                  negativePrompt={negativePrompt}
                  mode={generation.mode}
                  characterNegative={settings.characterNegativePrompt}
                />
              }
              generatePanel={
                <GeneratePanel
                  generation={generation}
                  onGenerationChange={updateGeneration}
                  generator={generator}
                  token={token}
                  onOpenSettings={openSettings}
                  blocker={blocker}
                  onGenerate={startGenerate}
                />
              }
            />
          </div>
        </div>
        {tab === 'dictionary' && (
          <ChunkErrorBoundary>
            <Suspense fallback={<ScreenLoadingFallback />}>
              <DictionaryView
                dictionary={dictionary}
                notify={show}
                locked={tabSync.bridge.locked}
                reloadCount={tabSync.reloadCount}
              />
            </Suspense>
          </ChunkErrorBoundary>
        )}
        {tab === 'settings' && (
          <ChunkErrorBoundary>
            <Suspense fallback={<ScreenLoadingFallback />}>
              <SettingsView
                token={token}
                notify={show}
                theme={settings.theme}
                onThemeChange={handleThemeChange}
                getBackup={getBackup}
                onImportBackup={importBackup}
                onResetAll={onResetAll}
                onShowFirstRun={firstRun.showGuide}
                firstRunDisabled={!firstRunReady || firstRun.busy}
                backupImportDisabled={!storesLoaded || tabSync.bridge.locked}
                reloadCount={tabSync.reloadCount}
              />
            </Suspense>
          </ChunkErrorBoundary>
        )}
      </main>

      <input
        ref={promptImport.pngInputRef}
        type="file"
        accept="image/png,.png"
        hidden
        onChange={promptImport.onPngFileChange}
      />
      {promptImport.promptSource && firstRunReady && (
        <ChunkErrorBoundary>
          <Suspense fallback={null}>
            <PromptImportDialog
              source={promptImport.promptSource}
              entries={dictionary.entries}
              onCancel={promptImport.closePromptImport}
              onApply={promptImport.applyPrompt}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      {showLatest && latest && (
        <LatestPreview image={latest} onOpen={() => setTab('generate')} onDismiss={dismiss} />
      )}

      <Toast ref={toastRef} />
    </div>
  );
}

