import { useId, useState } from 'react';
import type { Settings, WeightSyntax } from '../types';
import type { CharacterPrompt } from '../lib/prompt';
import { DEFAULT_SETTINGS } from '../lib/settings';

interface Props {
  basePrompt: string;
  characterPrompts: CharacterPrompt[];
  syntax: WeightSyntax;
  onSyntaxChange: (syntax: WeightSyntax) => void;
  onCopy: (text: string, label: string) => void;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
}

type NegativeKey = 'negativePrompt' | 'characterNegativePrompt';

const NEGATIVE_FIELDS: Array<{ key: NegativeKey; label: string; help: string }> = [
  {
    key: 'negativePrompt',
    label: 'ネガティブ（Undesired Content）',
    help: '生成時にだけ送ります。既定値は公式UIの UC プリセット「heavy」と同じ文面です。NSFW を生成するときは先頭の nsfw を消してください。',
  },
  {
    key: 'characterNegativePrompt',
    label: 'キャラクター用のネガティブ',
    help: 'ON のキャラクターすべてに同じ文面を付けます。',
  },
];

export function PromptPreview({ basePrompt, characterPrompts, syntax, onSyntaxChange, onCopy, settings, onSettingsChange }: Props) {
  const [open, setOpen] = useState(true);
  const [negativeOpen, setNegativeOpen] = useState(false);
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
        </dl>
        {syntax === 'brace' && (
          <p className="hint">マイナスや 0 の重みは括弧で表せないため、そのタグだけ数値の記法で出力します。</p>
        )}

        <div className="negative-section">
          <button
            type="button"
            className="disclosure"
            aria-expanded={negativeOpen}
            aria-controls={`${id}-negative`}
            onClick={() => setNegativeOpen((value) => !value)}
          >
            <span className="disclosure-icon" aria-hidden="true" />
            ネガティブ
            <span className="count">{settings.negativePrompt.trim() ? 'あり' : 'なし'}</span>
          </button>
          <div id={`${id}-negative`} hidden={!negativeOpen}>
            {NEGATIVE_FIELDS.map(({ key, label, help }) => (
              <div className="setting" key={key}>
                <div className="setting-head">
                  <label htmlFor={`${id}-${key}`}>{label}</label>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={settings[key] === DEFAULT_SETTINGS[key]}
                    onClick={() => onSettingsChange({ [key]: DEFAULT_SETTINGS[key] })}
                  >
                    既定値に戻す
                  </button>
                </div>
                <textarea
                  id={`${id}-${key}`}
                  rows={key === 'negativePrompt' ? 5 : 2}
                  spellCheck={false}
                  autoCapitalize="off"
                  value={settings[key]}
                  onChange={(e) => onSettingsChange({ [key]: e.target.value })}
                />
                <p className="hint">{help}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
