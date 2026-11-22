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

function pointerEvent(
  type: string,
  init: MouseEventInit & { pointerId?: number; pointerType?: string } = {},
): MouseEvent {
  const { pointerId = 1, pointerType = 'mouse', ...mouseInit } = init;
  const ev = new MouseEvent(type, {
    buttons: type === 'pointerup' ? 0 : 1,
    ...mouseInit,
  });
  Object.defineProperty(ev, 'pointerId', { value: pointerId });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  return ev;
}

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
    const id = ws.characters.at(-1)!.id;
    ws = workspaceReducer(ws, { type: 'renameCharacter', id, name });
    ws = workspaceReducer(ws, { type: 'add', target: id, category: 'subject', tag: 'girl' });
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
  // キャロルは ON かつタグありだが位置未指定（座標モード有効の間は中央 0.5, 0.5 として自動表示される）
  // 4人目（デイブ）は OFF（ピッカーには表示しない）
  ws = workspaceReducer(ws, { type: 'addCharacter' });
  const daveId = ws.characters.at(-1)!.id;
  ws = workspaceReducer(ws, { type: 'renameCharacter', id: daveId, name: 'デイブ' });
  ws = workspaceReducer(ws, { type: 'add', target: daveId, category: 'subject', tag: 'boy' });
  ws = workspaceReducer(ws, { type: 'toggleCharacter', id: daveId });
  return ws;
}

describe('CharacterCenterPicker', () => {
  it('renders canvas aspect ratio, peer markers, legend, roving tabIndex grid, pointerId isolation, and separate undo steps per drag', async () => {
    const initial = createMultiCharWorkspace();
    let latestWs = initial;
    const dictionary = mockDictionary();
    const presets = mockPresets();

    function Harness({ size = { width: 768, height: 1344 } }: { size?: { width: number; height: number } }) {
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
    // 縦長 768×1344 の比率と最大幅制約（maxWidth: Math.round(768 * 200 / 1344) = 114px）
    expect(stage.style.aspectRatio).toBe('768 / 1344');
    expect(stage.style.maxWidth).toBe('114px');
    expect(container.querySelector('.center-stage-caption')?.textContent).toContain('768×1344');

    // アリス (0.5, 0.5) と他の生成対象キャラ（ボブ、キャロル）がマーカーおよび一覧に表示され、OFF のデイブは表示されない
    const activeMarker = stage.querySelector<HTMLElement>('.center-marker-active')!;
    expect(activeMarker.textContent).toBe('アリス');
    expect(activeMarker.style.left).toBe('50%');
    expect(activeMarker.style.top).toBe('50%');

    const peerMarkers = [...stage.querySelectorAll<HTMLElement>('.center-marker-peer')];
    expect(peerMarkers.map((m) => m.textContent)).toEqual(['ボブ', 'キャロル']);
    expect(peerMarkers[0]!.style.left).toBe('80%');
    expect(peerMarkers[0]!.style.top).toBe('20%');
    expect(peerMarkers[0]!.classList.contains('is-auto')).toBe(false);
    // ラベルは x に比例した --marker-x とステージ幅に応じた --label-max-width を持つ
    const bobLabel = peerMarkers[0]!.querySelector<HTMLElement>('.center-marker-label')!;
    expect(bobLabel.style.getPropertyValue('--marker-x')).toBe('0.8');
    expect(bobLabel.style.getPropertyValue('--label-max-width')).toBe('104px');
    expect(peerMarkers[1]!.style.left).toBe('50%');
    expect(peerMarkers[1]!.style.top).toBe('50%');
    expect(peerMarkers[1]!.classList.contains('is-auto')).toBe(true);

    // 凡例（一覧）には近接・重複座標でも全キャラの名前と座標が明示される
    const legendItems = [...container.querySelectorAll<HTMLElement>('.center-legend-item')];
    expect(legendItems.map((li) => li.textContent)).toEqual([
      'アリス(0.50, 0.50)',
      'ボブ(0.80, 0.20)',
      'キャロル(0.50, 0.50) 中央自動',
    ]);

    // 5×5 グリッドは単一の Tab ストップ（roving tabIndex）になっており、初期状態 (0.5, 0.5) では C3 のみが tabIndex=0
    const allCells = [...container.querySelectorAll<HTMLButtonElement>('.center-preset-cell')];
    expect(allCells).toHaveLength(25);
    const tabStops = allCells.filter((btn) => btn.tabIndex === 0);
    expect(tabStops.map((btn) => btn.textContent)).toEqual(['C3']);

    // 矢印キーでグリッド内のフォーカスを移動できる（C3 -> ArrowLeft -> B3 -> ArrowDown -> B4）
    const cellC3 = tabStops[0]!;
    await act(async () => {
      cellC3.focus();
      cellC3.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('B3');
    expect((document.activeElement as HTMLButtonElement).tabIndex).toBe(0);
    expect(cellC3.tabIndex).toBe(-1);

    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const cellB4 = document.activeElement as HTMLButtonElement;
    expect(cellB4.textContent).toBe('B4');
    expect(cellB4.getAttribute('aria-pressed')).toBe('false');

    // B4 (x=0.3, y=0.7) をクリックして選択
    await act(async () => cellB4.click());
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.3, y: 0.7 });
    expect(cellB4.getAttribute('aria-pressed')).toBe('true');
    expect(activeMarker.style.left).toBe('30%');
    expect(activeMarker.style.top).toBe('70%');

    // 数値入力欄とも同期していることを確認
    const numberInputs = [...container.querySelectorAll<HTMLInputElement>('.center-grid input[type="number"]')];
    expect(numberInputs.map((i) => i.value)).toEqual(['0.3', '0.7']);

    // 数値入力欄からの変更がピッカーに反映されることを確認（グリッド外の座標では C3 がフォールバックの Tab ストップになる）
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
    expect(allCells.filter((btn) => btn.tabIndex === 0).map((btn) => btn.textContent)).toEqual(['C3']);

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

    // ポインターのクリック＆ドラッグ（フォーカスを外さずに連続してドラッグしても各ドラッグが独立した Undo ステップになること）
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

    // 1回目のドラッグ (pointerId: 10): (0.5, 0.5) -> (0.25, 0.25) -> (0.67, 1)
    await act(async () => {
      stage.dispatchEvent(
        pointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 10,
          clientX: 150, // (150-100)/200 = 0.25
          clientY: 225, // (225-200)/100 = 0.25
        }),
      );
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.25, y: 0.25 });

    // ドラッグ中に2本目の指（pointerId: 99）で pointerdown / pointermove / pointerup しても無視され、1本目のドラッグが継続すること
    await act(async () => {
      stage.dispatchEvent(
        pointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 99,
          clientX: 280,
          clientY: 290,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointermove', {
          bubbles: true,
          pointerId: 99,
          clientX: 100,
          clientY: 200,
        }),
      );
      window.dispatchEvent(pointerEvent('pointerup', { bubbles: true, pointerId: 99 }));
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.25, y: 0.25 });

    await act(async () => {
      window.dispatchEvent(
        pointerEvent('pointermove', {
          bubbles: true,
          pointerId: 10,
          clientX: 233, // (233-100)/200 = 0.665 -> 0.67
          clientY: 350, // (350-200)/100 = 1.5 -> clamped to 1
        }),
      );
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.67, y: 1 });
    // 下端付近（y > 0.78）ではラベルが上に回るクラス is-above が付く
    expect(activeMarker.classList.contains('is-above')).toBe(true);

    // ウィンドウ外でマウスボタンを離したまま戻ってきた場合（buttons: 0 の pointermove）は更新せずドラッグを終了すること
    await act(async () => {
      window.dispatchEvent(
        pointerEvent('pointermove', {
          bubbles: true,
          pointerId: 10,
          buttons: 0,
          clientX: 110,
          clientY: 210,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointermove', {
          bubbles: true,
          pointerId: 10,
          buttons: 1,
          clientX: 110,
          clientY: 210,
        }),
      );
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.67, y: 1 });

    // 2回目のドラッグ (pointerId: 11): (0.67, 1) -> (0.1, 0.1) -> (0.2, 0.3)
    await act(async () => {
      stage.dispatchEvent(
        pointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 11,
          clientX: 120,
          clientY: 210,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointermove', {
          bubbles: true,
          pointerId: 11,
          clientX: 140,
          clientY: 230,
        }),
      );
      window.dispatchEvent(pointerEvent('pointerup', { bubbles: true, pointerId: 11 }));
    });
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.2, y: 0.3 });

    // 1回目の Undo で2回目のドラッグ前の (0.67, 1) に戻る
    const undoBtn = container.querySelector<HTMLButtonElement>('button[aria-label="元に戻す"]')!;
    await act(async () => undoBtn.click());
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.67, y: 1 });

    // 2回目の Undo で1回目のドラッグ前の (0.5, 0.5) に戻る
    await act(async () => undoBtn.click());
    expect(latestWs.characters[0]!.center).toEqual({ x: 0.5, y: 0.5 });
  });

  it('does not show unpositioned peers at center (0.5, 0.5) when the only character with a center is OFF', async () => {
    let ws = emptyWorkspace();
    for (const name of ['アリス', 'キャロル']) {
      ws = workspaceReducer(ws, { type: 'addCharacter' });
      const id = ws.characters.at(-1)!.id;
      ws = workspaceReducer(ws, { type: 'renameCharacter', id, name });
      ws = workspaceReducer(ws, { type: 'add', target: id, category: 'subject', tag: 'girl' });
    }
    // アリスのみ位置指定を持つが、アリス自身を OFF にする（生成時は use_coords: false になる）
    const aliceId = ws.characters[0]!.id;
    ws = workspaceReducer(ws, { type: 'setCharacterCenter', id: aliceId, center: { x: 0.2, y: 0.3 } });
    ws = workspaceReducer(ws, { type: 'toggleCharacter', id: aliceId });

    const dictionary = mockDictionary();
    const presets = mockPresets();

    await act(async () =>
      root.render(
        <DialogProvider>
          <Editor
            workspace={ws}
            dispatch={() => {}}
            loaded
            dictionary={dictionary}
            syntax="brace"
            onCopy={() => {}}
            notify={() => {}}
            presets={presets}
            characterNegative=""
            onCharacterNegativeChange={() => {}}
            shown
          />
        </DialogProvider>,
      ),
    );

    const aliceTab = [...container.querySelectorAll<HTMLButtonElement>('.editor-tab-character')].find(
      (btn) => btn.textContent === 'アリス',
    )!;
    await act(async () => aliceTab.click());

    // 生成対象の ON キャラ（キャロル）は位置未指定かつ use_coords: false なのでステージ上に (0.5, 0.5) マーカーを出さない
    expect(container.querySelectorAll('.center-marker-peer')).toHaveLength(0);
    // 一覧では「位置指定なし」として明示される
    const legendItems = [...container.querySelectorAll<HTMLElement>('.center-legend-item')];
    expect(legendItems.map((li) => li.textContent)).toEqual([
      'アリス(0.20, 0.30)',
      'キャロル位置指定なし',
    ]);
  });
});
