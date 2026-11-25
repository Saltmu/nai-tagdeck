import { useRef } from 'react';
import { LockIcon } from './icons';

interface Props {
  /** null ならランダム。固定中だけ解除ボタンを出す。 */
  seed: number | null;
  onClearSeed: () => void;
}

/** 固定中のシードを表示し、解除する。生成ボタンやサイズ選択はドックに一本化したため持たない。 */
export function SeedLock({ seed, onClearSeed }: Props) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  // 外枠は常に残す。解除でボタンが消えるとき、フォーカスを外枠に移してフォーカスを失わないようにする
  const seedLabel = seed === null ? '' : `シード ${seed} を解除してランダムに戻す`;
  return (
    <span ref={wrapRef} className="seed-lock-wrap" tabIndex={-1}>
      {seed === null ? null : (
        <button
          type="button"
          className="btn seed-lock"
          aria-label={seedLabel}
          title={seedLabel}
          onClick={() => {
            wrapRef.current?.focus();
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
    </span>
  );
}
