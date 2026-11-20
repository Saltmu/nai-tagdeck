import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const isShown = (el: Element | null) => !!el && el.getClientRects().length > 0;

/**
 * ページ（window）のスクロール位置を key ごとに覚え、key が変わったときや
 * 画面が再び表示されたとき（shown が true に戻ったとき）に元の位置へ戻す。
 * anchor が表示されていない間（別の画面を開いている間）のスクロールは記録しない。
 */
export function useScrollMemory(key: string, shown: boolean, anchor: RefObject<Element | null>) {
  const positions = useRef(new Map<string, number>());
  const activeKey = useRef(key);

  useEffect(() => {
    const record = () => {
      if (isShown(anchor.current)) positions.current.set(activeKey.current, window.scrollY);
    };
    window.addEventListener('scroll', record, { passive: true });
    return () => window.removeEventListener('scroll', record);
  }, [anchor]);

  // 描画前に復元し、未記録のキーは現在位置を初期値として覚える
  useLayoutEffect(() => {
    activeKey.current = key;
    if (!shown || !isShown(anchor.current)) return;
    const saved = positions.current.get(key);
    if (saved === undefined) {
      positions.current.set(key, window.scrollY);
    } else if (saved !== window.scrollY) {
      window.scrollTo(0, saved);
    }
  }, [key, shown, anchor]);
}
