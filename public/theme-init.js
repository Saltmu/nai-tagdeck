// ペイント前に外観テーマを反映する初期化スクリプト。
// CSP は script-src 'self'（インライン不可）のため、外部スクリプトとして head で同期読み込みする。
// localStorage の 'nai-tagdeck:theme' が 'light' / 'dark' のときだけ data-theme と meta を設定し、
// 'system'（キーなし）のときは何もしない（OS 設定に追従する）。
(() => {
  let stored;
  let colorScheme;
  let themeColor;
  try {
    stored = window.localStorage.getItem('nai-tagdeck:theme');
    if (stored !== 'light' && stored !== 'dark') return;
    document.documentElement.setAttribute('data-theme', stored);
    colorScheme = document.querySelector('meta[name="color-scheme"]');
    if (colorScheme) colorScheme.setAttribute('content', stored);
    themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', stored === 'dark' ? '#1b1e26' : '#4f46e5');
  } catch {
    // localStorage が使えない環境では OS 追従のままにする。
  }
})();
