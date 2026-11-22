import { useLayoutEffect, useRef, useState } from 'react';

interface Props {
  id?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 空欄を許す（null を返す）。 */
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
}

function show(value: number | null): string {
  return value === null ? '' : String(value);
}

/** 入力途中（空欄や "5." など）を壊さないよう、確定はフォーカスを外したときと Enter で行う。 */
export function NumberField({ id, value, onChange, min, max, step, allowEmpty, placeholder, className }: Props) {
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  // 親が範囲外の値を同じ数値へ丸めると value は変わらない。確定のあとに表示を戻すため、描画を一度起こす。
  const syncOnCommit = useRef(false);
  const [commitTick, setCommitTick] = useState(0);

  useLayoutEffect(() => {
    if (focused.current && !syncOnCommit.current) return;
    syncOnCommit.current = false;
    setText(show(value));
  }, [value, commitTick]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '' && allowEmpty) {
      if (value !== null) onChange(null);
    } else {
      const n = Number(trimmed);
      if (trimmed !== '' && Number.isFinite(n) && n !== value) onChange(n);
    }
    syncOnCommit.current = true;
    setCommitTick((tick) => tick + 1);
  };

  return (
    <input
      id={id}
      type="number"
      inputMode={step !== undefined && step < 1 ? 'decimal' : 'numeric'}
      className={className}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}
