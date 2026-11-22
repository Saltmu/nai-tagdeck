import { type KeyboardEvent, useRef } from 'react';
import { SIZE_PRESETS, type SizeKey } from '../lib/generation';
import { LockIcon, SizeIcon, SparkleIcon } from './icons';

/** ヘッダーに常時出すサイズ。tall / wide は選ばれている間だけ 4 つ目に足す。 */
const QUICK_SIZES: readonly SizeKey[] = ['portrait', 'landscape', 'square'];

function headerSizes(size: SizeKey): SizeKey[] {
  return size === 'tall' || size === 'wide' ? [...QUICK_SIZES, size] : [...QUICK_SIZES];
}

interface Props {
  size: SizeKey;
  /** null ならランダム。固定中だけ解除ボタンを出す。 */
  seed: number | null;
  onSizeChange: (size: SizeKey) => void;
  onClearSeed: () => void;
  generating: boolean;
  /** 生成できない理由。押したときに案内する。 */
  blocker: string | null;
  onGenerate: () => void;
}

/** どのタブからでも、サイズを選んですぐ生成できるようにする。 */
export function QuickGenerate({ size, seed, onSizeChange, onClearSeed, generating, blocker, onGenerate }: Props) {
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const generateRef = useRef<HTMLButtonElement>(null);
  const sizes = headerSizes(size);
  const activeIndex = sizes.indexOf(size);

  const onRadioKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = activeIndex >= 0 ? activeIndex : 0;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % sizes.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + sizes.length) % sizes.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = sizes.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSizeChange(sizes[next]!);
    radioRefs.current[next]?.focus();
  };

  const seedLabel = seed === null ? null : `シード ${seed} を解除してランダムに戻す`;

  return (
    <div className="quick-generate">
      <div className="size-toggle" role="radiogroup" aria-label="画像サイズ" onKeyDown={onRadioKeyDown}>
        {sizes.map((key, i) => {
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
      {seedLabel !== null && (
        <button
          type="button"
          className="btn seed-lock"
          aria-label={seedLabel}
          title={seedLabel}
          onClick={() => {
            generateRef.current?.focus();
            onClearSeed();
          }}
        >
          <LockIcon />
          <span className="seed-lock-extra">
            <span className="seed-lock-value">{seed}</span>
            <span aria-hidden="true">×</span>
          </span>
        </button>
      )}
      <button
        ref={generateRef}
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
