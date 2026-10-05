import { useCallback, useMemo, useState } from 'react';
import { Editor } from './components/Editor';
import { DictionaryView } from './components/DictionaryView';
import { SettingsView } from './components/SettingsView';
import { useDictionary } from './hooks/useDictionary';
import { useSettings, useWorkspace } from './hooks/useWorkspace';
import { useToast } from './hooks/useToast';
import { buildCharacterPrompts, buildPrompt } from './lib/prompt';
import { copyText } from './lib/browser';

type Tab = 'editor' | 'dictionary' | 'settings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'editor', label: '編集' },
  { key: 'dictionary', label: '辞書' },
  { key: 'settings', label: '設定' },
];

export default function App() {
  const dictionary = useDictionary();
  const { workspace, dispatch, loaded } = useWorkspace();
  const [settings, updateSettings] = useSettings();
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

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">nai-tagdeck</h1>
        <nav className="tabbar" aria-label="画面切り替え">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="tab"
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === 'dictionary' && <span className="tab-count">{dictionary.entries.length}</span>}
            </button>
          ))}
        </nav>
        {/* キャラクタープロンプトは公式UIでも別の欄なので、ここではベースだけをコピーする */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!basePrompt}
          onClick={() => copy(basePrompt, characterPrompts.length ? 'ベース' : 'プロンプト全体')}
        >
          {characterPrompts.length ? 'ベースをコピー' : '全体コピー'}
        </button>
      </header>

      {dictionary.error && (
        <p className="error-banner" role="alert">
          {dictionary.error}
        </p>
      )}

      <main className="app-main">
        {tab === 'editor' ? (
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
          />
        ) : tab === 'dictionary' ? (
          <DictionaryView dictionary={dictionary} notify={show} />
        ) : (
          <SettingsView settings={settings} onChange={updateSettings} />
        )}
      </main>

      <div className="toast" role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
}
