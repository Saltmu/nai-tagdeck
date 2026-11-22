// @vitest-environment jsdom
import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../src/components/Dialogs';
import { Editor } from '../src/components/Editor';
import { useTagUndo } from '../src/hooks/useTagUndo';
import { emptyWorkspace, workspaceReducer } from '../src/lib/workspace';
import type { Dictionary } from '../src/hooks/useDictionary';
import type { PresetStore } from '../src/hooks/usePresets';
import type { Workspace } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const mockDictionary = (): Dictionary => ({
  entries: [],
  loaded: true,
  error: null,
  save: async () => {},
  saveMany: async () => {},
  remove: async () => {},
  importEntries: async () => 0,
  restoreInitial: async () => 0,
});

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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createMultiCharWorkspace(): Workspace {
  let ws = emptyWorkspace();
  for (const name of ['アリス', 'ボブ', 'キャロル']) {
    ws = workspaceReducer(ws, { type: 'addCharacter' });
    ws = workspaceReducer(ws, { type: 'renameCharacter', id: ws.characters.at(-1)!.id, name });
  }
  // アリスは位置指定 ON (0.5, 0.5)
  ws = workspaceReducer(ws, {
    type: 'setCharacterCenter',
    id: ws.characters[0]!.id,
    center: { x: 0.5, y: 0.5 },
  });
  // ボブは位置指定 ON (0.8, 0.2)
  ws = workspaceReducer(ws, {
    type: 'setCharacterCenter',
    id: ws.characters[1]!.id,
    center: { x: 0.8, y: 0.2 },
  });
  // キャロルは ON だが位置未指定（中央 0.5, 0.5 として自動表示される）
  // 4人目（デイブ）は OFF（ピッカーには表示しない）
  ws = workspaceReducer(ws, { type: 'addCharacter' });
  ws = workspaceReducer(ws, { type: 'renameCharacter', id: ws.characters.at(-1)!.id, name: 'デイブ' });
  ws = workspaceReducer(ws, { type: 'toggleCharacter', id: ws.characters.at(-1)!.id });
  return ws;
}

describe('CharacterCenterPicker', () => {
  it('renders canvas aspect ratio, peer markers, and syncs 5x5 grid, pointer drag, keyboard, and NumberField inputs', async () => {
    const initial = createMultiCharWorkspace();
    let latestWs = initial;
    const dictionary = mockDictionary();
    const presets = mockPresets();

    function Harness({ size = { width: 1216, height: 832 } }: { size?: { width: number; height: number } }) {
      const [workspace, rawDispatch] = useReducer(workspaceReducer, initial);
      latestWs = workspace;
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
            presets={presets}
            characterNegative=""
            onCharacterNegativeChange={() => {}}
            canvasSize={size}
            shown
          />
        </DialogProvider>
      );
    }

    await act(async () => root.render(<Harness />));

    // アリスのタブを開く
    const aliceTab = [...container.querySelectorAll<HTMLButtonElement>('.editor-tab-character')].find(
      (btn) => btn.textContent === 'アリス',
    )!;
    await act(async () => aliceTab.click());

    const stage = container.querySelector<HTMLDivElement>('.center-stage')!;
    expect(stage).not.toBeNull();
    expect(stage.style.aspectRatio).toBe('1216 / 832');
    expect(container.querySelector('.center-stage-caption')?.textContent).toContain('1216×832');

    // 自分（アリス）と他の ON キャラクター（ボブ、キャロル）が表示され、OFF のデイブは表示されない
    const activeMarker = stage.querySelector<HTMLElement>('.center-marker-active')!;
    expect(activeMarker.textContent).toBe('アリス');
    expect(activeMarker.style.left).toBe('50%');
    expect(activeMarker.style.top).toBe('50%');

    const peerMarkers = [...stage.querySelectorAll<HTMLElement>('.center-marker-peer')];
    expect(peerMarkers.map((m) => m.textContent)).toEqual(['ボブ', 'キャロル']);
    expect(peerMarkers[0]!.style.left).toBe('80%');
    expect(peerMarkers[0]!.style.top).toBe('20%');
    expect(peerMarkers[0]!.classList.contains('is-auto')).toBe(false);
    // キャロルは未指定なので (50%, 50%) に is-auto で表示
    expect(peerMarkers[1]!.style.left).toBe('50%');
    expect(peerMarkers[1]!.style.top).toBe('50%');
    expect(peerMarkers[1]!.classList.contains('is-auto')).toBe(true);

    // 5×5 グリッドのセル B4 (x=0.3, y=0.7) をクリック
    const cellB4 = [...container.querySelectorAll<HTMLButtonElement>('.center-preset-cell')].find(
      (btn) => btn.textContent === 'B4',
    )!;
    expect(cellB4.getAttribute('aria-pressed')).toBe('false');
    await act(async () => cellB4.click());
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.3, y: 0.7 });
    expect(cellB4.getAttribute('aria-pressed')).toBe('true');
    expect(activeMarker.style.left).toBe('30%');
    expect(activeMarker.style.top).toBe('70%');

    // 数値入力欄とも同期していることを確認
    const numberInputs = [...container.querySelectorAll<HTMLInputElement>('.center-grid input[type="number"]')];
    expect(numberInputs.map((i) => i.value)).toEqual(['0.3', '0.7']);

    // 数値入力欄からの変更がピッカーに反映されることを確認
    const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      numberInputs[0]!.focus();
      setNativeValue.call(numberInputs[0]!, '0.42');
      numberInputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
      numberInputs[0]!.blur();
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.42, y: 0.7 });
    expect(activeMarker.style.left).toBe('42%');
    expect(cellB4.getAttribute('aria-pressed')).toBe('false');

    // キーボード操作（矢印キーで 0.05、Shift+矢印で 0.01、Home で 0.5, 0.5）
    await act(async () => {
      stage.focus();
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.47, y: 0.7 });

    await act(async () => {
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }));
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.47, y: 0.69 });

    await act(async () => {
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.5, y: 0.5 });

    // フォーカスを一度外してからドラッグを開始すると、キーボード操作とは別ステップになり、ドラッグ中の連続移動は 1 ステップにまとまる
    await act(async () => {
      stage.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

    // ポインターのクリック＆ドラッグ（小数第2位丸めと範囲外クランプ、1回のUndoにまとまること）
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      width: 200,
      height: 100,
      right: 300,
      bottom: 300,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });

    await act(async () => {
      stage.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 150, // (150-100)/200 = 0.25
          clientY: 225, // (225-200)/100 = 0.25
        }),
      );
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.25, y: 0.25 });

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 233, // (233-100)/200 = 0.665 -> 0.67
          clientY: 350, // (350-200)/100 = 1.5 -> clamped to 1
        }),
      );
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.67, y: 1 });

    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });

    // ドラッグ中の連続更新が 1 ステップで Undo され、ドラッグ直前の (0.5, 0.5) に戻ること
    const undoBtn = container.querySelector<HTMLButtonElement>('button[aria-label="元に戻す"]')!;
    await act(async () => undoBtn.click());
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.5, y: 0.5 });
  });
});
