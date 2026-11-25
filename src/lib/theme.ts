import type { ThemePreference } from '../types';

/** ペイント前の初期化スクリプト（public/theme-init.js）と共有する localStorage ミラー。 */
export const THEME_CACHE_KEY = 'nai-tagdeck:theme';

export const THEME_COLOR_LIGHT = '#4f46e5';
export const THEME_COLOR_DARK = '#1b1e26';

/** 現在の OS テーマがダークかどうか。matchMedia が使えない環境では false（ライト扱い）。 */
export function isSystemDark(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  } catch {
    return false;
  }
}

/** localStorage ミラーから保存済みテーマを読む。'light' / 'dark' 以外は null。 */
export function readThemeCache(): 'light' | 'dark' | null {
  try {
    const value = window.localStorage.getItem(THEME_CACHE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/**
 * 選択を localStorage ミラーへ書く。'system' のときはキーを消し、
 * theme-init.js が何も設定しない（OS 追従の）状態に戻す。
 */
export function writeThemeCache(theme: ThemePreference): void {
  try {
    if (theme === 'light' || theme === 'dark') window.localStorage.setItem(THEME_CACHE_KEY, theme);
    else window.localStorage.removeItem(THEME_CACHE_KEY);
  } catch {
    // プライベートモードなどで localStorage が使えなくてもテーマ切替自体は動かす。
  }
}

function themeColorFor(theme: ThemePreference): string {
  if (theme === 'light') return THEME_COLOR_LIGHT;
  if (theme === 'dark') return THEME_COLOR_DARK;
  return isSystemDark() ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}

/** <meta name="color-scheme"> と <meta name="theme-color"> を選択に合わせて更新する。 */
export function updateThemeMeta(theme: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const colorScheme = document.querySelector('meta[name="color-scheme"]');
  if (colorScheme) {
    colorScheme.setAttribute(
      'content',
      theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : 'light dark',
    );
  }
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', themeColorFor(theme));
}

let systemUnsubscribe: (() => void) | null = null;

/**
 * OS テーマの変化を購読し、変わるたびに onChange を呼ぶ。
 * matchMedia が使えない環境では何もせず、即座に呼べる解除関数を返す。
 */
export function subscribeSystemThemeChange(onChange: (isDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler);
  else if (typeof mq.addListener === 'function') mq.addListener(handler);
  return () => {
    if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', handler);
    else if (typeof mq.removeListener === 'function') mq.removeListener(handler);
  };
}

/**
 * テーマを DOM（data-theme 属性）と <meta>、localStorage ミラーへ反映する。
 * 'system' の間は OS テーマの変化を購読して theme-color を追従させ、
 * 'light' / 'dark' の間は購読を外す。返値は購読の解除関数。
 */
export function applyTheme(theme: ThemePreference): () => void {
  if (typeof document !== 'undefined') {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else document.documentElement.removeAttribute('data-theme');
  }
  writeThemeCache(theme);
  updateThemeMeta(theme);
  if (systemUnsubscribe) {
    systemUnsubscribe();
    systemUnsubscribe = null;
  }
  if (theme === 'system') {
    systemUnsubscribe = subscribeSystemThemeChange(() => updateThemeMeta('system'));
  }
  return () => {
    if (systemUnsubscribe) {
      systemUnsubscribe();
      systemUnsubscribe = null;
    }
  };
}
