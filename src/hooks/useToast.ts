import { useCallback, useEffect, useRef, useState } from 'react';

export function useToast(defaultMs = 1800): {
  message: string | null;
  show: (message: string, durationMs?: number) => void;
} {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback(
    (next: string, durationMs = defaultMs) => {
      clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => setMessage(null), durationMs);
    },
    [defaultMs],
  );

  useEffect(() => () => clearTimeout(timer.current), []);
  return { message, show };
}
