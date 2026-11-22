import { Fragment } from 'react';
import type { GenerationMode } from '../lib/novelai';
import { prefixFurryDataset, type CharacterPrompt } from '../lib/prompt';
import type { WeightSyntax } from '../types';

interface Props {
  basePrompt: string;
  characterPrompts: CharacterPrompt[];
  syntax: WeightSyntax;
  onSyntaxChange: (syntax: WeightSyntax) => void;
  onCopy: (text: string, label: string) => void;
  /** ネガティブのタグから組み立てた文面。 */
  negativePrompt: string;
  /** 未指定はアニメ。ケモノのときだけ、送信時と同じ `fur dataset` をベース先頭に付ける。 */
  mode?: GenerationMode;
  /**
   * 個別ネガティブを持たないキャラに使う共通文面。
   * 未指定のときは共通分を出さない（個別ネガティブがあるキャラだけ出す）。
   */
  characterNegative?: string;
}

export function PromptPreview({
  basePrompt, characterPrompts, syntax, onSyntaxChange, onCopy, negativePrompt, mode = 'anime', characterNegative,
}: Props) {
  const shownBase = mode === 'furry' ? prefixFurryDataset(basePrompt) : basePrompt;
  return (
    <div className="preview">
      <div>
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
                disabled={!shownBase}
                onClick={() => onCopy(shownBase, characterPrompts.length ? 'ベース' : 'プロンプト全体')}
              >
                コピー
              </button>
            </dt>
            <dd>
              <output className={`preview-text${shownBase ? '' : ' is-empty'}`}>
                {shownBase || 'ONのタグがありません'}
              </output>
            </dd>
          </div>
          {characterPrompts.map((c) => {
            const negative = c.negative !== undefined ? c.negative : characterNegative;
            const showNegative = c.negative !== undefined || characterNegative !== undefined;
            return (
              <Fragment key={c.id}>
                <div className="preview-item">
                  <dt>
                    {c.name}
                    <button type="button" className="btn btn-small" onClick={() => onCopy(c.prompt, c.name)}>
                      コピー
                    </button>
                  </dt>
                  <dd>
                    <output className="preview-text">{c.prompt}</output>
                    {c.center && (
                      <p className="hint">位置　横 {c.center.x}、縦 {c.center.y}</p>
                    )}
                  </dd>
                </div>
                {showNegative && (
                  <div className="preview-item preview-negative">
                    <dt>
                      {c.name}のネガティブ
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={!negative}
                        onClick={() => onCopy(negative ?? '', `${c.name}のネガティブ`)}
                      >
                        コピー
                      </button>
                    </dt>
                    <dd>
                      <output className={`preview-text${negative ? '' : ' is-empty'}`}>
                        {negative || 'ネガティブなし'}
                      </output>
                    </dd>
                  </div>
                )}
              </Fragment>
            );
          })}
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
    </div>
  );
}
