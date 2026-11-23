// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../src/lib/browser';

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
