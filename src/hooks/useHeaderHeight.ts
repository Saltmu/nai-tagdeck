import { useLayoutEffect, type RefObject } from 'react';

/**
 * 固定ヘッダーの高さに合わせて `--header-height` を更新し、`.app` の上余白を揃える。
 * （Android Firefox での sticky ちらつき回避のため fixed 化）
 */
export function useHeaderHeight(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      const height = el.getBoundingClientRect().height;
      if (height > 0) document.documentElement.style.setProperty('--header-height', `${height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el, { box: 'border-box' });
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--header-height');
    };
  }, [ref]);
}
