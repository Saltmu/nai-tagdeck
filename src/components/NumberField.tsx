import { useEffect, useRef, useState } from 'react';

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

/** 入力途中（空欄や "5." など）を壊さないよう、確定はフォーカスを外したときと Enter で行う。 */
export function NumberField({ id, value, onChange, min, max, step, allowEmpty, placeholder, className }: Props) {
  const show = (v: number | null) => (v === null ? '' : String(v));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '' && allowEmpty) {
      if (value !== null) onChange(null);
      return;
    }
    const n = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(n)) {
      setText(show(value));
      return;
    }
    if (n !== value) onChange(n);
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
