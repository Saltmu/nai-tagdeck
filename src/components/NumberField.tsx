import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
  ariaLabel?: string;
  autoFocus?: boolean;
  /** 確定（blur / Enter）またはキャンセル（Escape）でインライン編集を終えるときのコールバック。 */
  onDone?: () => void;
}

function show(value: number | null): string {
  return value === null ? '' : String(value);
}

/** 入力途中（空欄や "5." など）を壊さないよう、確定はフォーカスを外したときと Enter で行う。 */
export function NumberField({
  id,
  value,
  onChange,
  min,
  max,
  step,
  allowEmpty,
  placeholder,
  className,
  ariaLabel,
  autoFocus,
  onDone,
}: Props) {
  const [text, setText] = useState(show(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  const escaped = useRef(false);
  // 親が範囲外の値を同じ数値へ丸めると value は変わらない。確定のあとに表示を戻すため、描画を一度起こす。
  const syncOnCommit = useRef(false);
  const [commitTick, setCommitTick] = useState(0);

  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [autoFocus]);

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
      ref={inputRef}
      id={id}
      type="number"
      inputMode={step !== undefined && step < 1 ? 'decimal' : 'numeric'}
      className={className}
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        focused.current = true;
        escaped.current = false;
      }}
      onBlur={() => {
        focused.current = false;
        if (escaped.current) {
          escaped.current = false;
          onDone?.();
          return;
        }
        commit();
        onDone?.();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          onDone?.();
        } else if (e.key === 'Escape') {
          escaped.current = true;
          setText(show(value));
          onDone?.();
        }
      }}
    />
  );
}
