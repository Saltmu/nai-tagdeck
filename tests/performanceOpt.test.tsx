// @vitest-environment jsdom
import { act, useCallback, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CategorySection } from '../src/components/CategorySection';
import { Toast, type ToastHandle } from '../src/components/Toast';
import { useScrollMemory } from '../src/hooks/useScrollMemory';
import { useGenerationSettings, useSettings } from '../src/hooks/useWorkspace';
import { BASE } from '../src/lib/workspace';
import type { WorkTag } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('CategorySection collapsed unmounting', () => {
  it('unmounts TagRow and TagInput while collapsed and mounts them when expanded', async () => {
    const tags: WorkTag[] = [{ id: 't1', tag: 'jacket', enabled: true, weight: 1 }];
    await act(async () =>
      root.render(
        <CategorySection
          target={BASE}
          category="outfit"
          tags={tags}
          dispatch={vi.fn()}
          entries={[]}
          syntax="numeric"
          isKnown={() => true}
          onCopy={vi.fn()}
          notify={vi.fn()}
          onRegister={vi.fn()}
        />,
      ),
    );

    const disclosure = container.querySelector<HTMLButtonElement>('.disclosure')!;
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.tag-row')).not.toBeNull();
    expect(container.querySelector('.tag-input')).not.toBeNull();

    await act(async () => disclosure.click());
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.tag-row')).toBeNull();
    expect(container.querySelector('.tag-input')).toBeNull();

    await act(async () => disclosure.click());
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.tag-row')).not.toBeNull();
    expect(container.querySelector('.tag-input')).not.toBeNull();
  });

  it('preserves pending TagInput text and interaction prefix across collapse and expand', async () => {
    await act(async () =>
      root.render(
        <CategorySection
          target={BASE}
          category="pose"
          tags={[]}
          dispatch={vi.fn()}
          entries={[]}
          syntax="numeric"
          isKnown={() => true}
          onCopy={vi.fn()}
          notify={vi.fn()}
          onRegister={vi.fn()}
          interactions
        />,
      ),
    );

    const disclosure = container.querySelector<HTMLButtonElement>('.disclosure')!;
    if (disclosure.getAttribute('aria-expanded') === 'false') {
      await act(async () => disclosure.click());
    }

    const input = container.querySelector<HTMLInputElement>('.tag-input input')!;
    const sourceBtn = [...container.querySelectorAll<HTMLButtonElement>('.interaction-picks button')].find((b) =>
      b.textContent?.startsWith('source#'),
    )!;

    await act(async () => {
      sourceBtn.click();
    });
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'master');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('master');
    expect(sourceBtn.getAttribute('aria-pressed')).toBe('true');

    // Collapse unmounts TagInput
    await act(async () => disclosure.click());
    expect(container.querySelector('.tag-input')).toBeNull();

    // Expand restores both pending text and picked interaction
    await act(async () => disclosure.click());
    const reopenedInput = container.querySelector<HTMLInputElement>('.tag-input input')!;
    const reopenedSourceBtn = [...container.querySelectorAll<HTMLButtonElement>('.interaction-picks button')].find((b) =>
      b.textContent?.startsWith('source#'),
    )!;
    expect(reopenedInput.value).toBe('master');
    expect(reopenedSourceBtn.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Toast isolation', () => {
  it('updates and clears toast message without re-rendering parent component', async () => {
    vi.useFakeTimers();
    let parentRenders = 0;
    let notify!: (msg: string) => void;

    function Parent() {
      parentRenders += 1;
      const toastRef = useRef<ToastHandle>(null);
      notify = useCallback((msg: string) => toastRef.current?.show(msg, 500), []);
      return <Toast ref={toastRef} />;
    }

    await act(async () => root.render(<Parent />));
    expect(parentRenders).toBe(1);

    await act(async () => notify('保存しました'));
    expect(container.querySelector('.toast')?.textContent).toBe('保存しました');
    expect(parentRenders).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(container.querySelector('.toast')?.textContent).toBe('');
    expect(parentRenders).toBe(1);
  });
});

describe('useSettings / useGenerationSettings updater stability', () => {
  it('keeps updater callback references stable across state updates', async () => {
    const seenSettingsUpdaters = new Set<unknown>();
    const seenGenUpdaters = new Set<unknown>();
    let updateSettingsRef!: ReturnType<typeof useSettings>[1];
    let updateGenRef!: ReturnType<typeof useGenerationSettings>[1];

    function Harness() {
      const [, updateSettings] = useSettings(true);
      const [, updateGen] = useGenerationSettings();
      seenSettingsUpdaters.add(updateSettings);
      seenGenUpdaters.add(updateGen);
      updateSettingsRef = updateSettings;
      updateGenRef = updateGen;
      return null;
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      updateSettingsRef({ weightSyntax: 'brace' });
      updateGenRef({ steps: 20 });
    });

    expect(seenSettingsUpdaters.size).toBe(1);
    expect(seenGenUpdaters.size).toBe(1);
  });
});

describe('useScrollMemory', () => {
  it('does not call getClientRects during render and restores scroll position per key', async () => {
    let scrollYValue = 0;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollYValue,
    });
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation((_x, y) => {
      if (typeof y === 'number') scrollYValue = y;
    });

    let rendering = false;
    let calledDuringRender = false;
    let setTab!: (next: { key: string; shown: boolean }) => void;

    function Harness() {
      const [state, setState] = useState({ key: 'base', shown: true });
      setTab = setState;
      const anchorRef = useRef<HTMLDivElement>(null);
      rendering = true;
      useScrollMemory(state.key, state.shown, anchorRef);
      rendering = false;
      return (
        <div
          ref={(el) => {
            anchorRef.current = el;
            if (el) {
              el.getClientRects = (() => {
                if (rendering) calledDuringRender = true;
                return { length: state.shown ? 1 : 0 } as DOMRectList;
              });
            }
          }}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    scrollYValue = 300;
    window.dispatchEvent(new Event('scroll'));

    await act(async () => setTab({ key: 'negative', shown: true }));
    scrollYValue = 50;
    window.dispatchEvent(new Event('scroll'));

    await act(async () => setTab({ key: 'base', shown: true }));
    expect(calledDuringRender).toBe(false);
    expect(scrollToSpy).toHaveBeenCalledWith(0, 300);
  });
});
