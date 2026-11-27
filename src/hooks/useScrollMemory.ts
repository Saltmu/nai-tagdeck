import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { getMainScrollContainer, getScrollTop, setScrollTop } from '../lib/browser';

const isShown = (el: Element | null) => !!el && el.getClientRects().length > 0;

/**
 * メインスクロール領域（狭い画面では `.app-main`、広い画面では `window`）のスクロール位置を key ごとに覚え、
 * key が変わったときや画面が再び表示されたとき（shown が true に戻ったとき）に元の位置へ戻す。
 * anchor が表示されていない間（別の画面を開いている間）のスクロールは記録しない。
 */
export function useScrollMemory(key: string, shown: boolean, anchor: RefObject<Element | null>) {
  const positions = useRef(new Map<string, number>());
  const activeKey = useRef(key);

  useEffect(() => {
    const main = document.querySelector<HTMLElement>('.app-main');
    const record = () => {
      if (isShown(anchor.current)) {
        positions.current.set(activeKey.current, getScrollTop(getMainScrollContainer()));
      }
    };
    window.addEventListener('scroll', record, { passive: true });
    main?.addEventListener('scroll', record, { passive: true });
    return () => {
      window.removeEventListener('scroll', record);
      main?.removeEventListener('scroll', record);
    };
  }, [anchor]);

  // 描画前に復元し、未記録のキーは現在位置を初期値として覚える
  useLayoutEffect(() => {
    activeKey.current = key;
    if (!shown || !isShown(anchor.current)) return;
    const container = getMainScrollContainer();
    const current = getScrollTop(container);
    const saved = positions.current.get(key);
    if (saved === undefined) {
      positions.current.set(key, current);
    } else if (saved !== current) {
      setScrollTop(container, saved);
    }
  }, [key, shown, anchor]);
}
