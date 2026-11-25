// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, isDefaultSettings, normalizeSettings } from '../src/lib/settings';
import {
  THEME_CACHE_KEY,
  applyTheme,
  isSystemDark,
  readThemeCache,
  subscribeSystemThemeChange,
  updateThemeMeta,
} from '../src/lib/theme';
import { resetAppData } from '../src/lib/reset';
import { BrandIcon, BrandWordmark } from '../src/components/icons';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: (type: string, listener: (event: { matches: boolean }) => void) => void;
  removeEventListener: (type: string, listener: (event: { matches: boolean }) => void) => void;
  addListener: (listener: (event: { matches: boolean }) => void) => void;
  removeListener: (listener: (event: { matches: boolean }) => void) => void;
  dispatch: (matches: boolean) => void;
}

function makeFakeMql(matches: boolean): FakeMediaQueryList {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const mql: FakeMediaQueryList = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    dispatch: (next) => {
      mql.matches = next;
      for (const listener of [...listeners]) listener({ matches: next });
    },
  };
  return mql;
}

describe('テーマ設定の正規化と既定値', () => {
  it('既定はシステム連動', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(isDefaultSettings(DEFAULT_SETTINGS)).toBe(true);
  });

  it('theme を持たない旧データ・旧バックアップは system へフォールバックする', () => {
    expect(normalizeSettings({}).theme).toBe('system');
    expect(normalizeSettings({ weightSyntax: 'brace' }).theme).toBe('system');
    expect(normalizeSettings(undefined).theme).toBe('system');
    expect(normalizeSettings(null).theme).toBe('system');
  });

  it('light / dark はそのまま残し、不正値は system にする', () => {
    expect(normalizeSettings({ theme: 'light' }).theme).toBe('light');
    expect(normalizeSettings({ theme: 'dark' }).theme).toBe('dark');
    expect(normalizeSettings({ theme: 'sepia' }).theme).toBe('system');
    expect(normalizeSettings({ theme: '' }).theme).toBe('system');
  });

  it('theme が既定と違う設定は既定ではない', () => {
    expect(isDefaultSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })).toBe(false);
    expect(isDefaultSettings({ ...DEFAULT_SETTINGS, theme: 'light' })).toBe(false);
  });
});

describe('テーマの DOM / meta 反映', () => {
  let mql: FakeMediaQueryList;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="color-scheme" content="light dark" /><meta name="theme-color" content="#4f46e5" />';
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    mql = makeFakeMql(false);
    originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { value: () => mql, configurable: true });
  });

  afterEach(() => {
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', { value: originalMatchMedia, configurable: true });
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const colorScheme = () => document.querySelector('meta[name="color-scheme"]')?.getAttribute('content');
  const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

  it('dark を選ぶと data-theme・meta・ミラーがダークになる', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(colorScheme()).toBe('dark');
    expect(themeColor()).toBe('#1b1e26');
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('dark');
    expect(readThemeCache()).toBe('dark');
  });

  it('light を選ぶと data-theme・meta・ミラーがライトになる', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(colorScheme()).toBe('light');
    expect(themeColor()).toBe('#4f46e5');
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('light');
  });

  it('system を選ぶと data-theme とミラーが消え、meta は OS に追従する', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBeNull();
    expect(readThemeCache()).toBeNull();
    expect(colorScheme()).toBe('light dark');
    expect(themeColor()).toBe('#4f46e5');
  });

  it('system の間は OS テーマの変化で theme-color が追従する', () => {
    applyTheme('system');
    expect(themeColor()).toBe('#4f46e5');
    mql.dispatch(true);
    expect(themeColor()).toBe('#1b1e26');
    mql.dispatch(false);
    expect(themeColor()).toBe('#4f46e5');
  });

  it('light / dark の間は OS テーマの変化で theme-color が変わらない', () => {
    applyTheme('dark');
    mql.dispatch(false);
    expect(themeColor()).toBe('#1b1e26');
    applyTheme('light');
    mql.dispatch(true);
    expect(themeColor()).toBe('#4f46e5');
  });

  it('isSystemDark は matchMedia の結果を返す', () => {
    expect(isSystemDark()).toBe(false);
    mql.dispatch(true);
    expect(isSystemDark()).toBe(true);
  });

  it('subscribeSystemThemeChange の解除後は変化が届かない', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSystemThemeChange(onChange);
    mql.dispatch(true);
    expect(onChange).toHaveBeenCalledWith(true);
    unsubscribe();
    mql.dispatch(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('updateThemeMeta は meta が無くても例外を出さない', () => {
    document.head.innerHTML = '';
    expect(() => updateThemeMeta('dark')).not.toThrow();
  });

  it('localStorage が使えなくても applyTheme は例外を出さない', () => {
    const original = window.localStorage;
    const throwing = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    Object.defineProperty(window, 'localStorage', { value: throwing, configurable: true });
    try {
      expect(() => applyTheme('dark')).not.toThrow();
      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally {
      Object.defineProperty(window, 'localStorage', { value: original, configurable: true });
    }
  });

  it('全削除でテーマのミラーと data-theme が消え、システム連動へ戻る', async () => {
    applyTheme('dark');
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('dark');
    await resetAppData();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBeNull();
  });
});

describe('theme-init.js（ペイント前の初期化スクリプト）', () => {
  const code = readFileSync(resolve('public/theme-init.js'), 'utf-8');

  function runInit(stored: string | null, throwOnRead = false) {
    const metas: Record<string, string> = { 'color-scheme': 'light dark', 'theme-color': '#4f46e5' };
    const attributes = new Map<string, string>();
    const sandbox: Record<string, unknown> = {
      window: {
        localStorage: {
          getItem: () => {
            if (throwOnRead) throw new Error('denied');
            return stored;
          },
        },
      },
      document: {
        documentElement: {
          setAttribute: (key: string, value: string) => attributes.set(key, value),
          removeAttribute: (key: string) => attributes.delete(key),
        },
        querySelector: (selector: string) => {
          const name = /meta\[name="([^"]+)"\]/.exec(selector)?.[1];
          if (!name || !(name in metas)) return null;
          return { setAttribute: (_key: string, value: string) => { metas[name] = value; } };
        },
      },
    };
    vm.runInNewContext(code, sandbox);
    return { metas, attributes };
  }

  it('保存された dark をペイント前に反映する', () => {
    const { metas, attributes } = runInit('dark');
    expect(attributes.get('data-theme')).toBe('dark');
    expect(metas['color-scheme']).toBe('dark');
    expect(metas['theme-color']).toBe('#1b1e26');
  });

  it('保存された light をペイント前に反映する', () => {
    const { metas, attributes } = runInit('light');
    expect(attributes.get('data-theme')).toBe('light');
    expect(metas['color-scheme']).toBe('light');
    expect(metas['theme-color']).toBe('#4f46e5');
  });

  it('保存がない（system）ときは何も設定しない', () => {
    const { metas, attributes } = runInit(null);
    expect(attributes.size).toBe(0);
    expect(metas['color-scheme']).toBe('light dark');
    expect(metas['theme-color']).toBe('#4f46e5');
  });

  it('不正な保存値は無視する', () => {
    const { attributes } = runInit('sepia');
    expect(attributes.size).toBe(0);
  });

  it('localStorage が読めなくても例外を出さない', () => {
    expect(() => runInit(null, true)).not.toThrow();
  });
});

describe('ブランドロゴのインライン SVG', () => {
  it('BrandWordmark は var(--text) を参照する', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<BrandWordmark />));
    const text = container.querySelector('text');
    expect(text?.getAttribute('fill')).toBe('var(--text)');
    expect(text?.textContent).toBe('nai-tagdeck');
    await act(async () => root.unmount());
    container.remove();
  });

  it('BrandIcon は var(--accent) / var(--accent-text) を参照する', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<BrandIcon />));
    const paths = [...container.querySelectorAll('path')];
    expect(paths.some((p) => p.getAttribute('fill') === 'var(--accent)')).toBe(true);
    expect(paths.some((p) => p.getAttribute('stroke') === 'var(--accent-text)')).toBe(true);
    expect(container.querySelector('circle')?.getAttribute('fill')).toBe('var(--accent-text)');
    await act(async () => root.unmount());
    container.remove();
  });
});
