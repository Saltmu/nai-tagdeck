import { useState } from 'react';

/** パネルの開閉状態を変更直後に保存する。未保存の場合は開いて表示する。 */
export function usePanelOpen(panel: string): [boolean, () => void] {
  const key = `nai-tagdeck:panel-open:${panel}`;
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(key) !== 'false';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // 保存できない場合も画面上の開閉は可能にする。
    }
    setOpen(next);
  };
  return [open, toggle];
}
