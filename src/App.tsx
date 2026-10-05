import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor } from './components/Editor';
import { DictionaryView } from './components/DictionaryView';
import { SettingsView } from './components/SettingsView';
import { GeneratePanel } from './components/GeneratePanel';
import { Gallery } from './components/Gallery';
import { QuickGenerate } from './components/QuickGenerate';
import { LatestPreview } from './components/LatestPreview';
import { CopyIcon } from './components/icons';
import { useDictionary } from './hooks/useDictionary';
import { useGenerationSettings, useSettings, useWorkspace } from './hooks/useWorkspace';
import { useToast } from './hooks/useToast';
import { useToken } from './hooks/useToken';
import { useImages } from './hooks/useImages';
import { useGenerator } from './hooks/useGenerator';
import { usePresets } from './hooks/usePresets';
import { mergePresets } from './lib/presets';
import type { Backup } from './lib/backup';
import { buildCharacterPrompts, buildPrompt } from './lib/prompt';
import { sizeOf } from './lib/generation';
import { copyText } from './lib/browser';

type Tab = 'editor' | 'generate' | 'dictionary' | 'settings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'editor', label: '編集' },
  { key: 'generate', label: '生成' },
  { key: 'dictionary', label: '辞書' },
  { key: 'settings', label: '設定' },
];

export default function App() {
  const dictionary = useDictionary();
  const { workspace, dispatch, loaded } = useWorkspace();
  const [settings, updateSettings] = useSettings();
  const [generation, updateGeneration] = useGenerationSettings();
  const token = useToken();
  const presets = usePresets();
  const imageStore = useImages();
  const generator = useGenerator(imageStore.add);
  const [tab, setTab] = useState<Tab>('editor');
  const { message, show } = useToast();

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

  const getBackup = useCallback(
    (): Backup => ({
      dictionary: dictionary.entries,
      presets: presets.presets,
      workspace,
      settings,
      generation,
    }),
    [dictionary.entries, presets.presets, workspace, settings, generation],
  );

  const importBackup = useCallback(
    async (data: Backup) => {
      await dictionary.importEntries(data.dictionary, 'merge');
      presets.setPresets(mergePresets(presets.presets, data.presets));
      presets.setActiveId(null);
      dispatch({ type: 'replace', workspace: data.workspace });
      updateSettings(data.settings);
      updateGeneration(data.generation);
    },
    [dictionary, presets, dispatch, updateSettings, updateGeneration],
  );

  // ---- 生成（ヘッダー・生成パネル・Ctrl+Enter の共通処理） ----
  const blocker = !token.token
    ? 'トークンが未設定です'
    : !basePrompt
      ? 'ベースに ON のタグがありません'
      : null;

  const startGenerate = useCallback(() => {
    if (generator.generating) return;
    if (!token.token) {
      show('トークンが未設定です。設定タブで入力してください', 3500);
      setTab('settings');
      return;
    }
    if (!basePrompt) {
      show('ベースに ON のタグがありません', 3000);
      return;
    }
    void generator.generate({
      token: token.token,
      prompt: basePrompt,
      negative: settings.negativePrompt,
      characters: characterPrompts.map((c) => ({ prompt: c.prompt, negative: settings.characterNegativePrompt })),
      settings: generation,
    });
  }, [generator, token.token, basePrompt, characterPrompts, settings, generation, show]);

  // Ctrl+Enter（Mac は ⌘+Enter）でどこからでも生成する
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        startGenerate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [startGenerate]);

  // 生成パネルが見えていないとき（狭い画面の編集タブ）でも失敗に気づけるようにする
  useEffect(() => {
    if (generator.error) show(generator.error, 6000);
  }, [generator.error, show]);

  // 新しい画像が届いたら、編集タブの右下に小さく知らせる
  const latest = imageStore.images[0];
  const [unseenId, setUnseenId] = useState<string | null>(null);
  const lastSeenLatest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (latest && latest.id !== lastSeenLatest.current) setUnseenId(latest.id);
    lastSeenLatest.current = latest?.id;
  }, [latest]);
  useEffect(() => {
    if (tab === 'generate') setUnseenId(null);
  }, [tab]);

  const showWorkbench = tab === 'editor' || tab === 'generate';

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">nai-tagdeck</h1>
        <QuickGenerate
          size={generation.size}
          onSizeChange={(size) => updateGeneration({ size })}
          generating={generator.generating}
          blocker={blocker}
          onGenerate={startGenerate}
        />
        <nav className="tabbar" aria-label="画面切り替え">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tab tab-${t.key}`}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.label}
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
        {/* キャラクタープロンプトは公式UIでも別の欄なので、ここではベースだけをコピーする */}
        <button
          type="button"
          className="btn copy-btn"
          disabled={!basePrompt}
          aria-label={characterPrompts.length ? 'ベースをコピー' : 'プロンプト全体をコピー'}
          title={characterPrompts.length ? 'ベースをコピー' : 'プロンプト全体をコピー'}
          onClick={() => copy(basePrompt, characterPrompts.length ? 'ベース' : 'プロンプト全体')}
        >
          <CopyIcon />
          <span className="copy-label">{characterPrompts.length ? 'ベースをコピー' : '全体コピー'}</span>
        </button>
      </header>

      {dictionary.error && (
        <p className="error-banner" role="alert">
          {dictionary.error}
        </p>
      )}

      <main className="app-main">
        {/* 編集と生成は、広い画面では左右に並べ、狭い画面ではタブで切り替える（どちらも表示したまま CSS で隠す） */}
        <div className="workbench" data-tab={tab} hidden={!showWorkbench}>
          <div className="pane pane-editor">
            <Editor
              workspace={workspace}
              dispatch={dispatch}
              loaded={loaded}
              basePrompt={basePrompt}
              characterPrompts={characterPrompts}
              dictionary={dictionary}
              syntax={settings.weightSyntax}
              onSyntaxChange={(weightSyntax) => updateSettings({ weightSyntax })}
              onCopy={copy}
              notify={show}
              presets={presets}
            />
          </div>
          <div className="pane pane-generate">
            <GeneratePanel
              generation={generation}
              onGenerationChange={updateGeneration}
              generator={generator}
              token={token}
              basePrompt={basePrompt}
              characterPrompts={characterPrompts}
              settings={settings}
              onOpenSettings={() => setTab('settings')}
              blocker={blocker}
              onGenerate={startGenerate}
            />
            <Gallery
              images={imageStore.images}
              generating={generator.generating}
              pendingSize={sizeOf(generation.size)}
              onRemove={imageStore.remove}
              onClear={imageStore.clear}
              onUseSeed={applySeed}
            />
          </div>
        </div>
        {tab === 'dictionary' && <DictionaryView dictionary={dictionary} notify={show} />}
        {tab === 'settings' && (
          <SettingsView
            settings={settings}
            onChange={updateSettings}
            token={token}
            notify={show}
            getBackup={getBackup}
            onImportBackup={importBackup}
          />
        )}
      </main>

      {tab === 'editor' && latest && unseenId === latest.id && (
        <LatestPreview image={latest} onOpen={() => setTab('generate')} onDismiss={() => setUnseenId(null)} />
      )}

      <div className="toast" role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
}
