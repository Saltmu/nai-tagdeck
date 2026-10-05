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
  return (
    <div className="quick-generate">
      <div className="size-toggle" role="radiogroup" aria-label="画像サイズ">
        {QUICK_SIZES.map((key) => {
          const preset = SIZE_PRESETS.find((s) => s.key === key)!;
          return (
            <button
              key={key}
              type="button"
              role="radio"
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
