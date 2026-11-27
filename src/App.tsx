import { lazy, Suspense, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnlasBalance } from './components/AnlasBalance';
import { AppErrorBanners } from './components/AppErrorBanners';
import { Editor } from './components/Editor';
import { GeneratePanel } from './components/GeneratePanel';
import { PromptPreview } from './components/PromptPreview';
import { Gallery } from './components/Gallery';
import { GenerateDock, type DockTabSignal } from './components/GenerateDock';
import { GenerateBar } from './components/GenerateBar';
import { ReferencePanel } from './components/ReferencePanel';
import { SeedLock } from './components/SeedLock';
import { LatestPreview } from './components/LatestPreview';
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';
import { useDictionary } from './hooks/useDictionary';
import { useHeaderHeight } from './hooks/useHeaderHeight';
import { useWorkbenchSplit, MAX_GENERATE_RATIO, MIN_GENERATE_RATIO } from './hooks/useWorkbenchSplit';
import { useWindowScrollMemory } from './hooks/useWindowScrollMemory';
import { useGenerationSettings, useSettings, useWorkspace } from './hooks/useWorkspace';
import { Toast, type ToastHandle } from './components/Toast';
import { useToken } from './hooks/useToken';
import { useAnlas } from './hooks/useAnlas';
import { useTagUndo, type UndoExtrasSync } from './hooks/useTagUndo';
import { useImages, type GeneratedImage } from './hooks/useImages';
import { useGenerator } from './hooks/useGenerator';
import { useInpaintSession } from './hooks/useInpaintSession';
import { useReferenceImage } from './hooks/useReferenceImage';
import { usePresets } from './hooks/usePresets';
import { useBackupTransfer } from './hooks/useBackupTransfer';
import { useGenerationControls } from './hooks/useGenerationControls';
import { useLatestImageNotice } from './hooks/useLatestImageNotice';
import { useFirstRun } from './hooks/useFirstRun';
import { usePromptImportApply } from './hooks/usePromptImportApply';
import { useDialogs } from './components/Dialogs';
import { isEmptyWorkspace } from './lib/presets';
import { isDefaultSettings } from './lib/settings';
import { isDefaultGeneration, resolveSize } from './lib/generation';
import { buildCategoryPrompt, buildCharacterPrompts, buildPrompt } from './lib/prompt';
import { SwUpdateNotice } from './components/SwUpdateNotice';
import { TabSyncNotice } from './components/TabSyncNotice';
import { useTabSync } from './hooks/useTabSync';
import { BrandIcon, BrandWordmark, EditIcon, SettingsIcon, SparkleIcon } from './components/icons';
import { copyText } from './lib/browser';
import { applyTheme } from './lib/theme';
import type { WorkspaceAction } from './lib/workspace';
import type { ThemePreference, WeightSyntax } from './types';

// 初期表示に不要なサブ画面・モーダルは、タブやダイアログを開くときだけ読む。
const DictionaryView = lazy(() => import('./components/DictionaryView').then((m) => ({ default: m.DictionaryView })));
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));
const PromptImportDialog = lazy(() => import('./components/PromptImportDialog').then((m) => ({ default: m.PromptImportDialog })));
const InpaintDialog = lazy(() => import('./components/InpaintDialog').then((m) => ({ default: m.InpaintDialog })));

function ScreenLoadingFallback() {
  return (
    <section className="card" role="status" aria-busy="true">
      <p>画面を読み込んでいます…</p>
    </section>
  );
}

type Tab = 'editor' | 'generate' | 'dictionary' | 'settings';

const PRIMARY_TABS: Array<{ key: 'editor' | 'generate'; label: string; icon: ReactNode }> = [
  { key: 'editor', label: '編集', icon: <EditIcon /> },
  { key: 'generate', label: '画像', icon: <SparkleIcon /> },
];

export default function App({ onResetAll }: { onResetAll: () => void }) {
  const dialogs = useDialogs();
  const token = useToken();
  // Anlas 残高は表示用のメモリキャッシュ。トークン保存時と生成完了時に取得し直す。
  const anlas = useAnlas(token.token);
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
  const referenceImage = useReferenceImage();
  const inpaint = useInpaintSession();
  const generator = useGenerator(imageStore.add, () => anlas.refresh());
  const [tab, setTab] = useState<Tab>('editor');
  const lastWorkbenchTabRef = useRef<'editor' | 'generate'>('editor');
  const selectTab = useCallback((next: Tab) => {
    if (next === 'editor' || next === 'generate') {
      lastWorkbenchTabRef.current = next;
    }
    setTab(next);
  }, []);
  useWindowScrollMemory(tab);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const split = useWorkbenchSplit(workbenchRef);
  // 広い画面では、画像エリアをクリックしたらドックを閉じる（バーは初期表示と同じ形で残る）
  const [dockCollapse, setDockCollapse] = useState(0);
  const [dockOpenTab, setDockOpenTab] = useState<DockTabSignal>({ tab: 'prompt', seq: 0 });
  const hideDockOnImageClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.dock, .generate-bar, .viewer, .inpaint-dialog, .thumb-menu-wrap')) return;
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
  const openEditor = useCallback(() => selectTab('editor'), [selectTab]);
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
  const toggleSettings = useCallback(() => {
    setTab((current) => (current === 'settings' ? lastWorkbenchTabRef.current : 'settings'));
  }, []);
  const openDictionary = useCallback(() => setTab('dictionary'), []);
  const openReferenceTab = useCallback(() => {
    setTab((current) => (current === 'editor' || current === 'generate' ? current : 'generate'));
    setDockOpenTab((prev) => ({ tab: 'reference', seq: prev.seq + 1 }));
  }, []);
  const handleUseAsReference = useCallback(
    async (image: GeneratedImage) => {
      const ok = await referenceImage.addFromBlob(image.blob, `生成画像（シード ${image.seed}）`);
      openReferenceTab();
      show(ok ? '参照画像に追加しました' : '参照画像を追加できませんでした');
    },
    [referenceImage.addFromBlob, openReferenceTab, show],
  );
  const ensurePreciseReferenceOffForInpaint = useCallback(
    async (okLabel = '一時 OFF にして開く'): Promise<boolean> => {
      if (referenceImage.activeItems.length === 0) return true;
      const ok = await dialogs.confirm(
        'インペイントでは精密参照を使えません。精密参照を一時 OFF にして切り替えますか？',
        { okLabel },
      );
      if (!ok) return false;
      referenceImage.disableAll();
      show('精密参照を一時 OFF にしました');
      return true;
    },
    [referenceImage.activeItems.length, referenceImage.disableAll, dialogs, show],
  );

  // 精密参照を後から追加・ON にした場合はインペイントを自動で一時 OFF にする（相互排他）
  const activeReferenceCount = referenceImage.activeItems.length;
  const prevActiveReferenceCountRef = useRef(activeReferenceCount);
  useEffect(() => {
    const prev = prevActiveReferenceCountRef.current;
    prevActiveReferenceCountRef.current = activeReferenceCount;
    if (activeReferenceCount > prev && inpaint.activeSession) {
      inpaint.setEnabled(false);
      show('精密参照を有効にしたため、インペイントを一時 OFF にしました');
    }
  }, [activeReferenceCount, inpaint.activeSession, inpaint.setEnabled, show]);

  const collapseDock = useCallback(() => {
    setDockCollapse((n) => n + 1);
  }, []);

  const handleStartInpaintFromImage = useCallback(
    async (image: GeneratedImage) => {
      if (!(await ensurePreciseReferenceOffForInpaint())) return;
      const ok = await inpaint.startFromBlob(image.blob, `生成画像（シード ${image.seed}）`, {
        width: image.width,
        height: image.height,
      });
      if (ok) collapseDock();
      else show('インペイント用の画像を読み込めませんでした');
    },
    [ensurePreciseReferenceOffForInpaint, inpaint.startFromBlob, collapseDock, show],
  );

  const handleStartInpaintFromFile = useCallback(
    async (file: File) => {
      if (!(await ensurePreciseReferenceOffForInpaint())) return;
      const ok = await inpaint.startFromFile(file);
      if (ok) collapseDock();
      else show('インペイント用の画像を読み込めませんでした');
    },
    [ensurePreciseReferenceOffForInpaint, inpaint.startFromFile, collapseDock, show],
  );

  const handleResumeInpaint = useCallback(async () => {
    if (!(await ensurePreciseReferenceOffForInpaint())) return;
    collapseDock();
    inpaint.resume();
  }, [ensurePreciseReferenceOffForInpaint, collapseDock, inpaint.resume]);

  const handleConfirmInpaint = useCallback(() => {
    if (referenceImage.activeItems.length > 0) {
      referenceImage.disableAll();
    }
    if (inpaint.confirm()) {
      collapseDock();
      show('インペイントを確定しました。「生成する」ボタンから実行できます');
    }
  }, [referenceImage.activeItems.length, referenceImage.disableAll, inpaint.confirm, collapseDock, show]);

  const handleToggleInpaintEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        if (!(await ensurePreciseReferenceOffForInpaint('一時 OFF にして有効化'))) return;
      }
      inpaint.setEnabled(enabled);
    },
    [ensurePreciseReferenceOffForInpaint, inpaint.setEnabled],
  );

  const handleDiscardInpaint = useCallback(async () => {
    const ok = await dialogs.confirm(
      'インペイントの一時保持データ（ベース画像とマスク）を完全に破棄しますか？',
      { okLabel: '破棄', danger: true },
    );
    if (!ok) return;
    inpaint.discard();
    show('インペイントの一時保持データを破棄しました');
  }, [dialogs, inpaint.discard, show]);

  const { blocker, startGenerate } = useGenerationControls({
    generator,
    token: token.token,
    basePrompt,
    characterPrompts,
    negativePrompt,
    settings,
    generation,
    activeReferences: inpaint.activeSession ? [] : referenceImage.activeItems,
    activeInpaint: inpaint.activeSession,
    show,
    onOpenSettings: openSettings,
    shortcutsDisabled: tabSync.busy || inpaint.open,
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
  const handleClearSeed = useCallback(() => {
    updateGeneration({ seed: null });
    show('シードをランダムに戻しました');
  }, [updateGeneration, show]);

  const headerRef = useRef<HTMLElement>(null);
  useHeaderHeight(headerRef);

  const showWorkbench = tab === 'editor' || tab === 'generate';

  return (
    <div className="app">
      <header ref={headerRef} className="app-header" data-occludes inert={tabSync.busy || undefined}>
        <h1 className="app-title" aria-label="nai-tagdeck">
          <BrandIcon className="brand-icon" width={24} height={24} />
          <BrandWordmark className="brand-wordmark" width={108} height={24} />
        </h1>
        <nav className="tabbar" aria-label="画面切り替え" data-occludes>
          {PRIMARY_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tab tab-${t.key}`}
              title={t.label}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => selectTab(t.key)}
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
            </button>
          ))}
        </nav>
        <div className="header-actions" data-occludes>
          <SeedLock seed={generation.seed} onClearSeed={handleClearSeed} />
          <AnlasBalance anlas={anlas} />
          <button
            type="button"
            className="tab tab-settings"
            aria-label="設定"
            title={tab === 'settings' ? '元の画面へ戻る' : '設定'}
            aria-current={tab === 'settings' || tab === 'dictionary' ? 'page' : undefined}
            onClick={toggleSettings}
          >
            <SettingsIcon />
          </button>
        </div>
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

      <AppErrorBanners
        loadError={tabSync.loadError}
        migrationError={tabSync.migrationError}
        retryDisabled={tabSync.busy || tabSync.bridge.locked}
        onRetryMigration={tabSync.retryMigration}
        dictionaryError={dictionary.error}
        persistenceErrors={[
          ...(tabSync.migrationError ? [] : [{ id: 'workspace', error: persistence.error }]),
          { id: 'settings', error: settingsPersistence.error },
          { id: 'generation', error: generationPersistence.error },
          ...presets.persistence.map((state, index) => ({ id: `preset-${index}`, error: state.error })),
        ]}
      />
      <main className="app-main" inert={tabSync.busy || undefined}>
        {/* 編集と生成は、広い画面では左右に並べ、狭い画面ではタブで切り替える（どちらも表示したまま CSS で隠す） */}
        <div
          ref={workbenchRef}
          className={`workbench${split.dragging ? ' is-resizing' : ''}`}
          data-tab={tab}
          hidden={!showWorkbench}
          style={split.style}
        >
          <div className="pane pane-editor">
            <Editor
              workspace={workspace}
              dispatch={dispatch}
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
          <div
            className="workbench-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="編集エリアと画像エリアの幅を調整"
            aria-valuemin={Math.round(MIN_GENERATE_RATIO * 100)}
            aria-valuemax={Math.round(MAX_GENERATE_RATIO * 100)}
            aria-valuenow={split.ratioPercent}
            tabIndex={0}
            title="ドラッグして幅を変更（ダブルクリックで初期幅に戻す）"
            onPointerDown={split.onPointerDown}
            onPointerMove={split.onPointerMove}
            onPointerUp={split.onPointerUp}
            onPointerCancel={split.onPointerCancel}
            onDoubleClick={split.reset}
            onKeyDown={split.onKeyDown}
          />
          <div className="pane pane-generate" onClick={hideDockOnImageClick}>
            <Gallery
              images={imageStore.images}
              generating={generator.generating}
              pendingSize={inpaint.activeSession ? { width: inpaint.activeSession.width, height: inpaint.activeSession.height } : resolveSize(generation)}
              evictedCount={imageStore.evictedCount}
              onDismissEviction={imageStore.dismissEviction}
              onRemove={imageStore.remove}
              onClear={imageStore.clear}
              onUseSeed={applySeed}
              onDownloaded={imageStore.markDownloaded}
              onTogglePin={imageStore.togglePinned}
              onPickPng={promptImport.pickPng}
              onReadPng={promptImport.openPromptImport}
              onUseAsReference={handleUseAsReference}
              onInpaint={(img) => { void handleStartInpaintFromImage(img); }}
            />
            {/* プロンプト・生成設定・参照画像は下部のドックにまとめ、画像を広く見せる */}
            <GenerateDock
              collapseSignal={dockCollapse}
              openTabSignal={dockOpenTab}
              referenceActive={referenceImage.activeItems.length > 0}
              referenceCount={referenceImage.activeItems.length}
              history={tagUndo}
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
                  token={token}
                  onOpenSettings={openSettings}
                />
              }
              referencePanel={
                <ReferencePanel
                  reference={referenceImage}
                  inpaint={inpaint}
                  onStartInpaintFile={(file) => { void handleStartInpaintFromFile(file); }}
                  onResumeInpaint={() => { void handleResumeInpaint(); }}
                  onToggleInpaintEnabled={(enabled) => { void handleToggleInpaintEnabled(enabled); }}
                  onDiscardInpaint={() => { void handleDiscardInpaint(); }}
                />
              }
            />
            {/* 生成ボタンとサイズは、編集タブでも常に下部に置くバーへ移した */}
            <GenerateBar
              generation={generation}
              onGenerationChange={updateGeneration}
              generator={generator}
              token={token}
              blocker={blocker}
              onGenerate={startGenerate}
              anlas={anlas}
              referenceCount={referenceImage.activeItems.length}
              activeReferences={referenceImage.activeItems}
              onDisableReference={referenceImage.disableAll}
              onOpenReferenceTab={openReferenceTab}
              inpaintSession={inpaint.activeSession}
              onResumeInpaint={() => { void handleResumeInpaint(); }}
              onDisableInpaint={() => inpaint.setEnabled(false)}
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
                onBackToSettings={openSettings}
              />
            </Suspense>
          </ChunkErrorBoundary>
        )}
        {tab === 'settings' && (
          <ChunkErrorBoundary>
            <Suspense fallback={<ScreenLoadingFallback />}>
              <SettingsView
                token={token}
                anlas={anlas}
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
                onOpenDictionary={openDictionary}
                dictionaryCount={dictionary.entries.length}
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
      {inpaint.open && inpaint.session && (
        <ChunkErrorBoundary>
          <Suspense fallback={null}>
            <InpaintDialog
              session={inpaint.session}
              onConfirm={handleConfirmInpaint}
              onClose={inpaint.close}
              onDiscard={() => {
                inpaint.discard();
                show('インペイントの一時保持データを破棄しました');
              }}
              onPushStroke={inpaint.pushStroke}
              onUndoMask={inpaint.undoMask}
              onRedoMask={inpaint.redoMask}
              onClearMask={inpaint.clearMask}
              onStrengthChange={inpaint.setStrength}
              onAddOriginalImageChange={inpaint.setAddOriginalImage}
              onBrushRadiusChange={inpaint.setBrushRadius}
              onMaskColorChange={inpaint.setMaskColor}
              onMaskOpacityChange={inpaint.setMaskOpacity}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      {showLatest && latest && (
        <LatestPreview image={latest} onOpen={() => selectTab('generate')} onDismiss={dismiss} />
      )}

      <Toast ref={toastRef} />
    </div>
  );
}

