import { useImperativeHandle, type Ref } from 'react';
import { useToast } from '../hooks/useToast';

export interface ToastHandle {
  show: (message: string, durationMs?: number) => void;
}

/** トースト表示の状態を閉じ込め、表示・消去のたびにアプリ全体が再描画されないようにする。 */
export function Toast({ ref, defaultMs }: { ref: Ref<ToastHandle>; defaultMs?: number }) {
  const { message, show } = useToast(defaultMs);
  useImperativeHandle(ref, () => ({ show }), [show]);
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
