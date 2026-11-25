import { type KeyboardEvent, useRef } from 'react';
import { SIZE_PRESETS, sizeLabel, type SizeKey } from '../lib/generation';
import { SizeIcon } from './icons';

/**
 * サイズのピクトグラム（ラジオグループ）。生成ボタンの横に置き、ドロップダウンを開かずに選べるようにする。
 * 元の 3 つ（縦・横・正方形）だけを常時表示し、現在が縦長・横長・カスタムのときだけ、
 * 選択中のものを 4 つ目として表示する（従来の QuickGenerate と同じ形）。
 * 縦長・横長・カスタムへの入口は生成パネルのサイズ選択が担う。
 */
const BASE_SIZES: readonly SizeKey[] = ['portrait', 'landscape', 'square'];

interface Props {
  size: SizeKey;
  /** 現在の実効寸法。カスタムのピクトグラム表示と、カスタム選択時の初期寸法に使う。 */
  customSize: { width: number; height: number };
  onSizeChange: (size: SizeKey) => void;
}

export function SizePicker({ size, customSize, onSizeChange }: Props) {
  const extra = BASE_SIZES.includes(size) ? [] : [size];
  const pickerSizes: readonly SizeKey[] = [...BASE_SIZES, ...extra];
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = pickerSizes.indexOf(size);

  const onRadioKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(activeIndex, 0);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % pickerSizes.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + pickerSizes.length) % pickerSizes.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = pickerSizes.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSizeChange(pickerSizes[next]!);
    radioRefs.current[next]?.focus();
  };

  return (
    <div className="size-toggle" role="radiogroup" aria-label="画像サイズ" onKeyDown={onRadioKeyDown}>
      {pickerSizes.map((key, i) => {
        const preset = SIZE_PRESETS.find((s) => s.key === key);
        const dims = preset ?? customSize;
        const label = preset?.label ?? sizeLabel({ size: key, customWidth: dims.width, customHeight: dims.height });
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
