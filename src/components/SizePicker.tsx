import { type KeyboardEvent, useRef } from 'react';
import { SIZE_PRESETS, type SizeKey } from '../lib/generation';
import { SizeIcon } from './icons';

/**
 * サイズのピクトグラム（ラジオグループ）。生成ボタンの横に置き、ドロップダウンを開かずに選べるようにする。
 * 5 つの標準サイズは常に表示し、カスタムも実効寸法のピクトグラムで常に表示する。
 * ドロップダウンをなくしたため、カスタムへの入口もこのピクトグラムが担う。
 */
const PICKER_SIZES: readonly SizeKey[] = ['portrait', 'landscape', 'square', 'tall', 'wide', 'custom'];

interface Props {
  size: SizeKey;
  /** 現在の実効寸法。カスタムのピクトグラム表示と、カスタム選択時の初期寸法に使う。 */
  customSize: { width: number; height: number };
  onSizeChange: (size: SizeKey) => void;
}

export function SizePicker({ size, customSize, onSizeChange }: Props) {
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = PICKER_SIZES.indexOf(size);

  const onRadioKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(activeIndex, 0);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % PICKER_SIZES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + PICKER_SIZES.length) % PICKER_SIZES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = PICKER_SIZES.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSizeChange(PICKER_SIZES[next]!);
    radioRefs.current[next]?.focus();
  };

  return (
    <div className="size-toggle" role="radiogroup" aria-label="画像サイズ" onKeyDown={onRadioKeyDown}>
      {PICKER_SIZES.map((key, i) => {
        const preset = SIZE_PRESETS.find((s) => s.key === key);
        const dims = preset ?? customSize;
        const label = preset?.label ?? `カスタム ${dims.width}×${dims.height}`;
        const isTabbable = activeIndex >= 0 ? i === activeIndex : i === 0;
        return (
          <button
            key={key}
            ref={(el) => {
              radioRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            tabIndex={isTabbable ? 0 : -1}
            aria-checked={size === key}
            aria-label={label}
            title={label}
            className="size-btn"
            onClick={() => onSizeChange(key)}
          >
            <SizeIcon width={dims.width} height={dims.height} />
          </button>
        );
      })}
    </div>
  );
}
