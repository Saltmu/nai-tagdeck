import { useCallback, useMemo, useState } from 'react';
import { Editor } from './components/Editor';
import { DictionaryView } from './components/DictionaryView';
import { useDictionary } from './hooks/useDictionary';
import { useSettings, useWorkspace } from './hooks/useWorkspace';
import { useToast } from './hooks/useToast';
import { buildPrompt } from './lib/prompt';
import { copyText } from './lib/browser';

type Tab = 'editor' | 'dictionary';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'editor', label: '編集' },
  { key: 'dictionary', label: '辞書' },
];

export default function App() {
  const dictionary = useDictionary();
  const { workspace, dispatch, loaded } = useWorkspace();
  const [settings, updateSettings] = useSettings();
  const [tab, setTab] = useState<Tab>('editor');
  const { message, show } = useToast();

  const fullPrompt = useMemo(
    () => buildPrompt(workspace, settings.weightSyntax),
    [workspace, settings.weightSyntax],
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
        <button
          type="button"
          className="btn btn-primary"
          disabled={!fullPrompt}
          onClick={() => copy(fullPrompt, 'プロンプト全体')}
        >
          全体コピー
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
            prompt={fullPrompt}
            dictionary={dictionary}
            syntax={settings.weightSyntax}
            onSyntaxChange={(weightSyntax) => updateSettings({ weightSyntax })}
            onCopy={copy}
            notify={show}
          />
        ) : (
          <DictionaryView dictionary={dictionary} notify={show} />
        )}
      </main>

      <div className="toast" role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
}
