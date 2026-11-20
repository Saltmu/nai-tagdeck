import { type MouseEvent, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
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
import { useToast } from './hooks/useToast';
import { useToken } from './hooks/useToken';
import { useTagUndo } from './hooks/useTagUndo';
import { UndoBar } from './components/UndoBar';
import { useImages } from './hooks/useImages';
import { useGenerator } from './hooks/useGenerator';
import { usePresets } from './hooks/usePresets';
import { useBackupTransfer } from './hooks/useBackupTransfer';
import { useGenerationControls } from './hooks/useGenerationControls';
import { useLatestImageNotice } from './hooks/useLatestImageNotice';
import { useFirstRun } from './hooks/useFirstRun';
import { isEmptyWorkspace } from './lib/presets';
import { DEFAULT_SETTINGS } from './lib/settings';
import { DEFAULT_GENERATION } from './lib/generation';
import { buildCategoryPrompt, buildCharacterPrompts, buildPrompt } from './lib/prompt';
import { BookIcon, EditIcon, SettingsIcon, SparkleIcon } from './components/icons';
import { sizeOf } from './lib/generation';
import { copyText } from './lib/browser';
import type { PromptImport } from './lib/promptImport';

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
  const { message, show } = useToast();
  const imageStore = useImages({
    onEvict: (count) => show(`履歴上限のため、古い画像 ${count}枚を削除しました`, 6000),
  });
  const generator = useGenerator(imageStore.add);
  const [tab, setTab] = useState<Tab>('editor');
  const [promptSource, setPromptSource] = useState<PromptSource | null>(null);
  const pngInput = useRef<HTMLInputElement>(null);
  // 広い画面では、画像エリアをクリックしたらドックを閉じる（バーは初期表示と同じ形で残る）
  const [dockCollapse, setDockCollapse] = useState(0);
  const hideDockOnImageClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.dock')) return;
    if (window.matchMedia?.('(min-width: 1100px)').matches) setDockCollapse((n) => n + 1);
  };
  const tagUndo = useTagUndo(workspace, rawDispatch, show);
  const dispatch = tagUndo.dispatch;
  const openEditor = useCallback(() => setTab('editor'), []);
  const firstRunReady = dictionary.loaded && !dictionary.error &&
    [persistence, settingsPersistence, generationPersistence, ...presets.persistence].every((state) => state.loaded && !state.error);
  const firstRun = useFirstRun({
    ready: firstRunReady,
    hasExistingData: !isEmptyWorkspace(workspace) || dictionary.entries.length > 0 || presets.presets.length > 0 || !!token.token ||
      JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS) || JSON.stringify(generation) !== JSON.stringify(DEFAULT_GENERATION),
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
  const pickPng = firstRunReady ? () => pngInput.current?.click() : undefined;
  const openPromptImport = (source: PromptSource) => {
    if (firstRunReady) setPromptSource(source);
  };
  const applyPrompt = (result: PromptImport, applyGeneration: boolean) => {
    setPromptSource(null);
    dispatch({ type: 'replace', workspace: {
      base: result.base,
      characters: result.characters,
      negative: result.negative ?? workspace.negative,
    } });
    presets.setActiveId(null);
    if (result.characterNegative !== undefined) updateSettings({ characterNegativePrompt: result.characterNegative });
    if (applyGeneration) updateGeneration(result.generation.values);
    openEditor();
    show('画像のプロンプトを読み込みました');
  };

  const showWorkbench = tab === 'editor' || tab === 'generate';

  return (
    <div className={`app${showLatest ? ' has-latest' : ''}`}>
      <header className="app-header" data-occludes>
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
              aria-label={t.label}
              title={t.label}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.icon}
              <span className="tab-label">{t.label}</span>
              {t.key === 'generate' &&
                (generator.generating ? (
                  <span className="spinner spinner-small" aria-label="生成中" />
                ) : (
                  imageStore.images.length > 0 && <span className="tab-count">{imageStore.images.length}</span>
                ))}
              {t.key === 'dictionary' && <span className="tab-count">{dictionary.entries.length}</span>}
            </button>
          ))}
        </nav>
        <QuickGenerate
          size={generation.size}
          onSizeChange={(size) => updateGeneration({ size })}
          generating={generator.generating}
          blocker={blocker}
          onGenerate={startGenerate}
        />
      </header>

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
              loaded={loaded}
              dictionary={dictionary}
              syntax={settings.weightSyntax}
              onCopy={copy}
              notify={show}
              presets={presets}
              onPickPng={pickPng}
              characterNegative={settings.characterNegativePrompt}
              onCharacterNegativeChange={(characterNegativePrompt) => updateSettings({ characterNegativePrompt })}
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
                  onSyntaxChange={(weightSyntax) => updateSettings({ weightSyntax })}
                  onCopy={copy}
                  negativePrompt={negativePrompt}
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

      <UndoBar
        open={tagUndo.barOpen}
        label={tagUndo.label}
        canUndo={tagUndo.canUndo}
        canRedo={tagUndo.canRedo}
        onUndo={tagUndo.undo}
        onRedo={tagUndo.redo}
        onDismiss={tagUndo.dismiss}
      />

      <div className={`toast${tagUndo.barOpen ? ' toast-raised' : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
}

