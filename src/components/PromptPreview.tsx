import { useId, useState } from 'react';
import type { WeightSyntax } from '../types';
import type { CharacterPrompt } from '../lib/prompt';

interface Props {
  basePrompt: string;
  characterPrompts: CharacterPrompt[];
  syntax: WeightSyntax;
  onSyntaxChange: (syntax: WeightSyntax) => void;
  onCopy: (text: string, label: string) => void;
  /** ネガティブのタグから組み立てた文面。 */
  negativePrompt: string;
}

export function PromptPreview({ basePrompt, characterPrompts, syntax, onSyntaxChange, onCopy, negativePrompt }: Props) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section className="card preview" aria-labelledby={`${id}-heading`}>
      <div className="card-head">
        <h2 id={`${id}-heading`} className="card-title">
          <button
            type="button"
            className="disclosure"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="disclosure-icon" aria-hidden="true" />
            プロンプト
          </button>
        </h2>
      </div>
      <div id={`${id}-body`} hidden={!open}>
        <label className="inline-field">
          <span>強調の記法</span>
          <select value={syntax} onChange={(e) => onSyntaxChange(e.target.value as WeightSyntax)}>
            <option value="numeric">1.2::tag::</option>
            <option value="brace">{'{tag} / [tag]'}</option>
          </select>
        </label>
        <dl className="preview-list">
          <div className="preview-item">
            <dt>
              ベース
              <button
                type="button"
                className="btn btn-small"
                disabled={!basePrompt}
                onClick={() => onCopy(basePrompt, characterPrompts.length ? 'ベース' : 'プロンプト全体')}
              >
                コピー
              </button>
            </dt>
            <dd>
              <output className={`preview-text${basePrompt ? '' : ' is-empty'}`}>
                {basePrompt || 'ONのタグがありません'}
              </output>
            </dd>
          </div>
          {characterPrompts.map((c) => (
            <div className="preview-item" key={c.id}>
              <dt>
                {c.name}
                <button type="button" className="btn btn-small" onClick={() => onCopy(c.prompt, c.name)}>
                  コピー
                </button>
              </dt>
              <dd><output className="preview-text">{c.prompt}</output></dd>
            </div>
          ))}
          <div className="preview-item preview-negative">
            <dt>
              ネガティブ
              <button
                type="button"
                className="btn btn-small"
                disabled={!negativePrompt}
                onClick={() => onCopy(negativePrompt, 'ネガティブ')}
              >
                コピー
              </button>
            </dt>
            <dd>
              <output className={`preview-text${negativePrompt ? '' : ' is-empty'}`}>
                {negativePrompt || 'ネガティブなし（編集の「ネガティブ」タブで追加できます）'}
              </output>
            </dd>
          </div>
        </dl>
        {syntax === 'brace' && (
          <p className="hint">マイナスや 0 の重みは括弧で表せないため、そのタグだけ数値の記法で出力します。</p>
        )}
      </div>
    </section>
  );
}
