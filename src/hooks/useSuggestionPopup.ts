import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { scrollOptionIntoList, visibleBounds } from '../lib/browser';
import { choosePlacement, type Placement } from '../lib/placement';

const POPUP_MAX = 288;
const POPUP_GAP = 4;

/** 候補の配置・スクロール・外側クリックだけを扱う。検索と入力は呼び出し元に残す。 */
export function useSuggestionPopup(expanded: boolean, suggestions: readonly unknown[], active: number, setOpen: Dispatch<SetStateAction<boolean>>) {
  const areaRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [layout, setLayout] = useState<{ placement: Placement; maxHeight: number }>({
    placement: 'below',
    maxHeight: POPUP_MAX,
  });


  useEffect(() => {
    if (!expanded) return;
    const list = listRef.current;
    const option = list?.children[active];
    if (list && option instanceof HTMLElement) scrollOptionIntoList(list, option);
  }, [active, suggestions, expanded]);
  // 候補を出している間は、入力欄の上下どちらに広く空きがあるかを見て出す向きと高さを決め直す
  useLayoutEffect(() => {
    if (!expanded) return;
    const update = () => {
      const row = rowRef.current;
      const popup = popupRef.current;
      const list = listRef.current;
      if (!row || !popup || !list) return;
      const rect = row.getBoundingClientRect();
      const bounds = visibleBounds();
      // ヘッダー行などリスト以外の高さ ＋ リストを全部出したときの高さ
      const natural = popup.offsetHeight - list.clientHeight + list.scrollHeight;
      const next = choosePlacement({
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
        boundsTop: bounds.top,
        boundsBottom: bounds.bottom,
        desired: Math.min(natural, POPUP_MAX),
        gap: POPUP_GAP,
      });
      setLayout((prev) =>
        prev.placement === next.placement && prev.maxHeight === next.maxHeight ? prev : next,
      );
    };
    update();
    const vv = window.visualViewport;
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [expanded, suggestions]);


  // 候補の外（薄いグレーの覆い）を押したときは候補を閉じるだけにし、下にある要素は反応させない
  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && areaRef.current?.contains(e.target)) return;
      swallowGesture(e);
      setOpen(false);
      // 入力欄からフォーカスを外す（スマホではキーボードも閉じる）
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && areaRef.current?.contains(focused)) focused.blur();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [expanded, setOpen]);

  return { areaRef, rowRef, popupRef, listRef, layout };
}

/**
 * 1回の押下で起きる後続イベント（mousedown によるフォーカス移動、タッチ後の擬似マウスイベント、click）を握りつぶす。
 * タッチでは指を離したときに当たり判定をやり直すので、覆いが消えたあとの入力欄などに届かないよう止める。
 */
function swallowGesture(down: PointerEvent) {
  down.stopPropagation();
  down.preventDefault();
  const swallow = (ev: Event) => {
    ev.stopPropagation();
    if (ev.cancelable) ev.preventDefault();
    if (ev.type === 'click') cleanup();
  };
  const types = ['pointerup', 'mousedown', 'mouseup', 'touchend', 'click'] as const;
  const options = { capture: true, passive: false };
  let timer = 0;
  const cleanup = () => {
    window.clearTimeout(timer);
    for (const type of types) window.removeEventListener(type, swallow, options);
    window.removeEventListener('pointerdown', cleanup, true);
  };
  for (const type of types) window.addEventListener(type, swallow, options);
  // スクロールなどで click が来なかったときは、次の押下か時間切れで元に戻す
  window.addEventListener('pointerdown', cleanup, true);
  timer = window.setTimeout(cleanup, 1000);
}
