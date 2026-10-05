import { useEffect, useRef, useState } from 'react';
import {
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  clampWeight,
  formatWeight,
  isNeutralWeight,
} from '../lib/prompt';

interface Props {
  value: number;
  label: string;
  onChange: (weight: number) => void;
  id?: string;
}

/** 入力途中（"1." など）を壊さないよう、フォーカス中は外からの値で上書きしない。 */
export function WeightInput({ value, label, onChange, id }: Props) {
  const [text, setText] = useState(formatWeight(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(formatWeight(value));
  }, [value]);

  const commit = () => {
    const n = Number(text);
    const next = text.trim() !== '' && Number.isFinite(n) ? clampWeight(n) : value;
    setText(formatWeight(next));
    if (next !== value) onChange(next);
  };

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      className={`weight${value <= 0 ? ' is-negative' : isNeutralWeight(value) ? '' : ' is-weighted'}`}
      min={WEIGHT_MIN}
      max={WEIGHT_MAX}
      step={WEIGHT_STEP}
      value={text}
      aria-label={label}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.valueAsNumber;
        if (Number.isFinite(n) && n >= WEIGHT_MIN && n <= WEIGHT_MAX) onChange(clampWeight(n));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}
