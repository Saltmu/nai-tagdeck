// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { DictionaryView } from '../src/components/DictionaryView';
import type { Dictionary } from '../src/hooks/useDictionary';
import type { DictEntry } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const entry: DictEntry = {
  id: 'custom',
  tag: 'custom-tag',
  category: 'quality',
  alias: '',
  default_weight: 1,
  sort_order: 0,
  updated_at: '',
};

const added: DictEntry = { ...entry, id: 'added', tag: 'added-tag' };

function dictionary(entries: DictEntry[], restoreInitial: () => Promise<number>): Dictionary {
  return {
    entries,
    loaded: true,
    error: null,
    save: vi.fn(),
    saveMany: vi.fn(),
    remove: vi.fn(),
    importEntries: vi.fn(),
    restoreInitial,
    reload: vi.fn(),
  };
}

let container: HTMLDivElement;
let root: Root;

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.trim() === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('dictionary drafts', () => {
  it('closes an open draft when another tab is reloaded, and keeps it when entries change locally', async () => {
    function Harness() {
      const [entries, setEntries] = useState<DictEntry[]>([entry]);
      const [reloadRevision, setReloadRevision] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setReloadRevision((revision) => revision + 1)}>再読み込みを反映</button>
          <DictionaryView
            dictionary={dictionary(entries, async () => {
              setEntries([entry, added]);
              return 2;
            })}
            notify={() => {}}
            reloadRevision={reloadRevision}
          />
        </>
      );
    }
    await act(async () => root.render(<DialogProvider><Harness /></DialogProvider>));
    await act(async () => button('編集').click());
    expect(container.querySelector('.is-editing')).not.toBeNull();
    await act(async () => button('初期カテゴリを復元').click());
    expect(container.textContent).toContain('added-tag');
    expect(container.querySelector('.is-editing')).not.toBeNull();
    await act(async () => button('再読み込みを反映').click());
    expect(container.querySelector('.is-editing')).toBeNull();
  });
});
