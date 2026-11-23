import { useEffect, useRef, useState } from 'react';

/**
 * 編集対象のタブはスクロールしてもヘッダーの直下に残す。
 * 張り付いている間だけ見た目を変え、スクロール位置の調整（visibleBounds）でも上を隠すものとして扱う。
 */
export function useStickyEditorTabs() {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsStuck, setTabsStuck] = useState(false);
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const header = document.querySelector<HTMLElement>('.app-header');
    const update = () => {
      const top = header ? header.getBoundingClientRect().bottom : 0;
      tabs.style.top = `${top}px`;
      setTabsStuck(tabs.getBoundingClientRect().top <= top + 0.5 && window.scrollY > 0);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    if (header) ro.observe(header, { box: 'border-box' });
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, []);
  return { tabsRef, tabsStuck };
}
