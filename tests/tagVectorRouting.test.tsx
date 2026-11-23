// @vitest-environment jsdom
import { act, useReducer, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { Editor } from '../src/components/Editor';
import type { Dictionary } from '../src/hooks/useDictionary';
import type { PresetStore } from '../src/hooks/usePresets';
import { readPromptImport } from '../src/lib/promptImport';
import { sampleDictionary } from '../src/lib/sampleDictionary';
import { emptyGroups, emptyWorkspace, workspaceReducer } from '../src/lib/workspace';
import type { DictEntry, Workspace } from '../src/types';
import { pngFixture } from './promptImportFixture';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const presets: PresetStore = {
  presets: [],
  persistence: [],
  setPresets: () => {},
  activeId: null,
  setActiveId: () => {},
};

function initialWorkspace(): Workspace {
  const ws = emptyWorkspace();
  ws.characters = [{ id: 'c1', name: 'キャラ1', enabled: true, tags: emptyGroups() }];
  return ws;
}

interface HarnessRef {
  setEntries: (next: DictEntry[]) => void;
  getWorkspace: () => Workspace;
  replaceWorkspace: (next: Workspace) => void;
}

function Harness({ initialEntries, onReady }: { initialEntries: DictEntry[]; onReady: (ref: HarnessRef) => void }) {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, initialWorkspace);
  const [entries, setEntries] = useState<DictEntry[]>(initialEntries);

  onReady({
    setEntries,
    getWorkspace: () => workspace,
    replaceWorkspace: (next) => dispatch({ type: 'replace', workspace: next }),
  });

  const dictionary: Dictionary = {
    entries,
    loaded: true,
    error: null,
    save: async (entry) => setEntries((prev) => [...prev.filter((item) => item.id !== entry.id), entry]),
    saveMany: async (incoming) => {
      const ids = new Set(incoming.map((item) => item.id));
      setEntries((prev) => [...prev.filter((item) => !ids.has(item.id)), ...incoming]);
    },
    remove: async (id) => setEntries((prev) => prev.filter((item) => item.id !== id)),
    importEntries: async () => 0,
    restoreInitial: async () => 0,
    reload: async () => {},
  };

  return (
    <DialogProvider>
      <Editor
        workspace={workspace}
        dispatch={dispatch}
        loaded
        dictionary={dictionary}
        syntax="numeric"
        onCopy={() => {}}
        notify={() => {}}
        presets={presets}
        characterNegative=""
        onCharacterNegativeChange={() => {}}
        shown
      />
    </DialogProvider>
  );
}

let container: HTMLDivElement;
let root: Root;
let harness!: HarnessRef;

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submitTopInput(label: string, text: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}にタグを追加"]`)!;
  await type(input, text);
  const addButton = input.parentElement!.querySelector<HTMLButtonElement>('button')!;
  await act(async () => addButton.click());
}

async function clickTab(label: string) {
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((el) => el.textContent === label)!;
  await act(async () => tab.click());
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  window.scrollTo = () => {};
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness initialEntries={sampleDictionary()} onReady={(ref) => { harness = ref; }} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('auto-classifies unregistered tags on character and shows clickable move candidate on base', async () => {
  // ベース: 未登録タグは未分類に入り、根拠があるときだけ候補カテゴリを行に表示する
  await submitTopInput('ベース', '1.3::asymmetrical bomber jacket::, completely unknown xyzzy');

  const baseUnclassified = harness.getWorkspace().base.unclassified;
  expect(baseUnclassified.map((t) => [t.tag, t.weight])).toEqual([
    ['asymmetrical bomber jacket', 1.3],
    ['completely unknown xyzzy', 1],
  ]);

  const suggestBtn = container.querySelector<HTMLButtonElement>(
    'button[aria-label="asymmetrical bomber jacket を候補カテゴリ「衣装」へ移動"]',
  );
  expect(suggestBtn).not.toBeNull();
  expect(suggestBtn?.textContent).toBe('候補: 衣装');
  expect(
    container.querySelector('button[aria-label^="completely unknown xyzzy を候補カテゴリ"]'),
  ).toBeNull();

  // 候補を押すと既存のカテゴリ移動と同じ処理で衣装へ移る（重みも維持）
  await act(async () => suggestBtn!.click());
  expect(harness.getWorkspace().base.outfit.map((t) => [t.tag, t.weight])).toEqual([
    ['asymmetrical bomber jacket', 1.3],
  ]);
  expect(harness.getWorkspace().base.unclassified.map((t) => t.tag)).toEqual(['completely unknown xyzzy']);

  // キャラ: 根拠のある未登録タグは自動で衣装へ、対象外カテゴリ・共通語なしは未分類へ（重みを維持）
  await clickTab('キャラ1');
  await submitTopInput(
    'キャラ1',
    '1.4::asymmetrical bomber jacket::, 0.8::abandoned train station::, 1.2::completely unknown xyzzy::',
  );

  const charTags = harness.getWorkspace().characters[0]!.tags;
  expect(charTags.outfit.map((t) => [t.tag, t.weight])).toEqual([['asymmetrical bomber jacket', 1.4]]);
  expect(charTags.unclassified.map((t) => [t.tag, t.weight])).toEqual([
    ['abandoned train station', 0.8],
    ['completely unknown xyzzy', 1.2],
  ]);
  // キャラの未分類行には候補ボタンを出さない
  expect(container.querySelector('.tag-category-suggest')).toBeNull();
});

it('reflects dictionary additions, edits, and deletions on the next judgement', async () => {
  const baseDict = sampleDictionary();
  const custom: DictEntry = {
    id: 'custom-cloak',
    tag: 'cloak',
    category: 'outfit',
    alias: '',
    default_weight: 1,
    sort_order: 0,
    updated_at: '',
  };

  // 登録前は共通語がなく未分類・候補なし
  await submitTopInput('ベース', 'embossed cloak');
  expect(container.querySelector('button[aria-label^="embossed cloak を候補カテゴリ"]')).toBeNull();

  // 登録後: 次の判定で衣装が候補に出る
  await act(async () => harness.setEntries([...baseDict, custom]));
  await submitTopInput('ベース', 'embossed cloak');
  expect(
    container.querySelector('button[aria-label="embossed cloak を候補カテゴリ「衣装」へ移動"]'),
  ).not.toBeNull();

  // カテゴリ変更後: ベース・キャラ双方の次の判定に変更先（外見）が反映される
  await act(async () => harness.setEntries([...baseDict, { ...custom, category: 'appearance' }]));
  await submitTopInput('ベース', 'embossed cloak');
  expect(
    container.querySelector('button[aria-label="embossed cloak を候補カテゴリ「外見」へ移動"]'),
  ).not.toBeNull();
  await clickTab('キャラ1');
  await submitTopInput('キャラ1', 'shimmering cloak');
  expect(harness.getWorkspace().characters[0]!.tags.appearance.map((t) => t.tag)).toContain('shimmering cloak');

  // 削除後: 次の判定で未分類・候補なしに戻る
  await act(async () => harness.setEntries(baseDict));
  await submitTopInput('キャラ1', 'tattered cloak');
  expect(harness.getWorkspace().characters[0]!.tags.unclassified.map((t) => t.tag)).toContain('tattered cloak');
  await clickTab('ベース');
  await submitTopInput('ベース', 'embossed cloak');
  expect(container.querySelector('button[aria-label^="embossed cloak を候補カテゴリ"]')).toBeNull();
});

it('keeps unclassified section input, ambiguous dictionary tags, and PNG import on existing behavior', async () => {
  // 同名で複数カテゴリに登録されたタグは未分類・候補なしを維持
  const withAmbiguous: DictEntry[] = [
    ...sampleDictionary(),
    { id: 'amb-1', tag: 'layered jacket', category: 'outfit', alias: '', default_weight: 1, sort_order: 0, updated_at: '' },
    { id: 'amb-2', tag: 'layered jacket', category: 'appearance', alias: '', default_weight: 1, sort_order: 0, updated_at: '' },
  ];
  await act(async () => harness.setEntries(withAmbiguous));

  await submitTopInput('ベース', 'layered jacket');
  expect(harness.getWorkspace().base.unclassified.map((t) => t.tag)).toContain('layered jacket');
  expect(container.querySelector('button[aria-label^="layered jacket を候補カテゴリ"]')).toBeNull();

  // 未分類カテゴリの個別追加欄では候補表示を行わない
  const unclassifiedInput = container.querySelector<HTMLInputElement>('input[aria-label="未分類にタグを追加"]')!;
  await type(unclassifiedInput, 'asymmetrical bomber jacket');
  await act(async () => unclassifiedInput.parentElement!.querySelector<HTMLButtonElement>('button')!.click());
  expect(harness.getWorkspace().base.unclassified.map((t) => t.tag)).toContain('asymmetrical bomber jacket');
  expect(container.querySelector('button[aria-label^="asymmetrical bomber jacket を候補カテゴリ"]')).toBeNull();

  // 画像取り込み時の分類は現行どおり完全一致のみ
  const png = new Blob([
    pngFixture({
      prompt: 'asymmetrical bomber jacket',
      v4_prompt: {
        caption: {
          base_caption: 'asymmetrical bomber jacket',
          char_captions: [{ char_caption: 'asymmetrical bomber jacket', centers: [] }],
        },
        use_coords: false,
      },
      uc: '',
      v4_negative_prompt: { caption: { base_caption: '', char_captions: [] } },
    }),
  ]);
  const imported = await readPromptImport(png, sampleDictionary());
  expect(imported.base.unclassified.map((t) => t.tag)).toEqual(['asymmetrical bomber jacket']);
  expect(imported.characters[0]?.tags.unclassified.map((t) => t.tag)).toEqual(['asymmetrical bomber jacket']);

  // 上部入力で候補が付いたあと、PNG 取り込み等で別の行に置き換わった場合は候補を引き継がない
  await submitTopInput('ベース', 'asymmetrical bomber jacket');
  expect(
    container.querySelector('button[aria-label="asymmetrical bomber jacket を候補カテゴリ「衣装」へ移動"]'),
  ).not.toBeNull();

  await act(async () => harness.replaceWorkspace({
    base: imported.base,
    characters: imported.characters,
    negative: harness.getWorkspace().negative,
  }));
  expect(harness.getWorkspace().base.unclassified.map((t) => t.tag)).toEqual(['asymmetrical bomber jacket']);
  expect(container.querySelector('button[aria-label^="asymmetrical bomber jacket を候補カテゴリ"]')).toBeNull();
});
