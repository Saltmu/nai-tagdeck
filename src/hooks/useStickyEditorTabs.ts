import { useEffect, useRef, useState } from 'react';
import { getMainScrollContainer, isWindowTarget } from '../lib/browser';

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
    const main = document.querySelector<HTMLElement>('.app-main');
    const update = () => {
      const container = getMainScrollContainer();
      if (!isWindowTarget(container)) {
        tabs.style.top = '0px';
        const containerTop = container.getBoundingClientRect().top;
        setTabsStuck(tabs.getBoundingClientRect().top <= containerTop + 0.5 && container.scrollTop > 0);
      } else {
        const top = header ? header.getBoundingClientRect().bottom : 0;
        tabs.style.top = `${top}px`;
        setTabsStuck(tabs.getBoundingClientRect().top <= top + 0.5 && window.scrollY > 0);
      }
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    main?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    if (header) ro.observe(header, { box: 'border-box' });
    if (main) ro.observe(main, { box: 'border-box' });
    return () => {
      window.removeEventListener('scroll', update);
      main?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, []);
  return { tabsRef, tabsStuck };
}
