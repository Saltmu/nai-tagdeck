import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * 画面（タブ）ごとのスクロール位置を覚え、切り替え時に戻す。
 * 生成画像の確認とタグ編集を行き来しても、毎回スワイプし直す必要がないようにする。未訪問の画面は先頭から開く。
 */
export function useWindowScrollMemory<K extends string>(activeKey: K): void {
  const scrollPositionsRef = useRef<Partial<Record<K, number>>>({});
  const prevKeyRef = useRef<K>(activeKey);
  useEffect(() => {
    const onScroll = () => {
      scrollPositionsRef.current[activeKey] = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [activeKey]);
  useLayoutEffect(() => {
    if (prevKeyRef.current === activeKey) return;
    prevKeyRef.current = activeKey;
    window.scrollTo(0, scrollPositionsRef.current[activeKey] ?? 0);
  }, [activeKey]);
}
