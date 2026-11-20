import { type KeyboardEvent, useRef } from 'react';
import { SIZE_PRESETS, type SizeKey } from '../lib/generation';
import { SizeIcon, SparkleIcon } from './icons';

/** ヘッダーに出す標準サイズ（その他のサイズは生成パネルで選ぶ）。 */
const QUICK_SIZES: readonly SizeKey[] = ['portrait', 'landscape', 'square'];

interface Props {
  size: SizeKey;
  onSizeChange: (size: SizeKey) => void;
  generating: boolean;
  /** 生成できない理由。押したときに案内する。 */
  blocker: string | null;
  onGenerate: () => void;
}

/** どのタブからでも、サイズを選んですぐ生成できるようにする。 */
export function QuickGenerate({ size, onSizeChange, generating, blocker, onGenerate }: Props) {
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = QUICK_SIZES.indexOf(size);

  const onRadioKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = activeIndex >= 0 ? activeIndex : 0;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % QUICK_SIZES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + QUICK_SIZES.length) % QUICK_SIZES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = QUICK_SIZES.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSizeChange(QUICK_SIZES[next]!);
    radioRefs.current[next]?.focus();
  };

  return (
    <div className="quick-generate">
      <div className="size-toggle" role="radiogroup" aria-label="画像サイズ" onKeyDown={onRadioKeyDown}>
        {QUICK_SIZES.map((key, i) => {
          const preset = SIZE_PRESETS.find((s) => s.key === key)!;
          const isTabbable = activeIndex >= 0 ? i === activeIndex : i === 0;
          return (
            <button
              key={key}
              ref={(el) => { radioRefs.current[i] = el; }}
              type="button"
              role="radio"
              tabIndex={isTabbable ? 0 : -1}
              aria-checked={size === key}
              aria-label={preset.label}
              title={preset.label}
              className="size-btn"
              onClick={() => onSizeChange(key)}
            >
              <SizeIcon width={preset.width} height={preset.height} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={`btn btn-primary generate-btn${blocker ? ' is-blocked' : ''}`}
        aria-busy={generating}
        aria-label={generating ? '生成中' : '生成する（Ctrl+Enter）'}
        title={blocker ?? '生成する（Ctrl+Enter）'}
        onClick={onGenerate}
      >
        {generating ? <span className="spinner spinner-small spinner-on-accent" aria-hidden="true" /> : <SparkleIcon />}
        <span className="generate-label">生成</span>
      </button>
    </div>
  );
}
