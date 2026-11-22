import { useEffect, useMemo, useState } from 'react';
import type { DictEntry, WeightSyntax, Workspace } from '../types';
import { TagInput } from '../components/TagInput';
import { PromptPreview } from '../components/PromptPreview';
import { categoryLabel } from '../lib/categories';
import { buildCharacterPrompts, buildPrompt } from '../lib/prompt';
import { BASE, type WorkspaceAction } from '../lib/workspace';
import type { TutorialStepId } from './tutorialData';

interface Props {
  stepId: TutorialStepId;
  workspace: Workspace;
  entries: DictEntry[];
  sampleLoaded: boolean;
  syntax: WeightSyntax;
  onSyntaxChange: (syntax: WeightSyntax) => void;
  onLoadSample: () => void;
  onDispatch: (action: WorkspaceAction) => void;
  onBackgroundAdded: () => void;
  onBackgroundDuplicate: (tag: string) => void;
  onHatToggledOff: () => void;
  onNextStep: () => void;
  onCopy: (text: string, label: string) => void;
}

export function TutorialTagEditor({
  stepId,
  workspace,
  entries,
  sampleLoaded,
  syntax,
  onSyntaxChange,
  onLoadSample,
  onDispatch,
  onBackgroundAdded,
  onBackgroundDuplicate,
  onHatToggledOff,
  onNextStep,
  onCopy,
}: Props) {
  const [activePane, setActivePane] = useState<'base' | 'character'>(
    stepId === 'editor-toggle-hat' ? 'character' : 'base',
  );
  const character = workspace.characters[0];

  useEffect(() => {
    if (stepId === 'editor-toggle-hat' && character) {
      setActivePane('character');
    } else if (stepId === 'editor-add-background') {
      setActivePane('base');
    }
  }, [stepId, character]);

  const pane = activePane === 'character' && !character ? 'base' : activePane;

  const basePrompt = useMemo(() => buildPrompt(workspace.base, syntax), [workspace.base, syntax]);
  const characterPrompts = useMemo(
    () => buildCharacterPrompts(workspace.characters, syntax),
    [workspace.characters, syntax],
  );

  const backgroundDone = workspace.base.background.some(
    (t) => t.enabled && t.tag.toLowerCase() !== 'evening street',
  );
  const hatDone =
    character?.tags.outfit.some((t) => !t.enabled && t.tag.toLowerCase() === 'hat') ?? false;
  const stepCompleted =
    (stepId === 'editor-add-background' && backgroundDone) ||
    (stepId === 'editor-toggle-hat' && hatDone);

  const backgroundEntries = useMemo(
    () => entries.filter((e) => e.category === 'background'),
    [entries],
  );

  const handleBaseAdd = (tag: string, weight: number) => {
    const normalized = tag.trim().toLowerCase();
    const alreadyEnabled = workspace.base.background.some(
      (t) => t.enabled && t.tag.toLowerCase() === normalized,
    );
    if (alreadyEnabled) {
      onBackgroundDuplicate(tag);
      return;
    }
    onDispatch({ type: 'add', target: BASE, category: 'background', tag, weight });
    onBackgroundAdded();
  };

  return (
    <div className="tutorial-editor-split">
      <div className="tutorial-editor-pane">
        <div className="tutorial-panel-head">
          <strong>練習用タグ編集（既存UIを再利用）</strong>
          <span className="tutorial-badge">練習データのみ</span>
        </div>

        {!sampleLoaded || stepId === 'editor-load-sample' ? (
          <div className="tutorial-empty-editor">
            <p className="hint">
              {sampleLoaded
                ? '見本のタグと辞書をもう一度読み込み直して、この場面を最初から試せます。'
                : 'まだタグと辞書が入っていません。まず「タグの例と辞書を読み込む」を押して見本を読み込みましょう。'}
            </p>
            <button
              type="button"
              className={`btn btn-primary${stepId === 'editor-load-sample' ? ' is-spotlight' : ''}`}
              onClick={onLoadSample}
            >
              タグの例と辞書を読み込む
            </button>
          </div>
        ) : (
          <>
            <div className="tutorial-pane-tabs" role="tablist" aria-label="編集対象の切り替え">
              <button
                type="button"
                role="tab"
                aria-selected={pane === 'base'}
                className={`btn btn-small${pane === 'base' ? ' btn-primary' : ''}`}
                onClick={() => setActivePane('base')}
              >
                ベース（全体・背景）
              </button>
              {character && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={pane === 'character'}
                  className={`btn btn-small${pane === 'character' ? ' btn-primary' : ''}${
                    stepId === 'editor-toggle-hat' && pane !== 'character' ? ' is-spotlight' : ''
                  }`}
                  onClick={() => setActivePane('character')}
                >
                  {character.name}（服装・特徴）
                </button>
              )}
            </div>

            {pane === 'base' ? (
              <div className="tutorial-pane-body">
                <div className={stepId === 'editor-add-background' ? 'tutorial-spotlight-box' : undefined}>
                  <TagInput
                    category="background"
                    label="ベースに背景タグを追加（日本語で検索）"
                    placeholder="例: 夕焼け / 街並み"
                    entries={backgroundEntries}
                    onAdd={(tag, weight) => handleBaseAdd(tag, weight)}
                    onPick={(tag, weight) => handleBaseAdd(tag, weight)}
                  />
                </div>
                <div className="tutorial-category-block">
                  <div className="tutorial-category-title">{categoryLabel('background')}（ベース）</div>
                  <ul className="tutorial-tag-list">
                    {workspace.base.background.map((t) => (
                      <li key={t.id} className={`tutorial-tag-item${t.enabled ? '' : ' is-off'}`}>
                        <label className="tutorial-tag-check">
                          <input
                            type="checkbox"
                            checked={t.enabled}
                            onChange={() =>
                              onDispatch({ type: 'toggle', target: BASE, category: 'background', id: t.id })
                            }
                          />
                          <span>{t.tag}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : character ? (
              <div className="tutorial-pane-body">
                <div className="tutorial-category-block">
                  <div className="tutorial-category-title">{categoryLabel('outfit')}（{character.name}）</div>
                  <ul className="tutorial-tag-list">
                    {character.tags.outfit.map((t) => {
                      const isHatTarget = stepId === 'editor-toggle-hat' && t.tag.toLowerCase() === 'hat' && t.enabled;
                      return (
                        <li
                          key={t.id}
                          className={`tutorial-tag-item${t.enabled ? '' : ' is-off'}${
                            isHatTarget ? ' is-spotlight' : ''
                          }`}
                        >
                          <label className="tutorial-tag-check">
                            <input
                              type="checkbox"
                              checked={t.enabled}
                              onChange={() => {
                                const wasEnabled = t.enabled;
                                onDispatch({
                                  type: 'toggle',
                                  target: character.id,
                                  category: 'outfit',
                                  id: t.id,
                                });
                                if (wasEnabled && t.tag.toLowerCase() === 'hat') {
                                  onHatToggledOff();
                                }
                              }}
                            />
                            <span>{t.tag}</span>
                            {!t.enabled && <span className="tutorial-off-note">OFF（編集欄に残る）</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ) : null}
            {stepCompleted && (stepId === 'editor-add-background' || stepId === 'editor-toggle-hat') && (
              <div className="tutorial-step-done" role="status">
                <span>
                  {stepId === 'editor-add-background'
                    ? 'カテゴリとプロンプトに反映されました。確認できたら次へ進みましょう。'
                    : 'タグは編集欄に残ったまま、プロンプトから外れました。確認できたら次へ進みましょう。'}
                </span>
                <button type="button" className="btn btn-primary btn-small is-spotlight" onClick={onNextStep}>
                  確認して次へ
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="tutorial-preview-pane">
        <div className="tutorial-panel-head">
          <strong>変化後のプロンプト（リアルタイム反映）</strong>
        </div>
        <PromptPreview
          basePrompt={basePrompt}
          characterPrompts={characterPrompts}
          syntax={syntax}
          onSyntaxChange={onSyntaxChange}
          onCopy={onCopy}
          negativePrompt=""
        />
      </div>
    </div>
  );
}
