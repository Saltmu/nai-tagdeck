export async function copyText(text: string, parent: ParentNode = document.body): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 権限がない環境向けの予備手段。dialog の中で呼ぶときは、その dialog を渡す。
    // 背面は inert になり、body に足した textarea は選択できない。
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'visually-hidden';
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      parent.appendChild(ta);
      ta.select();
      return typeof document.execCommand === 'function' && document.execCommand('copy');
    } catch {
      return false;
    } finally {
      ta.remove();
      if (previous?.isConnected) previous.focus();
    }
  }
}

export function downloadUrl(filename: string, url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  downloadUrl(filename, url);
  // すぐに revoke すると一部のブラウザで保存が失敗するため少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(filename: string, text: string, type: string): void {
  downloadBlob(filename, new Blob([text], { type }));
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dateStamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export function timeStamp(d = new Date()): string {
  return `${dateStamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 画面上で実際に見えている縦の範囲（ビューポート座標）。
 * スマホのキーボードで狭くなった分（visualViewport）と、
 * data-occludes を付けた固定ヘッダー・固定タブバーに隠れる分を除く。
 */
export function visibleBounds(): { top: number; bottom: number } {
  const vv = window.visualViewport;
  let top = vv ? vv.offsetTop : 0;
  let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const middle = (top + bottom) / 2;
  for (const el of document.querySelectorAll('[data-occludes]')) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue;
    // 画面の上半分にあるものは上から、下半分にあるものは下から隠しているとみなす
    if (rect.bottom <= middle) top = Math.max(top, rect.bottom);
    else if (rect.top >= middle) bottom = Math.min(bottom, rect.top);
  }
  return { top, bottom };
}

/**
 * option がリスト内で見えるように、リスト自身だけをスクロールする。
 * scrollIntoView はページ側までスクロールするため、スマホでキーボード表示中に
 * 固定ヘッダーやタブが画面外へ押し出されてしまう。
 */
export function scrollOptionIntoList(list: HTMLElement, option: HTMLElement): void {
  const listRect = list.getBoundingClientRect();
  const optRect = option.getBoundingClientRect();
  const top = optRect.top - listRect.top - list.clientTop;
  const bottom = top + optRect.height;
  if (top < 0) list.scrollTop += top;
  else if (bottom > list.clientHeight) list.scrollTop += bottom - list.clientHeight;
}

/**
 * IME 変換中のキーイベントかを判定する。
 * Safari 等の互換性のため `nativeEvent.isComposing` と `keyCode === 229` の両方を見る。
 */
export function isImeComposing(
  event: { isComposing?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean } },
): boolean {
  return Boolean(event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229);
}

const MAIN_SCROLL_SELECTOR = '.app-main';

/**
 * アプリのメインスクロール対象を返す。
 * 狭い画面（アプリシェル構成）では `.app-main` が内部スクロールし、
 * 広い画面では従来どおり `window` がスクロールする。
 */
export function getMainScrollContainer(): HTMLElement | Window {
  const main = document.querySelector<HTMLElement>(MAIN_SCROLL_SELECTOR);
  if (main) {
    const overflowY = window.getComputedStyle(main).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return main;
    }
  }
  return window;
}

export function isWindowTarget(target: HTMLElement | Window): target is Window {
  return target === window;
}

export function getScrollTop(target: HTMLElement | Window): number {
  return isWindowTarget(target) ? target.scrollY : target.scrollTop;
}

export function setScrollTop(target: HTMLElement | Window, top: number): void {
  if (isWindowTarget(target)) {
    target.scrollTo(0, top);
  } else {
    target.scrollTop = top;
  }
}

/** 独自のピンチズームを実装している領域（Pointer Events で扱うため touchmove は止めない）。 */
const PINCH_ALLOWED_SELECTOR = '.viewer-stage, .inpaint-stage';

/**
 * 画像表示画面以外でのブラウザ標準ピンチズームを抑止する。
 * iOS Safari は viewport の user-scalable=no や touch-action だけでは 2 本指ピンチを
 * 止めきれないため、gesturestart / gesturechange と 2 本指 touchmove を補助的に止める。
 */
export function installPinchZoomLock(doc: Document = document): () => void {
  const onGesture = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length < 2) return;
    if (e.target instanceof Element && e.target.closest(PINCH_ALLOWED_SELECTOR)) return;
    if (e.cancelable) e.preventDefault();
  };
  const options: AddEventListenerOptions = { passive: false };
  doc.addEventListener('gesturestart', onGesture, options);
  doc.addEventListener('gesturechange', onGesture, options);
  doc.addEventListener('touchmove', onTouchMove, options);
  return () => {
    doc.removeEventListener('gesturestart', onGesture, options);
    doc.removeEventListener('gesturechange', onGesture, options);
    doc.removeEventListener('touchmove', onTouchMove, options);
  };
}
