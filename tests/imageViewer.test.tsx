// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from '../src/components/ImageViewer';
import type { GeneratedImage } from '../src/hooks/useImages';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const stubDialog = () => {
  const prototype = HTMLDialogElement.prototype;
  const originals = ['showModal', 'close'].map((name) => [name, Object.getOwnPropertyDescriptor(prototype, name)] as const);
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(prototype, name, descriptor);
      else Reflect.deleteProperty(prototype, name);
    }
  };
};

function image(extra: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: 'img-1',
    url: 'blob:test',
    blob: new Blob([], { type: 'image/png' }),
    seed: 123,
    width: 832,
    height: 1216,
    prompt: '1girl',
    characterPrompts: ['wolf'],
    createdAt: 1_700_000_000_000,
    downloaded: false,
    pinned: false,
    ...extra,
  };
}

async function renderViewer(value: GeneratedImage, onUseSeed = vi.fn()) {
  await act(async () => {
    root.render(
      <ImageViewer
        image={value}
        hasPrev={false}
        hasNext={false}
        onPrev={() => {}}
        onNext={() => {}}
        onClose={() => {}}
        onRemove={() => {}}
        onUseSeed={onUseSeed}
        onDownload={() => {}}
        onTogglePin={() => {}}
      />,
    );
  });
  return onUseSeed;
}

describe('ImageViewer prompts and parameters', () => {
  let restore: (() => void) | undefined;

  beforeEach(() => {
    restore = stubDialog();
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    restore?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows sent parameters and copies each prompt inside the dialog', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
    await renderViewer(image({
      negativePrompt: 'lowres',
      characterDetails: [
        { prompt: 'wolf', negative: 'alias', center: { x: 0.2, y: 0.8 } },
        { prompt: 'cat', negative: '' },
      ],
      characterPrompts: ['wolf', 'cat'],
      params: {
        mode: 'furry',
        steps: 28,
        scale: 5.6,
        sampler: 'k_euler',
        noiseSchedule: 'exponential',
        cfgRescale: 0.23,
        dynamicThresholding: true,
      },
    }));

    const text = container.textContent ?? '';
    expect(text).toContain('ケモノ');
    expect(text).toContain('28');
    expect(text).toContain('5.6');
    expect(text).toContain('Euler');
    expect(text).toContain('exponential');
    expect(text).toContain('0.23');
    expect(text).toContain('オン');
    expect(text).toContain('位置　横 0.2、縦 0.8');
    expect(container.querySelector('button[aria-label="このシードを次の生成で使う"]')?.textContent).toContain('次に使う');
    expect(container.querySelector('.viewer-seed-apply svg')).not.toBeNull();

    const copyButtons = [...container.querySelectorAll<HTMLButtonElement>('.viewer-prompt button')];
    expect(copyButtons.map((b) => b.disabled)).toEqual([false, false, false, false, true, false]);
    await act(async () => {
      copyButtons[0]!.click();
    });
    expect(writeText).toHaveBeenCalledWith('1girl');
    expect(copyButtons[0]!.textContent).toContain('コピー済み');
    expect(container.querySelector('.viewer-prompt ~ [role="status"]')?.textContent).toBe('ベースをコピーしました');

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(copyButtons[0]!.textContent).toContain('コピー');
    expect(copyButtons[0]!.textContent).not.toContain('コピー済み');
  });

  it('falls back to character prompt strings and applies the seed without a copy icon', async () => {
    const onUseSeed = await renderViewer(image());
    expect(container.textContent).toContain('キャラ1');
    expect(container.textContent).not.toContain('キャラ1のネガティブ');
    expect(container.textContent).not.toContain('モード');
    const seedButton = container.querySelector<HTMLButtonElement>('.viewer-seed-apply')!;
    await act(async () => seedButton.click());
    expect(onUseSeed).toHaveBeenCalledWith(123);
    expect(seedButton.textContent).toContain('設定済み');
    expect(seedButton.getAttribute('aria-label')).toBe('設定済み');
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(seedButton.textContent).toContain('次に使う');
    expect(seedButton.getAttribute('aria-label')).toBe('このシードを次の生成で使う');
  });

  it('announces a failed copy without marking the button done', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
    document.execCommand = () => false;
    await renderViewer(image({ negativePrompt: '' }));
    const copyButtons = [...container.querySelectorAll<HTMLButtonElement>('.viewer-prompt button')];
    expect(copyButtons.at(-1)!.disabled).toBe(true);
    await act(async () => {
      copyButtons[0]!.click();
    });
    expect(copyButtons[0]!.textContent).not.toContain('コピー済み');
    expect(container.querySelector('.viewer-prompt ~ [role="status"]')?.textContent).toBe('コピーできませんでした');
  });
});
