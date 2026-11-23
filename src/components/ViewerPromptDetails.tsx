import { Fragment, useEffect, useRef, useState } from 'react';
import type { GeneratedCharacterDetail, GeneratedImage } from '../hooks/useImages';
import { copyText } from '../lib/browser';
import { PROMPT_TOKEN_ESTIMATE_NOTE } from '../lib/prompt';
import { CheckIcon } from './icons';
import { PromptMetrics, PromptMetricsWarning } from './PromptPreview';

const COPY_MS = 1500;

interface PromptCopyProps {
  title: string;
  text: string;
  emptyText: string;
  copyKey: string;
  copyLabel: string;
  copiedKey: string | null;
  failedKey: string | null;
  negative?: boolean;
  /** 公式の 1471 はベースプロンプトの上限。ベースの行だけ警告する。 */
  warnOnLimit?: boolean;
  hint?: string;
  onCopy: (key: string, text: string, label: string) => void;
}

function PromptCopy({ title, text, emptyText, copyKey, copyLabel, copiedKey, failedKey, negative, warnOnLimit = false, hint, onCopy }: PromptCopyProps) {
  const copied = copiedKey === copyKey;
  const failed = failedKey === copyKey;
  const ariaLabel = copied
    ? `${copyLabel}をコピー済み`
    : failed
      ? `${copyLabel}をコピーできませんでした`
      : `${copyLabel}をコピー`;
  return (
    <div className={`preview-item${negative ? ' preview-negative' : ''}`}>
      <dt>
        {title}
        <PromptMetrics text={text} warn={warnOnLimit} />
        <button
          type="button"
          className={`btn btn-small${failed ? ' btn-danger' : ''}`}
          disabled={!text}
          aria-label={ariaLabel}
          onClick={() => onCopy(copyKey, text, copyLabel)}
        >
          {copied ? (<><CheckIcon />コピー済み</>) : failed ? 'コピーできませんでした' : 'コピー'}
        </button>
      </dt>
      <dd>
        <output className={`preview-text${text ? '' : ' is-empty'}`}>{text || emptyText}</output>
        {hint && <p className="hint">{hint}</p>}
        <PromptMetricsWarning text={text} warn={warnOnLimit} />
      </dd>
    </div>
  );
}

function characterRows(image: GeneratedImage): Array<GeneratedCharacterDetail & { title: string; showNegative: boolean }> {
  if (image.characterDetails) {
    return image.characterDetails.map((c, i) => ({ ...c, title: `キャラ${i + 1}`, showNegative: true }));
  }
  return image.characterPrompts.map((prompt, i) => ({
    prompt,
    negative: '',
    title: `キャラ${i + 1}`,
    showNegative: false,
  }));
}

interface Props {
  image: GeneratedImage;
  /** `<dialog>` 内のコピーフォールバック先。無いときは document.body。 */
  getCopyContainer: () => HTMLElement | null;
}

/** 拡大表示のプロンプト詳細と、行ごとのコピー状態。 */
export function ViewerPromptDetails({ image, getCopyContainer }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const imageIdRef = useRef(image.id);
  imageIdRef.current = image.id;

  useEffect(() => {
    setCopiedKey(null);
    setFailedKey(null);
    setCopyStatus('');
  }, [image]);
  useEffect(() => {
    if (!copiedKey) return;
    const t = setTimeout(() => setCopiedKey(null), COPY_MS);
    return () => clearTimeout(t);
  }, [copiedKey]);
  useEffect(() => {
    if (!failedKey) return;
    const t = setTimeout(() => setFailedKey(null), COPY_MS);
    return () => clearTimeout(t);
  }, [failedKey]);

  const copyPrompt = async (key: string, text: string, label: string) => {
    const sourceId = image.id;
    let ok = false;
    try {
      ok = await copyText(text, getCopyContainer() ?? document.body);
    } catch {
      ok = false;
    }
    if (imageIdRef.current !== sourceId) return;
    setCopyStatus(ok ? `${label}をコピーしました` : 'コピーできませんでした');
    setCopiedKey(ok ? key : null);
    setFailedKey(ok ? null : key);
  };
  const rows = characterRows(image);
  const baseLabel = rows.length > 0 ? 'ベース' : 'プロンプト全体';

  return (
    <>
      <details className="viewer-prompt">
        <summary>プロンプト</summary>
        <dl className="preview-list">
          <PromptCopy
            title="ベース"
            text={image.prompt}
            emptyText="ONのタグがありません"
            copyKey="base"
            copyLabel={baseLabel}
            copiedKey={copiedKey}
            failedKey={failedKey}
            warnOnLimit
            onCopy={copyPrompt}
          />
          {rows.map((c, i) => (
            <Fragment key={i}>
              <PromptCopy
                title={c.title}
                text={c.prompt}
                emptyText="プロンプトなし"
                copyKey={`char-${i}`}
                copyLabel={c.title}
                copiedKey={copiedKey}
                failedKey={failedKey}
                hint={c.center ? `位置　横 ${c.center.x}、縦 ${c.center.y}` : undefined}
                onCopy={copyPrompt}
              />
              {c.showNegative && (
                <PromptCopy
                  title={`${c.title}のネガティブ`}
                  text={c.negative}
                  emptyText="ネガティブなし"
                  copyKey={`char-neg-${i}`}
                  copyLabel={`${c.title}のネガティブ`}
                  copiedKey={copiedKey}
                  failedKey={failedKey}
                  negative
                  onCopy={copyPrompt}
                />
              )}
            </Fragment>
          ))}
          {image.negativePrompt !== undefined && (
            <PromptCopy
              title="ネガティブ"
              text={image.negativePrompt}
              emptyText="ネガティブなし"
              copyKey="negative"
              copyLabel="ネガティブ"
              copiedKey={copiedKey}
              failedKey={failedKey}
              negative
              onCopy={copyPrompt}
            />
          )}
        </dl>
        <p className="hint">{PROMPT_TOKEN_ESTIMATE_NOTE}</p>
      </details>
      <p className="viewer-copy-status visually-hidden" role="status" aria-live="polite">{copyStatus}</p>
    </>
  );
}
