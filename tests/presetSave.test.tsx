// @vitest-environment jsdom
import { act, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { PresetBar } from '../src/components/PresetBar';
import { DEFAULT_GENERATION, type GenerationSettings } from '../src/lib/generation';
import { createPreset, type Preset } from '../src/lib/presets';
import { emptyWorkspace, workspaceReducer, type WorkspaceAction } from '../src/lib/workspace';
import type { PresetStore } from '../src/hooks/usePresets';
import { useTagUndo, type UndoExtras } from '../src/hooks/useTagUndo';
import type { Workspace } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));

function button(text: string, scope: ParentNode = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find((node) => node.textContent?.trim() === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

const click = (node: Element) => act(async () => (node as HTMLElement).click());

function Harness({
  initialWorkspace,
  initialPresets,
  initialActiveId,
  initialGeneration,
  initialNegative,
  settingsReady = true,
  workspaceReady = true,
}: {
  initialWorkspace: Workspace;
  initialPresets: Preset[];
  initialActiveId: string | null;
  initialGeneration: GenerationSettings;
  initialNegative: string;
  settingsReady?: boolean;
  workspaceReady?: boolean;
}) {
  const [workspace, rawDispatch] = useReducer(workspaceReducer, initialWorkspace);
  const [presets, setPresets] = useState(initialPresets);
  const [activeId, setActiveId] = useState(initialActiveId);
  const [generation, setGeneration] = useState(initialGeneration);
  const [characterNegativePrompt, setCharacterNegativePrompt] = useState(initialNegative);
  const [toast, setToast] = useState('');
  const generationRef = useRef(generation);
  const negativeRef = useRef(characterNegativePrompt);
  generationRef.current = generation;
  negativeRef.current = characterNegativePrompt;
  const extrasSync = useMemo(() => ({
    capture: () => ({
      characterNegativePrompt: negativeRef.current,
      generation: { ...generationRef.current },
    }),
    restore: (extras: UndoExtras) => {
      if (extras.characterNegativePrompt !== undefined) setCharacterNegativePrompt(extras.characterNegativePrompt);
      if (extras.generation) setGeneration((current) => ({ ...current, ...extras.generation }));
    },
  }), []);
  const [fileDrops, setFileDrops] = useState(0);
  const history = useTagUndo(workspace, rawDispatch, { activeId, setActiveId }, extrasSync);
  const store: PresetStore = {
    presets,
    setPresets,
    activeId,
    setActiveId,
    persistence: [
      { status: 'idle', loaded: true, error: null },
      { status: 'idle', loaded: true, error: null },
    ],
  };
  const dispatch = (action: WorkspaceAction) => history.dispatch(action);
  return (
    <DialogProvider>
      <div className="drop-probe" data-drops={fileDrops} onDrop={() => setFileDrops((count) => count + 1)}>
      <PresetBar
        store={store}
        workspace={workspace}
        dispatch={history.dispatch}
        notify={setToast}
        generation={generation}
        characterNegativePrompt={characterNegativePrompt}
        settingsReady={settingsReady}
        workspaceReady={workspaceReady}
      />
      </div>
      <button type="button" onClick={() => setGeneration((current) => ({ ...current, mode: current.mode === 'furry' ? 'anime' : 'furry' }))}>
        モード切替
      </button>
      <button type="button" onClick={() => setGeneration((current) => ({ ...current, seed: 123 }))}>シード変更</button>
      <button type="button" onClick={() => setCharacterNegativePrompt('changed')}>ネガティブ変更</button>
      <button type="button" onClick={() => dispatch({ type: 'add', target: 'base', category: 'quality', tag: 'hat' })}>タグ追加</button>
      <button type="button" onClick={() => history.undo()}>テスト取消</button>
      <output className="toast">{toast}</output>
      <output className="state" data-mode={generation.mode} data-seed={String(generation.seed)} data-negative={characterNegativePrompt} />
    </DialogProvider>
  );
}

async function renderHarness(props: {
  workspace?: Workspace;
  presets?: Preset[];
  activeId?: string | null;
  generation?: GenerationSettings;
  negative?: string;
  settingsReady?: boolean;
  workspaceReady?: boolean;
}) {
  await act(async () => root.render(
    <Harness
      initialWorkspace={props.workspace ?? emptyWorkspace()}
      initialPresets={props.presets ?? []}
      initialActiveId={props.activeId ?? null}
      initialGeneration={props.generation ?? { ...DEFAULT_GENERATION, mode: 'furry', seed: 7 }}
      initialNegative={props.negative ?? 'lowres'}
      settingsReady={props.settingsReady}
      workspaceReady={props.workspaceReady}
    />,
  ));
}

const state = () => container.querySelector<HTMLOutputElement>('output.state')!;
const saveDialog = () => Array.from(container.querySelectorAll('dialog')).find((dialog) => dialog.textContent?.includes('プリセットを保存'));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  dialogMethods.forEach((name, index) => {
    const descriptor = originalDialogMethods[index];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

it('saves generation settings when asked and restores them without the seed', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  await renderHarness({ workspace });
  await click(button('新しいプリセットとして保存'));
  const dialog = saveDialog();
  if (!dialog) throw new Error('保存ダイアログがありません');
  const name = dialog.querySelector('input[type="text"]') as HTMLInputElement;
  const checkbox = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(document.activeElement).toBe(name);
  expect(name.selectionStart).toBe(0);
  expect(name.selectionEnd).toBe(0);
  expect(checkbox.checked).toBe(true);
  expect(dialog.textContent).toContain('ケモノ · 縦 832×1216 · 28 steps · スケール 5 · Euler Ancestral');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(name, 'ケモノ用');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const closeSpy = vi.spyOn(dialog as HTMLDialogElement, 'close');
  await click(button('保存', dialog));
  expect(closeSpy).toHaveBeenCalled();
  expect(container.querySelector('.toast')?.textContent).toContain('プリセット「ケモノ用」に保存しました');

  await click(button('新規'));
  await click(button('モード切替'));
  await click(button('ネガティブ変更'));
  await click(button('シード変更'));
  expect(state().dataset).toMatchObject({ mode: 'anime', seed: '123', negative: 'changed' });

  const search = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { search.focus(); });
  expect(container.textContent).toContain('ケモノ');
  await click(container.querySelector('[role="option"]')!);
  expect(container.querySelector('.toast')?.textContent).toContain('「ケモノ用」を読み込みました（生成設定も反映）');
  expect(state().dataset).toMatchObject({ mode: 'furry', seed: '123', negative: 'lowres' });
  expect(search.value).toBe('ケモノ用');

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  });
  expect(state().dataset).toMatchObject({ mode: 'anime', seed: '123', negative: 'changed' });
  expect(container.querySelector<HTMLInputElement>('.preset-search input')!.value).toBe('');

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
  });
  expect(state().dataset).toMatchObject({ mode: 'furry', seed: '123', negative: 'lowres' });
  expect(container.querySelector<HTMLInputElement>('.preset-search input')!.value).toBe('ケモノ用');
});

it('keeps a tag-only preset free of generation settings when overwriting', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  const preset = createPreset('タグのみ', workspace);
  await renderHarness({ workspace, presets: [preset], activeId: preset.id, generation: { ...DEFAULT_GENERATION, seed: 4 }, negative: 'blurry' });
  await click(button('モード切替'));
  await click(button('ネガティブ変更'));
  expect(container.textContent).not.toContain('変更あり');
  await click(button('タグ追加'));
  expect(container.textContent).toContain('変更あり');
  await click(button('変更を上書き'));
  expect(container.textContent).not.toContain('変更あり');

  await click(button('新規'));
  const search = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { search.focus(); });
  const option = container.querySelector('[role="option"]')!;
  expect(option.textContent).toBe('タグのみ');
  expect(option.querySelector('.preset-mode-chip')).toBeNull();
  await click(option);
  expect(state().dataset.mode).toBe('furry');
  expect(state().dataset.negative).toBe('changed');
  expect(container.querySelector('.toast')?.textContent).toBe('「タグのみ」を読み込みました');
});

it('overwrites generation on a generation preset and can remove it by saving the same name', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  const preset = createPreset('基本', workspace, {
    generation: { ...DEFAULT_GENERATION, mode: 'anime' },
    characterNegativePrompt: 'blurry',
  });
  await renderHarness({
    workspace,
    presets: [preset],
    activeId: preset.id,
    generation: { ...DEFAULT_GENERATION, seed: 8 },
    negative: 'blurry',
  });
  await click(button('シード変更'));
  expect(container.textContent).not.toContain('変更あり');
  await click(button('モード切替'));
  expect(container.textContent).toContain('変更あり');
  await click(button('変更を上書き'));
  expect(container.textContent).not.toContain('変更あり');

  await click(button('新しいプリセットとして保存'));
  const dialog = saveDialog();
  if (!dialog) throw new Error('保存ダイアログがありません');
  const name = dialog.querySelector('input[type="text"]') as HTMLInputElement;
  expect(name.value).toBe('基本');
  expect(name.selectionStart).toBe(0);
  expect(name.selectionEnd).toBe(name.value.length);
  const checkbox = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  await click(checkbox);
  expect(dialog.textContent).not.toContain('steps');
  await click(button('保存', dialog));
  await click(button('上書き'));
  const search = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { search.focus(); });
  const option = container.querySelector('[role="option"]')!;
  expect(option.querySelector('.preset-mode-chip')).toBeNull();
});

it('does not open a PNG import when a file is dropped on the save dialog', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  await renderHarness({ workspace });
  await click(button('新しいプリセットとして保存'));
  const dialog = saveDialog();
  if (!dialog) throw new Error('保存ダイアログがありません');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
  await act(async () => { dialog.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(container.querySelector('.drop-probe')?.getAttribute('data-drops')).toBe('0');
  expect(saveDialog()).toBe(dialog);
});

it('does not write generation settings before they have loaded', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  const preset = createPreset('基本', workspace, {
    generation: { ...DEFAULT_GENERATION, mode: 'anime' },
    characterNegativePrompt: 'blurry',
  });
  await renderHarness({
    workspace,
    presets: [preset],
    activeId: preset.id,
    generation: { ...DEFAULT_GENERATION, mode: 'furry' },
    negative: 'changed',
    settingsReady: false,
  });
  expect(container.textContent).toContain('変更あり');
  await click(button('変更を上書き'));
  expect(container.querySelector('.toast')?.textContent).toBe('生成設定を読み込めていないため、上書きできません');
  expect(container.textContent).toContain('変更あり');

  await click(button('新しいプリセットとして保存'));
  const dialog = saveDialog();
  if (!dialog) throw new Error('保存ダイアログがありません');
  const checkbox = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(checkbox.disabled).toBe(true);
  expect(checkbox.checked).toBe(false);
  expect(dialog.textContent).toContain('タグだけ保存できます');
  const name = dialog.querySelector('input[type="text"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(name, 'タグだけ');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(button('保存', dialog));
  const search = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { search.focus(); });
  const options = [...container.querySelectorAll('[role="option"]')];
  expect(options.map((option) => option.textContent)).toContain('タグだけ');
  expect(options.find((option) => option.textContent?.includes('タグだけ'))?.querySelector('.preset-mode-chip')).toBeNull();
  expect(options.find((option) => option.textContent?.includes('基本'))?.querySelector('.preset-mode-chip')?.textContent).toBe('アニメ');
});

function optionNamed(name: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.includes(name));
  if (!found) throw new Error(`候補がありません: ${name}`);
  return found;
}

it('checks the generation option once settings finish loading', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  const preset = createPreset('基本', workspace, {
    generation: { ...DEFAULT_GENERATION, mode: 'anime' },
    characterNegativePrompt: 'blurry',
  });
  const props = {
    workspace,
    presets: [preset],
    activeId: preset.id,
    generation: { ...DEFAULT_GENERATION, mode: 'furry' as const },
    negative: 'changed',
    settingsReady: false as const,
  };
  await renderHarness(props);
  await click(button('新しいプリセットとして保存'));
  const dialog = saveDialog();
  if (!dialog) throw new Error('保存ダイアログがありません');
  const checkbox = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(checkbox.disabled).toBe(true);
  expect(checkbox.checked).toBe(false);

  await renderHarness({ ...props, settingsReady: true });
  const ready = saveDialog();
  if (!ready) throw new Error('保存ダイアログが閉じています');
  const readyCheckbox = ready.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(readyCheckbox.disabled).toBe(false);
  expect(readyCheckbox.checked).toBe(true);
  expect(ready.textContent).toContain('ケモノ · 縦 832×1216 · 28 steps · スケール 5 · Euler Ancestral');
});

it('does not switch presets when overwrite is blocked', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  const current = createPreset('基本', workspace, {
    generation: { ...DEFAULT_GENERATION, mode: 'anime' },
    characterNegativePrompt: 'blurry',
  });
  const other = createPreset('別', workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'hat' }));
  await renderHarness({
    workspace,
    presets: [current, other],
    activeId: current.id,
    generation: { ...DEFAULT_GENERATION, mode: 'furry' },
    negative: 'changed',
    settingsReady: false,
  });
  const search = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { search.focus(); });
  await click(optionNamed('別'));
  await click(button('変更を反映してから読み込む'));
  expect(container.querySelector('.toast')?.textContent).toBe('生成設定を読み込めていないため、上書きできません');
  expect(container.querySelector<HTMLInputElement>('.preset-search input')!.value).toBe('基本');
  expect(state().dataset.mode).toBe('furry');
  expect(container.textContent).toContain('変更あり');

  await click(button('新規'));
  await click(button('変更を反映してから新規作成'));
  expect(container.querySelector('.toast')?.textContent).toBe('生成設定を読み込めていないため、上書きできません');
  expect(container.querySelector<HTMLInputElement>('.preset-search input')!.value).toBe('基本');
  expect(container.textContent).toContain('変更あり');
});

it('does not load a generation preset before settings are read', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  const current = createPreset('タグのみ', workspace);
  const generationPreset = createPreset('ケモノ用', workspace, {
    generation: { ...DEFAULT_GENERATION, mode: 'furry' },
    characterNegativePrompt: 'lowres',
  });
  const props = {
    workspace,
    presets: [current, generationPreset],
    activeId: current.id,
    generation: { ...DEFAULT_GENERATION, mode: 'anime' as const },
    negative: 'blurry',
    settingsReady: false as const,
  };
  await renderHarness(props);
  expect(container.textContent).not.toContain('変更あり');
  const search = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { search.focus(); });
  await click(optionNamed('ケモノ用'));
  expect(container.querySelector('.toast')?.textContent).toBe('生成設定を読み込めていないため、このプリセットは読み込めません');
  expect(state().dataset).toMatchObject({ mode: 'anime', negative: 'blurry' });
  expect(container.querySelector<HTMLInputElement>('.preset-search input')!.value).toBe('タグのみ');

  await renderHarness({ ...props, settingsReady: true });
  const readySearch = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { readySearch.focus(); });
  await click(optionNamed('ケモノ用'));
  expect(container.querySelector('.toast')?.textContent).toBe('「ケモノ用」を読み込みました（生成設定も反映）');
  expect(state().dataset).toMatchObject({ mode: 'furry', negative: 'lowres' });
  expect(container.querySelector<HTMLInputElement>('.preset-search input')!.value).toBe('ケモノ用');
});

it('does not overwrite the current preset when the destination cannot be loaded yet', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  const current = createPreset('タグのみ', workspace);
  const generationPreset = createPreset('ケモノ用', workspaceReducer(workspace, { type: 'add', target: 'base', category: 'quality', tag: 'hat' }), {
    generation: { ...DEFAULT_GENERATION, mode: 'furry' },
    characterNegativePrompt: 'lowres',
  });
  await renderHarness({
    workspace: workspaceReducer(workspace, { type: 'add', target: 'base', category: 'quality', tag: 'bow' }),
    presets: [current, generationPreset],
    activeId: current.id,
    generation: { ...DEFAULT_GENERATION, mode: 'anime' },
    negative: 'blurry',
    settingsReady: false,
  });
  expect(container.textContent).toContain('変更あり');
  const search = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { search.focus(); });
  await click(optionNamed('ケモノ用'));
  expect(container.querySelector('.toast')?.textContent).toBe('生成設定を読み込めていないため、このプリセットは読み込めません');
  expect(container.textContent).not.toContain('変更を反映してから読み込む');
  expect(container.querySelector<HTMLInputElement>('.preset-search input')!.value).toBe('タグのみ');
  expect(container.textContent).toContain('変更あり');
});

it('does not load a generation preset before the workspace has been restored', async () => {
  const workspace = workspaceReducer(emptyWorkspace(), { type: 'add', target: 'base', category: 'quality', tag: 'solo' });
  const current = createPreset('タグのみ', workspace);
  const generationPreset = createPreset('ケモノ用', workspace, {
    generation: { ...DEFAULT_GENERATION, mode: 'furry' },
    characterNegativePrompt: 'lowres',
  });
  await renderHarness({
    workspace,
    presets: [current, generationPreset],
    activeId: current.id,
    generation: { ...DEFAULT_GENERATION, mode: 'anime' },
    negative: 'blurry',
    workspaceReady: false,
  });
  const search = container.querySelector<HTMLInputElement>('.preset-search input')!;
  await act(async () => { search.focus(); });
  await click(optionNamed('ケモノ用'));
  expect(container.querySelector('.toast')?.textContent).toBe('作業状態を読み込めていないため、このプリセットは読み込めません');
  expect(state().dataset).toMatchObject({ mode: 'anime', negative: 'blurry' });
  expect(container.querySelector<HTMLInputElement>('.preset-search input')!.value).toBe('タグのみ');
});
