import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const isShown = (el: Element | null) => !!el && el.getClientRects().length > 0;

/**
 * ページ（window）のスクロール位置を key ごとに覚え、key が変わったときや
 * 画面が再び表示されたとき（shown が true に戻ったとき）に元の位置へ戻す。
 * anchor が表示されていない間（別の画面を開いている間）のスクロールは記録しない。
 */
export function useScrollMemory(key: string, shown: boolean, anchor: RefObject<Element | null>) {
  const positions = useRef(new Map<string, number>());
  const current = useRef({ key, shown });

  // 切り替える直前の位置を、画面が書き換わる前（描画中）に控える。スクロールイベントは間引かれることがある
  if (current.current.key !== key || current.current.shown !== shown) {
    if (isShown(anchor.current)) positions.current.set(current.current.key, window.scrollY);
    current.current = { key, shown };
  }

  useEffect(() => {
    const record = () => {
      if (isShown(anchor.current)) positions.current.set(current.current.key, window.scrollY);
    };
    window.addEventListener('scroll', record, { passive: true });
    return () => window.removeEventListener('scroll', record);
  }, [anchor]);

  // 描画前に戻し、切り替え直後の高さの変化で起きるスクロールを新しい位置として記録させる
  useLayoutEffect(() => {
    if (!shown || !isShown(anchor.current)) return;
    const saved = positions.current.get(key);
    if (saved !== undefined && saved !== window.scrollY) window.scrollTo(0, saved);
  }, [key, shown, anchor]);
}
