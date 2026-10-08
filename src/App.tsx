import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Editor } from './components/Editor';
import { DictionaryView } from './components/DictionaryView';
import { SettingsView } from './components/SettingsView';
import { GeneratePanel } from './components/GeneratePanel';
import { PromptPreview } from './components/PromptPreview';
import { Gallery } from './components/Gallery';
import { QuickGenerate } from './components/QuickGenerate';
import { LatestPreview } from './components/LatestPreview';
import { useDictionary } from './hooks/useDictionary';
import { useGenerationSettings, useSettings, useWorkspace } from './hooks/useWorkspace';
import { useToast } from './hooks/useToast';
import { useToken } from './hooks/useToken';
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
import { buildCharacterPrompts, buildPrompt } from './lib/prompt';
import { BookIcon, EditIcon, SettingsIcon, SparkleIcon } from './components/icons';
import { sizeOf } from './lib/generation';
import { copyText } from './lib/browser';

type Tab = 'editor' | 'generate' | 'dictionary' | 'settings';

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'editor', label: '編集', icon: <EditIcon /> },
  { key: 'generate', label: '生成', icon: <SparkleIcon /> },
  { key: 'dictionary', label: '辞書', icon: <BookIcon /> },
  { key: 'settings', label: '設定', icon: <SettingsIcon /> },
];

export default function App({ onResetAll }: { onResetAll: () => void }) {
  const dictionary = useDictionary();
  const { workspace, dispatch, loaded, persistence } = useWorkspace();
  const [settings, updateSettings, settingsPersistence] = useSettings();
  const [generation, updateGeneration, generationPersistence] = useGenerationSettings();
  const token = useToken();
  const presets = usePresets();
  const imageStore = useImages();
  const generator = useGenerator(imageStore.add);
  const [tab, setTab] = useState<Tab>('editor');
  const { message, show } = useToast();
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
    generator, token: token.token, basePrompt, characterPrompts, settings, generation, show, onOpenSettings: openSettings,
  });
  const latest = imageStore.images[0];
  const { unseenId, dismiss } = useLatestImageNotice(latest?.id, tab === 'generate');

  const showWorkbench = tab === 'editor' || tab === 'generate';

  return (
    <div className="app">
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
            />
          </div>
          <div className="pane pane-generate">
            <PromptPreview
              basePrompt={basePrompt}
              characterPrompts={characterPrompts}
              syntax={settings.weightSyntax}
              onSyntaxChange={(weightSyntax) => updateSettings({ weightSyntax })}
              onCopy={copy}
              settings={settings}
              onSettingsChange={updateSettings}
            />
            <Gallery
              images={imageStore.images}
              generating={generator.generating}
              pendingSize={sizeOf(generation.size)}
              onRemove={imageStore.remove}
              onClear={imageStore.clear}
              onUseSeed={applySeed}
              onDownloaded={imageStore.markDownloaded}
            />
            {/* 詳細設定は下端に寄せ、プロンプトと画像を先に見せる */}
            <GeneratePanel
              generation={generation}
              onGenerationChange={updateGeneration}
              generator={generator}
              token={token}
              basePrompt={basePrompt}
              characterPrompts={characterPrompts}
              settings={settings}
              onOpenSettings={openSettings}
              blocker={blocker}
              onGenerate={startGenerate}
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

      {tab === 'editor' && latest && unseenId === latest.id && (
        <LatestPreview image={latest} onOpen={() => setTab('generate')} onDismiss={dismiss} />
      )}

      <div className="toast" role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
}

