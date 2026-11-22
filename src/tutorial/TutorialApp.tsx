import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { TokenStorage } from '../lib/token';
import type { WeightSyntax } from '../types';
import { maskToken } from '../lib/token';
import { emptyWorkspace, workspaceReducer } from '../lib/workspace';
import { buildCharacterPrompts, buildPrompt } from '../lib/prompt';
import { copyText } from '../lib/browser';
import { PromptPreview } from '../components/PromptPreview';
import { Toast, type ToastHandle } from '../components/Toast';
import { SampleIllustration } from './SampleIllustration';
import { TutorialTagEditor } from './TutorialTagEditor';
import {
  NOVELAI_URL,
  PRACTICE_TOKEN,
  TUTORIAL_CHAPTERS,
  TUTORIAL_STEPS,
  createTutorialDictionary,
  createTutorialSampleWorkspace,
  parseTutorialLocation,
  stepIndexByScene,
  type TutorialMode,
} from './tutorialData';
import type { TutorialSceneId } from '../lib/tutorialLinks';

const SIZE_OPTIONS = [
  { key: 'portrait', label: '縦長（832×1216）' },
  { key: 'landscape', label: '横長（1216×832）' },
  { key: 'square', label: '正方形（1024×1024）' },
] as const;

export function TutorialApp({ initialSearch }: { initialSearch?: string }) {
  const initial = useMemo(
    () => parseTutorialLocation(initialSearch ?? (typeof window !== 'undefined' ? window.location.search : '')),
    [initialSearch],
  );
  const [stepIndex, setStepIndex] = useState(initial.stepIndex);
  const [mode, setMode] = useState<TutorialMode>('try');
  const [paused, setPaused] = useState(false);
  const [showChapters, setShowChapters] = useState(initial.showChapters);
  const [showCopyGuide, setShowCopyGuide] = useState(false);

  // 練習用ステート（メモリ内のみ。IndexedDB / localStorage / sessionStorage / API には一切触れない）
  const [practiceClipboard, setPracticeClipboard] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenStorage, setTokenStorage] = useState<TokenStorage>('session');
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [syntax, setSyntax] = useState<WeightSyntax>('numeric');
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, emptyWorkspace);
  const entries = useMemo(() => createTutorialDictionary(), []);
  const [sizeKey, setSizeKey] = useState<(typeof SIZE_OPTIONS)[number]['key']>('portrait');
  const [generated, setGenerated] = useState(false);

  const toastRef = useRef<ToastHandle>(null);
  const notify = useCallback((message: string) => {
    toastRef.current?.show(message);
  }, []);

  const step = TUTORIAL_STEPS[stepIndex] ?? TUTORIAL_STEPS[0]!;
  const currentChapter = TUTORIAL_CHAPTERS.find((c) => c.id === step.chapterId) ?? TUTORIAL_CHAPTERS[0]!;

  // ステップに応じて前提となる練習用状態を自然に整える
  const syncStateForStep = useCallback((targetIndex: number) => {
    const target = TUTORIAL_STEPS[targetIndex];
    if (!target) return;
    if (target.id === 'register-paste' || target.id === 'register-save') {
      setPracticeClipboard((prev) => prev || PRACTICE_TOKEN);
    }
    if (target.id === 'register-save') {
      setTokenInput((prev) => prev || PRACTICE_TOKEN);
    }
    if (
      target.id === 'editor-add-background' ||
      target.id === 'editor-toggle-hat' ||
      target.id === 'generate-run' ||
      target.id === 'complete'
    ) {
      setSampleLoaded((loaded) => {
        if (!loaded) {
          dispatch({ type: 'replace', workspace: createTutorialSampleWorkspace() });
        }
        return true;
      });
    }
    if (target.id === 'generate-run') {
      setGenerated(false);
    }
    if (target.id === 'complete') {
      setGenerated(true);
    }
  }, []);

  const goToStep = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, nextIndex));
      syncStateForStep(clamped);
      setStepIndex(clamped);
      setTokenError(null);
      setShowChapters(false);
    },
    [syncStateForStep],
  );

  const goToScene = useCallback(
    (scene: TutorialSceneId) => {
      goToStep(stepIndexByScene(scene));
    },
    [goToStep],
  );

  const advance = useCallback(() => {
    if (stepIndex < TUTORIAL_STEPS.length - 1) {
      goToStep(stepIndex + 1);
    }
  }, [stepIndex, goToStep]);

  const handleLoadSample = useCallback(() => {
    dispatch({ type: 'replace', workspace: createTutorialSampleWorkspace() });
    setSampleLoaded(true);
    notify('練習用の見本タグと辞書を読み込みました');
    if (step.id === 'editor-load-sample') {
      goToStep(stepIndex + 1);
    }
  }, [goToStep, notify, step.id, stepIndex]);

  const performDemoAction = useCallback(() => {
    switch (step.id) {
      case 'example-overview':
      case 'token-open-settings':
      case 'token-open-account':
      case 'token-get-persistent':
      case 'token-overwrite':
        advance();
        break;
      case 'token-copy':
        setPracticeClipboard(PRACTICE_TOKEN);
        notify('練習用トークンをコピーしました');
        advance();
        break;
      case 'register-paste':
        setTokenInput(PRACTICE_TOKEN);
        setTokenError(null);
        advance();
        break;
      case 'register-save':
        setSavedToken(PRACTICE_TOKEN);
        notify('練習用トークンを保存しました（練習画面内のみ）');
        advance();
        break;
      case 'editor-load-sample':
        handleLoadSample();
        break;
      case 'editor-add-background': {
        const added = workspace.base.background.some(
          (t) => t.enabled && t.tag.toLowerCase() !== 'evening street',
        );
        if (added) {
          advance();
        } else {
          dispatch({ type: 'add', target: 'base', category: 'background', tag: 'sunset' });
          notify('ベースに背景タグ「sunset」を追加しました');
        }
        break;
      }
      case 'editor-toggle-hat': {
        const char = workspace.characters[0];
        const hat = char?.tags.outfit.find((t) => t.tag.toLowerCase() === 'hat');
        if (hat && !hat.enabled) {
          advance();
        } else if (char && hat && hat.enabled) {
          dispatch({ type: 'toggle', target: char.id, category: 'outfit', id: hat.id });
          notify('キャラの「hat」を OFF にしました');
        } else {
          advance();
        }
        break;
      }
      case 'generate-run':
        setGenerated(true);
        notify('生成例を表示しました');
        advance();
        break;
      case 'complete':
        break;
    }
  }, [advance, handleLoadSample, notify, step.id, workspace.base.background, workspace.characters]);

  // 「見るだけ」モード時の自動進行
  useEffect(() => {
    if (mode !== 'watch' || paused || showChapters || step.autoAdvanceMs <= 0) return;
    const timer = window.setTimeout(() => {
      performDemoAction();
    }, step.autoAdvanceMs);
    return () => window.clearTimeout(timer);
  }, [mode, paused, showChapters, step.autoAdvanceMs, performDemoAction]);

  const handleCopyPrompt = useCallback(
    async (text: string, label: string) => {
      if (!text) return;
      const ok = await copyText(text).catch(() => false);
      notify(ok ? `${label}をコピーしました` : 'コピーできませんでした');
    },
    [notify],
  );

  const hasSunset = workspace.base.background.some((t) => t.enabled && /sunset/i.test(t.tag));
  const hasHat = workspace.characters[0]?.tags.outfit.some((t) => t.enabled && /^hat$/i.test(t.tag)) ?? true;
  const selectedSize = SIZE_OPTIONS.find((s) => s.key === sizeKey) ?? SIZE_OPTIONS[0];
  const basePrompt = useMemo(() => buildPrompt(workspace.base, syntax), [workspace.base, syntax]);
  const characterPrompts = useMemo(
    () => buildCharacterPrompts(workspace.characters, syntax),
    [workspace.characters, syntax],
  );

  return (
    <div className="tutorial-shell">
      <header className="tutorial-header">
        <div className="tutorial-header-brand">
          <h1>nai-tagdeck 操作チュートリアル</h1>
          <span className="tutorial-badge">練習専用・データ保存なし</span>
        </div>
        <div className="tutorial-header-actions">
          <button type="button" className="btn btn-small" onClick={() => goToScene('edit-tags')}>
            設定済み・タグ編集から始める
          </button>
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={showChapters}
            onClick={() => setShowChapters((v) => !v)}
          >
            チャプター一覧
          </button>
        </div>
      </header>

      <div className="tutorial-player-bar" role="region" aria-label="チュートリアル操作バー">
        <div className="tutorial-mode-switch" role="group" aria-label="進行モード">
          <button
            type="button"
            className={`btn btn-small${mode === 'watch' ? ' btn-primary' : ''}`}
            aria-pressed={mode === 'watch'}
            onClick={() => {
              setMode('watch');
              setPaused(false);
            }}
          >
            見るだけ
          </button>
          <button
            type="button"
            className={`btn btn-small${mode === 'try' ? ' btn-primary' : ''}`}
            aria-pressed={mode === 'try'}
            onClick={() => setMode('try')}
          >
            操作してみる
          </button>
        </div>

        <div className="tutorial-nav-controls">
          <button
            type="button"
            className="btn btn-small"
            disabled={stepIndex === 0}
            onClick={() => goToStep(stepIndex - 1)}
          >
            前へ
          </button>
          {mode === 'watch' ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={step.id === 'complete'}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? '再生' : '一時停止'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-small"
              disabled={step.id === 'complete'}
              onClick={performDemoAction}
            >
              お手本を見る
            </button>
          )}
          <button
            type="button"
            className="btn btn-small"
            disabled={stepIndex === TUTORIAL_STEPS.length - 1}
            onClick={() => goToStep(stepIndex + 1)}
          >
            次へ
          </button>
        </div>
      </div>

      {showChapters && (
        <section className="card tutorial-chapters" aria-label="チャプター一覧">
          <h2 className="card-title">チャプター一覧</h2>
          <ol className="tutorial-chapter-list">
            {TUTORIAL_CHAPTERS.map((ch) => (
              <li key={ch.id}>
                <button
                  type="button"
                  className={`tutorial-chapter-btn${ch.id === currentChapter.id ? ' is-current' : ''}`}
                  onClick={() => goToScene(ch.id)}
                >
                  <span className="tutorial-chapter-num">{ch.number}.</span>
                  <span>
                    <strong>{ch.title}</strong>
                    <span className="tutorial-chapter-summary">{ch.summary}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="tutorial-subtitle-bar" aria-live="polite">
        <div className="tutorial-step-meta">
          <span>
            {currentChapter.number}. {currentChapter.title}
          </span>
          <span>
            ステップ {stepIndex + 1} / {TUTORIAL_STEPS.length}
          </span>
        </div>
        <h2 className="tutorial-step-title">{step.title}</h2>
        <p className="tutorial-subtitle-text">{step.subtitle}</p>
        {mode === 'try' && <p className="tutorial-action-hint">{step.actionHint}</p>}
      </section>

      <main className="tutorial-stage card">
        {step.chapterId === 'example' && (
          <div className="tutorial-example-scene">
            <SampleIllustration sunset hat />
            <div className="tutorial-example-explain">
              <h3>ベースとキャラの役割</h3>
              <ul>
                <li>
                  <strong>ベース</strong>：夕暮れの街・人数・画風など「画面全体」を指定
                </li>
                <li>
                  <strong>キャラ</strong>：コート・帽子・歩くポーズなど「人物ごと」を指定
                </li>
              </ul>
              <div className="tutorial-scene-actions">
                <button type="button" className="btn btn-primary" onClick={advance}>
                  トークン発行から体験する
                </button>
                <button type="button" className="btn" onClick={() => goToScene('edit-tags')}>
                  設定済み・タグ編集から始める
                </button>
              </div>
            </div>
          </div>
        )}

        {step.chapterId === 'issue-token' && (
          <div className="tutorial-mock-nai">
            <div className="tutorial-panel-head">
              <strong>NovelAI アカウント設定（練習用パネル）</strong>
              <a href={NOVELAI_URL} target="_blank" rel="noopener noreferrer" className="btn btn-small">
                NovelAIで実際に発行
              </a>
            </div>
            <p className="hint">
              実トークンは NovelAI で発行・コピーし、nai-tagdeck 本体の設定欄へ直接貼り付けてください。この練習画面では練習用トークンだけを使います。
            </p>
            <div className="tutorial-nai-frame">
              <div className="tutorial-nai-topbar">
                <span>NovelAI（練習画面）</span>
                <button
                  type="button"
                  className={`btn btn-small${step.id === 'token-open-settings' ? ' btn-primary is-spotlight' : ''}`}
                  onClick={() => {
                    if (step.id === 'token-open-settings') advance();
                  }}
                >
                  Settings
                </button>
              </div>

              {step.id !== 'token-open-settings' && (
                <div className="tutorial-nai-body">
                  <div className="tutorial-nai-tabs">
                    <button type="button" className="btn btn-small" disabled>
                      AI Settings
                    </button>
                    <button
                      type="button"
                      className={`btn btn-small${step.id === 'token-open-account' ? ' btn-primary is-spotlight' : ''}`}
                      onClick={() => {
                        if (step.id === 'token-open-account') advance();
                      }}
                    >
                      Account
                    </button>
                  </div>

                  {step.id !== 'token-open-account' && (
                    <div className="tutorial-nai-account">
                      <button
                        type="button"
                        className={`btn${step.id === 'token-get-persistent' ? ' btn-primary is-spotlight' : ''}`}
                        onClick={() => {
                          if (step.id === 'token-get-persistent') advance();
                        }}
                      >
                        Get Persistent API Token
                      </button>

                      {step.id === 'token-overwrite' && (
                        <div className="tutorial-nai-dialog" role="group" aria-label="トークン発行の確認">
                          <p>
                            <strong>注意：</strong>初回でも「Overwrite（上書き）」と表示されます。すでに発行済みのトークンがある場合、再発行すると旧トークンは無効になります。
                          </p>
                          <button
                            type="button"
                            className="btn btn-primary is-spotlight"
                            onClick={advance}
                          >
                            Overwrite
                          </button>
                        </div>
                      )}

                      {step.id === 'token-copy' && (
                        <div className="tutorial-nai-token-box">
                          <code>{PRACTICE_TOKEN}</code>
                          <button
                            type="button"
                            className="btn btn-primary is-spotlight"
                            onClick={() => {
                              setPracticeClipboard(PRACTICE_TOKEN);
                              notify('練習用トークンをコピーしました（練習画面内のみ）');
                              advance();
                            }}
                          >
                            コピー
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {step.chapterId === 'register-token' && (
          <div className="tutorial-mock-token">
            <div className="tutorial-panel-head">
              <strong>設定 → NovelAI のトークン（練習用）</strong>
              <span className="tutorial-badge">保存先には書き込みません</span>
            </div>
            <p className="hint">
              実トークンはここではなく nai-tagdeck 本体の「設定」に入力してください。ここでは練習用トークンで手順を試します。
            </p>
            <div className="token-form">
              <label className="field">
                <span>トークン</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={tokenInput}
                  placeholder="練習用トークンのみ入力できます"
                  aria-invalid={tokenError ? true : undefined}
                  onChange={(e) => {
                    const value = e.target.value.trim();
                    if (!value) {
                      setTokenInput('');
                      setTokenError(null);
                      return;
                    }
                    if (value !== PRACTICE_TOKEN) {
                      setTokenInput('');
                      setTokenError(
                        '実トークンは練習画面には入力できません。元の nai-tagdeck タブの「設定 → NovelAI のトークン」へ直接貼り付けてください。',
                      );
                      return;
                    }
                    setTokenError(null);
                    setTokenInput(value);
                    if (step.id === 'register-paste') {
                      advance();
                    }
                  }}
                />
              </label>
              {tokenError && (
                <p className="form-error" role="alert">
                  {tokenError}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className={`btn${step.id === 'register-paste' ? ' btn-primary is-spotlight' : ''}`}
                  onClick={() => {
                    setTokenError(null);
                    setTokenInput(practiceClipboard || PRACTICE_TOKEN);
                    notify('練習用トークンを貼り付けました');
                    if (step.id === 'register-paste') advance();
                  }}
                >
                  練習用トークンを貼り付け
                </button>
              </div>
              <fieldset className="radio-group">
                <legend>保存先の違い</legend>
                <label className="radio">
                  <input
                    type="radio"
                    name="tutorial-token-storage"
                    checked={tokenStorage === 'session'}
                    onChange={() => setTokenStorage('session')}
                  />
                  このタブだけ（タブを閉じると消える・共用端末向け）
                </label>
                <label className="radio">
                  <input
                    type="radio"
                    name="tutorial-token-storage"
                    checked={tokenStorage === 'local'}
                    onChange={() => setTokenStorage('local')}
                  />
                  このブラウザに保存（次回も使える・自分の端末向け）
                </label>
              </fieldset>
              <div className="form-actions">
                <button
                  type="button"
                  className={`btn btn-primary${step.id === 'register-save' ? ' is-spotlight' : ''}`}
                  disabled={tokenInput.trim() !== PRACTICE_TOKEN}
                  onClick={() => {
                    if (tokenInput.trim() !== PRACTICE_TOKEN) return;
                    setSavedToken(PRACTICE_TOKEN);
                    notify('練習用トークンを保存しました（練習画面内のみ）');
                    if (step.id === 'register-save') advance();
                  }}
                >
                  保存
                </button>
              </div>
              {savedToken && (
                <p className="token-status">
                  設定済み（練習） <code>{maskToken(savedToken)}</code>
                </p>
              )}
            </div>
          </div>
        )}

        {step.chapterId === 'edit-tags' && (
          <TutorialTagEditor
            stepId={step.id}
            workspace={workspace}
            entries={entries}
            sampleLoaded={sampleLoaded}
            syntax={syntax}
            onSyntaxChange={setSyntax}
            onLoadSample={handleLoadSample}
            onDispatch={dispatch}
            onBackgroundAdded={() => {
              notify('背景タグを追加しました。カテゴリとプロンプトの変化を確認してください');
            }}
            onBackgroundDuplicate={(tag) => {
              notify(`「${tag}」はすでに入っています。別の背景タグ（例: sunset）を選んでください`);
            }}
            onHatToggledOff={() => {
              notify('帽子タグを OFF にしました（編集欄に残ったままプロンプトから外れます）');
            }}
            onNextStep={advance}
            onCopy={handleCopyPrompt}
          />
        )}

        {step.id === 'generate-run' && (
          <div className="tutorial-generate-scene">
            <div className="tutorial-generate-controls">
              <label className="field">
                <span>画像サイズ</span>
                <select
                  value={sizeKey}
                  onChange={(e) => setSizeKey(e.target.value as (typeof SIZE_OPTIONS)[number]['key'])}
                >
                  {SIZE_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary is-spotlight"
                onClick={() => {
                  setGenerated(true);
                  notify('生成例を表示しました');
                  advance();
                }}
              >
                生成
              </button>
              <p className="hint">※ 練習画面のため NovelAI API への通信は行わず、事前に用意した生成例を表示します。</p>
            </div>
            {generated && (
              <SampleIllustration sunset={hasSunset} hat={hasHat} sizeKey={sizeKey} sizeLabel={selectedSize.label} />
            )}
          </div>
        )}

        {step.id === 'complete' && (
          <div className="tutorial-complete-scene">
            <SampleIllustration sunset={hasSunset} hat={hasHat} sizeKey={sizeKey} sizeLabel={selectedSize.label} />
            <div className="tutorial-complete-body">
              <h3>準備完了です！</h3>
              <p>
                元の <strong>nai-tagdeck タブ</strong> へ戻ると、開いていた画面や編集中の内容がそのまま残っています。
              </p>
              {initial.from === 'token-settings' && (
                <p className="tutorial-return-highlight">
                  トークン設定欄から開いたため、元のタブでは「NovelAI のトークン」欄が開いたままです。NovelAI でコピーした実トークンをそのまま貼り付けて保存できます。
                </p>
              )}
              <div className="tutorial-scene-actions">
                {initial.from ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        window.close();
                        notify('ブラウザのタブ切り替えで元の nai-tagdeck タブへ戻ってください');
                      }}
                    >
                      元の nai-tagdeck タブに戻る
                    </button>
                    <a href="../" className="btn">
                      新しく nai-tagdeck を開く
                    </a>
                  </>
                ) : (
                  <a href="../" className="btn btn-primary">
                    nai-tagdeckで実際に生成する
                  </a>
                )}
                <button
                  type="button"
                  className="btn"
                  aria-expanded={showCopyGuide}
                  onClick={() => setShowCopyGuide((v) => !v)}
                >
                  プロンプトのコピー手順を見る
                </button>
              </div>
              {showCopyGuide && (
                <div className="tutorial-copy-guide">
                  <p className="hint">
                    ベースとキャラそれぞれの「コピー」ボタンから、プロンプトを個別にコピーして NovelAI 公式画面などへ貼り付けられます。
                  </p>
                  <PromptPreview
                    basePrompt={basePrompt}
                    characterPrompts={characterPrompts}
                    syntax={syntax}
                    onSyntaxChange={setSyntax}
                    onCopy={handleCopyPrompt}
                    negativePrompt=""
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <Toast ref={toastRef} />
    </div>
  );
}
