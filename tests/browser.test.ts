// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyText,
  getMainScrollContainer,
  getScrollTop,
  installPinchZoomLock,
  setScrollTop,
} from '../src/lib/browser';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('copyText', () => {
  it('returns false and removes the fallback textarea when execCommand throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    document.execCommand = () => {
      throw new Error('missing');
    };
    await expect(copyText('1girl')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('returns false when execCommand is missing', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
    const exec = document.execCommand;
    // jsdom の実装を外し、呼び出しそのものが失敗する環境にする
    Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
    try {
      await expect(copyText('1girl', document.body)).resolves.toBe(false);
      expect(document.querySelector('textarea')).toBeNull();
    } finally {
      Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    }
  });
});

describe('main scroll container helpers', () => {
  it('returns window when .app-main is absent or not vertically scrollable', () => {
    expect(getMainScrollContainer()).toBe(window);
    const main = document.createElement('main');
    main.className = 'app-main';
    main.style.overflowY = 'visible';
    document.body.append(main);
    expect(getMainScrollContainer()).toBe(window);
  });

  it('returns .app-main and reads/writes scrollTop when .app-main scrolls internally', () => {
    const main = document.createElement('main');
    main.className = 'app-main';
    main.style.overflowY = 'auto';
    document.body.append(main);

    const container = getMainScrollContainer();
    expect(container).toBe(main);
    setScrollTop(container, 420);
    expect(main.scrollTop).toBe(420);
    expect(getScrollTop(container)).toBe(420);
  });
});

describe('installPinchZoomLock', () => {
  const createTouchMove = (touchCount: number) => {
    const ev = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: Array.from({ length: touchCount }, () => ({})) });
    return ev;
  };

  it('prevents gesturestart/gesturechange and multi-touch touchmove outside viewer/inpaint stages', () => {
    const uninstall = installPinchZoomLock(document);
    try {
      const normal = document.createElement('div');
      document.body.append(normal);

      const gestureStart = new Event('gesturestart', { bubbles: true, cancelable: true });
      normal.dispatchEvent(gestureStart);
      expect(gestureStart.defaultPrevented).toBe(true);

      const gestureChange = new Event('gesturechange', { bubbles: true, cancelable: true });
      normal.dispatchEvent(gestureChange);
      expect(gestureChange.defaultPrevented).toBe(true);

      const oneFinger = createTouchMove(1);
      normal.dispatchEvent(oneFinger);
      expect(oneFinger.defaultPrevented).toBe(false);

      const twoFingers = createTouchMove(2);
      normal.dispatchEvent(twoFingers);
      expect(twoFingers.defaultPrevented).toBe(true);
    } finally {
      uninstall();
    }
  });

  it('does not block multi-touch touchmove inside .viewer-stage or .inpaint-stage', () => {
    const uninstall = installPinchZoomLock(document);
    try {
      const viewerStage = document.createElement('div');
      viewerStage.className = 'viewer-stage';
      const viewerImg = document.createElement('img');
      viewerStage.append(viewerImg);

      const inpaintStage = document.createElement('div');
      inpaintStage.className = 'inpaint-stage';
      const canvas = document.createElement('canvas');
      inpaintStage.append(canvas);

      document.body.append(viewerStage, inpaintStage);

      const viewerPinch = createTouchMove(2);
      viewerImg.dispatchEvent(viewerPinch);
      expect(viewerPinch.defaultPrevented).toBe(false);

      const inpaintPinch = createTouchMove(2);
      canvas.dispatchEvent(inpaintPinch);
      expect(inpaintPinch.defaultPrevented).toBe(false);
    } finally {
      uninstall();
    }
  });

  it('stops intercepting events after uninstall', () => {
    const uninstall = installPinchZoomLock(document);
    uninstall();
    const normal = document.createElement('div');
    document.body.append(normal);

    const twoFingers = createTouchMove(2);
    normal.dispatchEvent(twoFingers);
    expect(twoFingers.defaultPrevented).toBe(false);
  });
});
