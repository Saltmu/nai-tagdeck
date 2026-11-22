// @vitest-environment jsdom
import { act, useReducer, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider, useDialogs, type DialogApi } from '../src/components/Dialogs';
import { GenerateDock } from '../src/components/GenerateDock';
import { QuickGenerate } from '../src/components/QuickGenerate';
import { ImageViewer } from '../src/components/ImageViewer';
import { Editor } from '../src/components/Editor';
import { useTagUndo } from '../src/hooks/useTagUndo';
import { TagInput } from '../src/components/TagInput';
import { PresetBar } from '../src/components/PresetBar';
import { emptyWorkspace, workspaceReducer } from '../src/lib/workspace';
import type { SizeKey } from '../src/lib/generation';
import type { GeneratedImage } from '../src/hooks/useImages';
import type { PresetStore } from '../src/hooks/usePresets';
import type { Dictionary } from '../src/hooks/useDictionary';

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

const mockPresets = (): PresetStore => ({
  presets: [],
  setPresets: () => {},
  activeId: null,
  setActiveId: () => {},
  persistence: [
    { status: 'idle', loaded: true, error: null },
    { status: 'idle', loaded: true, error: null },
  ],
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Dialogs initial focus', () => {
  it('focuses cancel button on danger confirm and primary button on normal confirm', async () => {
    const restore = stubDialog();
    let dialogs!: DialogApi;
    function Harness() {
      dialogs = useDialogs();
      return null;
    }
    try {
      await act(async () => root.render(<DialogProvider><Harness /></DialogProvider>));

      let dangerPromise!: Promise<boolean>;
      await act(async () => {
        dangerPromise = dialogs.confirm('削除しますか？', { okLabel: '削除', danger: true });
      });
      expect(document.activeElement?.textContent).toBe('キャンセル');
      await act(async () => {
        (document.activeElement as HTMLButtonElement).click();
      });
      expect(await dangerPromise).toBe(false);

      let normalPromise!: Promise<boolean>;
      await act(async () => {
        normalPromise = dialogs.confirm('続けますか？', { okLabel: '続行' });
      });
      expect(document.activeElement?.textContent).toBe('続行');
      await act(async () => {
        (document.activeElement as HTMLButtonElement).click();
      });
      expect(await normalPromise).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('GenerateDock tablist', () => {
  it('supports roving tabIndex, aria-controls, and arrow/Home/End navigation', async () => {
    await act(async () =>
      root.render(
        <GenerateDock
          collapseSignal={0}
          generating={false}
          error={null}
          onDismissError={() => {}}
          promptPanel={<div>prompt</div>}
          generatePanel={<div>generate</div>}
        />,
      ),
    );
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    const [tab0, tab1] = tabs as [HTMLButtonElement, HTMLButtonElement];
    expect(tab0.tabIndex).toBe(0);
    expect(tab1.tabIndex).toBe(-1);

    const panels = [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(tab0.getAttribute('aria-controls')).toBe(panels[0]!.id);
    expect(panels[0]!.getAttribute('aria-labelledby')).toBe(tab0.id);

    await act(async () => {
      tab0.focus();
      tab0.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(tab1);
    expect(tab1.tabIndex).toBe(0);
    expect(tab0.tabIndex).toBe(-1);
    expect(tab1.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(document.activeElement).toBe(tab0);
    expect(tab0.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      tab0.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(tab1);
  });
});

describe('QuickGenerate radiogroup', () => {
  it('supports roving tabIndex (including non-quick size fallback) and arrow navigation', async () => {
    function Harness() {
      const [size, setSize] = useState<SizeKey>('tall');
      return (
        <QuickGenerate
          size={size}
          onSizeChange={(next) => setSize(next)}
          generating={false}
          blocker={null}
          onGenerate={() => {}}
        />
      );
    }
    await act(async () => root.render(<Harness />));
    const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios).toHaveLength(3);
    const [r0, r1, r2] = radios as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
    // 非標準サイズ選択時は先頭ラジオが tabIndex=0 になる
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);

    await act(async () => {
      r0.focus();
      r0.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(r1);
    expect(r1.getAttribute('aria-checked')).toBe('true');
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);

    await act(async () => {
      r1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(document.activeElement).toBe(r0);
    expect(r0.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      r0.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(r2);
    expect(r2.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Editor tablist', () => {
  it('keeps add and history controls outside the tablist and supports arrow navigation', async () => {
    const dictionary: Dictionary = {
      entries: [],
      loaded: true,
      error: null,
      save: async () => {},
      saveMany: async () => {},
      remove: async () => {},
      importEntries: async () => 0,
      restoreInitial: async () => 0,
    };
    await act(async () =>
      root.render(
        <DialogProvider>
          <Editor
            workspace={emptyWorkspace()}
            dispatch={() => {}}
            history={{ canUndo: false, canRedo: false, undo: () => {}, redo: () => {}, status: '' }}
            loaded
            dictionary={dictionary}
            syntax="brace"
            onCopy={() => {}}
            notify={() => {}}
            presets={mockPresets()}
            characterNegative=""
            onCharacterNegativeChange={() => {}}
            shown
          />
        </DialogProvider>,
      ),
    );
    const tablist = container.querySelector('[role="tablist"]')!;
    expect(tablist.querySelector('.editor-tab-add')).toBeNull();
    expect(tablist.querySelector('[aria-label="編集履歴"]')).toBeNull();
    expect(tablist.closest('.editor-tabs')?.querySelector('[aria-label="編集履歴"] button[aria-label="元に戻す"]')).not.toBeNull();
    const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    const [t0, t1] = tabs as [HTMLButtonElement, HTMLButtonElement];
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1]);

    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(t0.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(t0.id);

    await act(async () => {
      t0.focus();
      t0.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(t1);
    expect(t1.getAttribute('aria-selected')).toBe('true');
    expect(t1.getAttribute('aria-controls')).toBe(container.querySelector('[role="tabpanel"]')?.id);
  });

  it('moves focus to the duplicated character tab and leaves the add button focused', async () => {
    const dictionary: Dictionary = {
      entries: [],
      loaded: true,
      error: null,
      save: async () => {},
      saveMany: async () => {},
      remove: async () => {},
      importEntries: async () => 0,
      restoreInitial: async () => 0,
    };
    let initial = emptyWorkspace();
    for (const name of ['A', 'B', 'C']) {
      initial = workspaceReducer(initial, { type: 'addCharacter' });
      initial = workspaceReducer(initial, { type: 'renameCharacter', id: initial.characters.at(-1)!.id, name });
    }
    function Harness() {
      const [workspace, rawDispatch] = useReducer(workspaceReducer, initial);
      const history = useTagUndo(workspace, rawDispatch);
      return (
        <DialogProvider>
          <Editor
            workspace={workspace}
            dispatch={history.dispatch}
            history={history}
            loaded
            dictionary={dictionary}
            syntax="brace"
            onCopy={() => {}}
            notify={() => {}}
            presets={mockPresets()}
            characterNegative=""
            onCharacterNegativeChange={() => {}}
            shown
          />
        </DialogProvider>
      );
    }
    await act(async () => root.render(<Harness />));
    const tabByName = (name: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('.editor-tab-character')].find((tab) => tab.textContent === name)!;
    const names = () => [...container.querySelectorAll('.editor-tab-character')].map((tab) => tab.textContent);

    const add = container.querySelector<HTMLButtonElement>('button[aria-label="キャラクターを追加"]')!;
    add.focus();
    await act(async () => add.click());
    expect(document.activeElement).toBe(add);
    expect(names()).toEqual(['A', 'B', 'C', 'キャラ4']);

    await act(async () => tabByName('B').click());
    const duplicate = container.querySelector<HTMLButtonElement>('button[aria-label="B を複製"]')!;
    duplicate.focus();
    await act(async () => duplicate.click());
    expect(names()).toEqual(['A', 'B', 'B（コピー）', 'C', 'キャラ4']);
    expect(document.activeElement).toBe(tabByName('B（コピー）'));
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    expect(names()).toEqual(['A', 'B', 'C', 'キャラ4']);
    expect(document.activeElement).toBe(tabByName('B'));
    expect(tabByName('B').getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    });
    expect(names()).toEqual(['A', 'B', 'B（コピー）', 'C', 'キャラ4']);
    expect(document.activeElement).toBe(tabByName('B（コピー）'));
    expect(tabByName('B（コピー）').getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    const redo = container.querySelector<HTMLButtonElement>('button[aria-label="やり直す"]')!;
    redo.focus();
    await act(async () => redo.click());
    expect(document.activeElement).toBe(redo);
    expect(tabByName('B（コピー）').getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(redo);
    expect(names()).toEqual(['A', 'B', 'C', 'キャラ4']);

    await act(async () => tabByName('B').click());
    const duplicateForCheck = container.querySelector<HTMLButtonElement>('button[aria-label="B を複製"]')!;
    duplicateForCheck.focus();
    await act(async () => duplicateForCheck.click());
    await act(async () => tabByName('B').click());
    const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="B（コピー） を生成に含める"]')!;
    checkbox.focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    expect(names()).toEqual(['A', 'B', 'C', 'キャラ4']);
    expect(document.activeElement).toBe(tabByName('B'));
    expect(tabByName('B').getAttribute('aria-selected')).toBe('true');

    await act(async () => tabByName('B').click());
    const duplicateAgain = container.querySelector<HTMLButtonElement>('button[aria-label="B を複製"]')!;
    duplicateAgain.focus();
    await act(async () => duplicateAgain.click());
    const undo = container.querySelector<HTMLButtonElement>('button[aria-label="元に戻す"]')!;
    undo.focus();
    await act(async () => undo.click());
    expect(document.activeElement).toBe(undo);
    expect(tabByName('B').getAttribute('aria-selected')).toBe('true');
    expect(names()).toEqual(['A', 'B', 'C', 'キャラ4']);

    await act(async () => tabByName('B').click());
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="B を削除"]')!;
    await act(async () => remove.click());
    expect(names()).toEqual(['A', 'C', 'キャラ4']);
    const check = container.querySelector<HTMLInputElement>('input[aria-label="A を生成に含める"]')!;
    check.focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    expect(names()).toEqual(['A', 'B', 'C', 'キャラ4']);
    expect(document.activeElement).toBe(check);
    expect(tabByName('B').getAttribute('aria-selected')).toBe('true');
  });

  it('moves focus to the restored tab when redo disables the focused generation checkbox', async () => {
    const dictionary: Dictionary = {
      entries: [],
      loaded: true,
      error: null,
      save: async () => {},
      saveMany: async () => {},
      remove: async () => {},
      importEntries: async () => 0,
      restoreInitial: async () => 0,
    };
    let initial = emptyWorkspace();
    for (let i = 0; i < 6; i++) {
      initial = workspaceReducer(initial, { type: 'addCharacter' });
      initial = workspaceReducer(initial, {
        type: 'renameCharacter',
        id: initial.characters.at(-1)!.id,
        name: `C${i + 1}`,
      });
    }
    initial = workspaceReducer(initial, { type: 'toggleCharacter', id: initial.characters[5]!.id });
    function Harness() {
      const [workspace, rawDispatch] = useReducer(workspaceReducer, initial);
      const history = useTagUndo(workspace, rawDispatch);
      return (
        <DialogProvider>
          <Editor
            workspace={workspace}
            dispatch={history.dispatch}
            history={history}
            loaded
            dictionary={dictionary}
            syntax="brace"
            onCopy={() => {}}
            notify={() => {}}
            presets={mockPresets()}
            characterNegative=""
            onCharacterNegativeChange={() => {}}
            shown
          />
        </DialogProvider>
      );
    }
    await act(async () => root.render(<Harness />));
    const tabByName = (name: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('.editor-tab-character')].find((tab) => tab.textContent === name)!;
    await act(async () => tabByName('C1').click());
    const duplicate = container.querySelector<HTMLButtonElement>('button[aria-label="C1 を複製"]')!;
    await act(async () => duplicate.click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    const check = container.querySelector<HTMLInputElement>('input[aria-label="C6 を生成に含める"]')!;
    expect(check.disabled).toBe(false);
    check.focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    });
    expect(check.disabled).toBe(true);
    expect(document.activeElement).toBe(tabByName('C1（コピー）'));
    expect(tabByName('C1（コピー）').getAttribute('aria-selected')).toBe('true');
  });
});

describe('ImageViewer keyboard and live region', () => {
  it('prevents default on ArrowLeft/ArrowRight and announces remove readiness', async () => {
    vi.useFakeTimers();
    const restore = stubDialog();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const image: GeneratedImage = {
      id: 'img-1',
      url: 'blob:test',
      blob: new Blob([], { type: 'image/png' }),
      seed: 123,
      width: 832,
      height: 1216,
      prompt: '1girl',
      characterPrompts: [],
      createdAt: 1000,
      downloaded: false,
    };
    try {
      await act(async () =>
        root.render(
          <ImageViewer
            image={image}
            hasPrev
            hasNext
            onPrev={onPrev}
            onNext={onNext}
            onClose={() => {}}
            onRemove={() => {}}
            onUseSeed={() => {}}
            onDownload={() => {}}
          />,
        ),
      );
      const dialog = container.querySelector('dialog')!;
      const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
      const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      await act(async () => {
        dialog.dispatchEvent(left);
        dialog.dispatchEvent(right);
      });
      expect(left.defaultPrevented).toBe(true);
      expect(right.defaultPrevented).toBe(true);
      expect(onPrev).toHaveBeenCalledTimes(1);
      expect(onNext).toHaveBeenCalledTimes(1);

      const status = container.querySelector('[role="status"][aria-live="polite"]')!;
      expect(status.textContent).toBe('');
      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="削除"]')?.click();
      });
      expect(status.textContent).toBe('');
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(status.textContent).toContain('削除の準備ができました');
    } finally {
      restore();
    }
  });
});

describe('Listbox accessible labels', () => {
  it('provides aria-label on TagInput and PresetBar listboxes', async () => {
    await act(async () =>
      root.render(
        <DialogProvider>
          <TagInput label="品質" entries={[]} onAdd={() => {}} />
          <PresetBar store={mockPresets()} workspace={emptyWorkspace()} dispatch={() => {}} notify={() => {}} />
        </DialogProvider>,
      ),
    );
    const listboxes = [...container.querySelectorAll('[role="listbox"]')];
    expect(listboxes).toHaveLength(2);
    for (const lb of listboxes) {
      expect(lb.getAttribute('aria-label')?.trim().length).toBeGreaterThan(0);
    }
  });
});
