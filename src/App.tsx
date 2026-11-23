import { type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Editor } from './components/Editor';
import { DictionaryView } from './components/DictionaryView';
import { SettingsView } from './components/SettingsView';
import { GeneratePanel } from './components/GeneratePanel';
import { PromptPreview } from './components/PromptPreview';
import { Gallery } from './components/Gallery';
import { GenerateDock } from './components/GenerateDock';
import { QuickGenerate } from './components/QuickGenerate';
import { LatestPreview } from './components/LatestPreview';
import { PromptImportDialog, type PromptSource } from './components/PromptImportDialog';
import { useDictionary } from './hooks/useDictionary';
import { useGenerationSettings, useSettings, useWorkspace } from './hooks/useWorkspace';
import { Toast, type ToastHandle } from './components/Toast';
import { useToken } from './hooks/useToken';
import { useTagUndo, type UndoExtras, type UndoExtrasSync } from './hooks/useTagUndo';
import { useImages } from './hooks/useImages';
import { useGenerator } from './hooks/useGenerator';
import { usePresets } from './hooks/usePresets';
import { useBackupTransfer } from './hooks/useBackupTransfer';
import { useGenerationControls } from './hooks/useGenerationControls';
import { useLatestImageNotice } from './hooks/useLatestImageNotice';
import { useFirstRun } from './hooks/useFirstRun';
import { confirmUnsavedChanges, type UnsavedChoice } from './components/confirmUnsaved';
import { useDialogs } from './components/Dialogs';
import { isEmptyWorkspace, overwritePreset, sameWorkspace, sameWorkTags } from './lib/presets';
import { isDefaultSettings } from './lib/settings';
import { isDefaultGeneration, normalizeGeneration, sizeOf, type GenerationSettings, type SizeKey } from './lib/generation';
import { buildCategoryPrompt, buildCharacterPrompts, buildPrompt } from './lib/prompt';
import { SwUpdateNotice } from './components/SwUpdateNotice';
import { BookIcon, EditIcon, SettingsIcon, SparkleIcon } from './components/icons';
import { copyText } from './lib/browser';
import { importedBaseForMode, type PromptImport } from './lib/promptImport';
import { defaultNegativeTags } from './lib/workspace';
import type { WeightSyntax } from './types';

type Tab = 'editor' | 'generate' | 'dictionary' | 'settings';

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'editor', label: '編集', icon: <EditIcon /> },
  { key: 'generate', label: '生成', icon: <SparkleIcon /> },
  { key: 'dictionary', label: '辞書', icon: <BookIcon /> },
  { key: 'settings', label: '設定', icon: <SettingsIcon /> },
];

export default function App({ onResetAll }: { onResetAll: () => void }) {
  const dictionary = useDictionary();
  const { workspace, dispatch: rawDispatch, loaded, persistence } = useWorkspace();
  const [settings, updateSettings, settingsPersistence] = useSettings(loaded);
  const [generation, updateGeneration, generationPersistence] = useGenerationSettings();
  const token = useToken();
  const presets = usePresets();
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
  const [promptSource, setPromptSource] = useState<PromptSource | null>(null);
  const confirmAbortRef = useRef<AbortController | null>(null);
  const pngInput = useRef<HTMLInputElement>(null);
  // 広い画面では、画像エリアをクリックしたらドックを閉じる（バーは初期表示と同じ形で残る）
  const [dockCollapse, setDockCollapse] = useState(0);
  const hideDockOnImageClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.dock')) return;
    if (window.matchMedia?.('(min-width: 1100px)').matches) setDockCollapse((n) => n + 1);
  };
  const dialogs = useDialogs();
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
  }, extrasSync);
  const dispatch = tagUndo.dispatch;
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
    dictionary, workspace, dispatch, presets, notify: show, onOpenEditor: openEditor,
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
    dictionary, presets, workspace, dispatch, settings, updateSettings, generation, updateGeneration,
  });
  const openSettings = useCallback(() => setTab('settings'), []);
  const { blocker, startGenerate } = useGenerationControls({
    generator, token: token.token, basePrompt, characterPrompts, negativePrompt, settings, generation, show, onOpenSettings: openSettings,
  });
  const latest = imageStore.images[0];
  const { unseenId, dismiss } = useLatestImageNotice(latest?.id, tab === 'generate');
  const showLatest = tab === 'editor' && !!latest && unseenId === latest.id;
  const pickPng = useMemo(
    () => (firstRunReady ? () => pngInput.current?.click() : undefined),
    [firstRunReady],
  );
  const openPromptImport = useCallback(
    (source: PromptSource) => {
      if (firstRunReady) setPromptSource(source);
    },
    [firstRunReady],
  );
  const handleCharacterNegativeChange = useCallback(
    (characterNegativePrompt: string) => updateSettings({ characterNegativePrompt }),
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
  useEffect(() => {
    if (!firstRunReady && promptSource !== null) setPromptSource(null);
    return () => { confirmAbortRef.current?.abort(); };
  }, [firstRunReady, promptSource]);
  const applyPrompt = async (result: PromptImport, applyGeneration: boolean) => {
    const currentWorkspace = workspaceRef.current;
    const store = presetsRef.current;
    const currentSettings = settingsRef.current;
    const currentGeneration = generationRef.current;
    const currentEntries = entriesRef.current;
    const active = store.presets.find((preset) => preset.id === store.activeId) ?? null;
    const nextGeneration = applyGeneration ? normalizeGeneration({ ...currentGeneration, ...result.generation.values }) : null;
    const generationPatch: Partial<GenerationSettings> = {};
    if (nextGeneration) {
      for (const key of Object.keys(result.generation.values) as (keyof GenerationSettings)[]) {
        const value = nextGeneration[key];
        if (value !== undefined && !Object.is(value, currentGeneration[key])) generationPatch[key] = value as never;
      }
    }
    const generationChanges = Object.keys(generationPatch).length > 0;
    const negativeChanges = result.negative !== undefined && !sameWorkTags(result.negative, currentWorkspace.negative);
    // 古いプリセットはネガティブを持たず、空の作業状態もネガティブを見ない。PNG が編集済みの全体ネガティブを置き換えるときだけ、ここで確認する。
    const negativeUnsaved = negativeChanges
      && !sameWorkTags(currentWorkspace.negative, defaultNegativeTags())
      && (active === null || active.workspace.negative === undefined);
    const dirty = (active ? !sameWorkspace(active.workspace, currentWorkspace) : !isEmptyWorkspace(currentWorkspace)) || negativeUnsaved;
    const nextCharacterNegative = result.characterNegative !== undefined && result.characterNegative !== currentSettings.characterNegativePrompt
      ? result.characterNegative
      : null;
    let choice: UnsavedChoice | null = 'proceed';
    if (dirty) {
      const also = [
        negativeChanges ? '全体ネガティブ' : '',
        nextCharacterNegative !== null ? '共通のキャラ用ネガティブ' : '',
        generationChanges ? '生成設定' : '',
      ].filter(Boolean);
      const action = also.length > 0
        ? `画像のプロンプトを適用しますか？作業中のベースとキャラクターを置き換え、${also.join('と')}も更新します。`
        : '画像のプロンプトを適用しますか？作業中のベースとキャラクターを置き換えます。';
      confirmAbortRef.current?.abort();
      const controller = new AbortController();
      confirmAbortRef.current = controller;
      try {
        choice = await confirmUnsavedChanges(dialogs, {
          dirty,
          activeName: active?.name ?? null,
          action,
          okLabel: '適用',
          signal: controller.signal,
        });
      } finally {
        if (confirmAbortRef.current === controller) confirmAbortRef.current = null;
      }
      if (!choice || controller.signal.aborted) return false;
      // 確認を開いている間にバックアップや辞書更新などで状態が変わっていたら、古い前提のまま適用せずプレビューへ戻す。
      if (
        currentWorkspace !== workspaceRef.current
        || store.presets !== presetsRef.current.presets
        || store.activeId !== presetsRef.current.activeId
        || currentSettings !== settingsRef.current
        || currentGeneration !== generationRef.current
        || currentEntries !== entriesRef.current
      ) {
        show('確認中に内容が更新されたため、適用を中止しました。もう一度適用してください');
        return false;
      }
    }
    if (choice === 'save' && active) {
      store.setPresets(overwritePreset(store.presets, active.id, currentWorkspace));
    }
    const nextMode = nextGeneration?.mode ?? currentGeneration.mode;
    const extras: UndoExtras = {};
    if (nextCharacterNegative !== null) extras.characterNegativePrompt = nextCharacterNegative;
    if (generationChanges) extras.generation = generationPatch;
    dispatch({
      type: 'replace',
      workspace: {
        base: importedBaseForMode(result, nextMode),
        characters: result.characters,
        negative: result.negative ?? currentWorkspace.negative,
      },
    }, extras);
    store.setActiveId(null);
    openEditor();
    show(choice === 'save' && active
      ? `プリセット「${active.name}」に変更を上書きし、画像のプロンプトを読み込みました`
      : '画像のプロンプトを読み込みました');
    return true;
  };

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
      <header ref={headerRef} className="app-header" data-occludes>
        <h1 className="app-title" aria-label="nai-tagdeck">
          <img className="brand-icon" src={`${import.meta.env.BASE_URL}brand/icon.svg`} width="24" height="24" alt="" />
          <img className="brand-wordmark" src={`${import.meta.env.BASE_URL}brand/wordmark.svg`} width="108" height="24" alt="" />
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
          seed={generation.seed}
          onSizeChange={handleSizeChange}
          onClearSeed={handleClearSeed}
          generating={generator.generating}
          blocker={blocker}
          onGenerate={startGenerate}
        />
      </header>
      <SwUpdateNotice />

      {dictionary.error && (
        <p className="error-banner" role="alert">
          {dictionary.error}
        </p>
      )}

      {[persistence, settingsPersistence, generationPersistence, ...presets.persistence].filter((state) => state.error).map((state) => (
        <p className="error-banner" role="alert" key={state.error}>{state.error}。再読み込みして再試行してください。</p>
      ))}
      <main className="app-main">
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
              onPickPng={pickPng}
              onReadPng={openPromptImport}
              characterNegative={settings.characterNegativePrompt}
              onCharacterNegativeChange={handleCharacterNegativeChange}
              canvasSize={sizeOf(generation.size)}
              shown={tab === 'editor'}
            />
          </div>
          <div className="pane pane-generate" onClick={hideDockOnImageClick}>
            <Gallery
              images={imageStore.images}
              generating={generator.generating}
              pendingSize={sizeOf(generation.size)}
              evictedCount={imageStore.evictedCount}
              onDismissEviction={imageStore.dismissEviction}
              onRemove={imageStore.remove}
              onClear={imageStore.clear}
              onUseSeed={applySeed}
              onDownloaded={imageStore.markDownloaded}
              onTogglePin={imageStore.togglePinned}
              onPickPng={pickPng}
              onReadPng={openPromptImport}
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
        {tab === 'dictionary' && <DictionaryView dictionary={dictionary} notify={show} />}
        {tab === 'settings' && (
          <SettingsView
            token={token}
            notify={show}
            getBackup={getBackup}
            onImportBackup={importBackup}
            onResetAll={onResetAll}
            onShowFirstRun={firstRun.showGuide}
            firstRunDisabled={!firstRunReady || firstRun.busy}
          />
        )}
      </main>

      <input
        ref={pngInput}
        type="file"
        accept="image/png,.png"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) openPromptImport({ blob: file, name: file.name });
        }}
      />
      {promptSource && firstRunReady && (
        <PromptImportDialog
          source={promptSource}
          entries={dictionary.entries}
          onCancel={() => setPromptSource(null)}
          onApply={applyPrompt}
        />
      )}

      {showLatest && latest && (
        <LatestPreview image={latest} onOpen={() => setTab('generate')} onDismiss={dismiss} />
      )}

      <Toast ref={toastRef} />
    </div>
  );
}

