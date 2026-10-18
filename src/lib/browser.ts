export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 権限がない環境向けの予備手段
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'visually-hidden';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
