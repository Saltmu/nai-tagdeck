import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { Workspace } from '../types';
import { workspaceReducer, type WorkspaceAction } from '../lib/workspace';

const HISTORY_LIMIT = 100;
/** ドラッグ中の moveTo は連続するので、この間隔以内なら 1 ステップにまとめる。 */
const DRAG_MERGE_MS = 500;
/** 重み入力とキャラクター名は、この間隔を空けるか欄を離れたら別のステップにする。 */
const EDIT_MERGE_MS = 3000;

interface PastStep {
  before: Workspace;
  activePresetId: string | null;
}

interface FutureStep {
  state: Workspace;
  activePresetId: string | null;
}

export interface PresetSelectionSync {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'file', 'color', 'submit', 'reset', 'image', 'hidden'].includes(type);
}

function isUndoMergedControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isTextEntry(target)) return true;
  return target.closest('[data-undo-merge]') !== null;
}

function sameTag(a: WorkspaceAction, b: WorkspaceAction): boolean {
  if (a.type === 'moveFromUnclassified' || b.type === 'moveFromUnclassified') return false;
  if (!('id' in a) || !('id' in b) || !('target' in a) || !('target' in b)) return false;
  if (!('category' in a) || !('category' in b)) return false;
  return a.id === b.id && a.target === b.target && a.category === b.category;
}

/**
 * ワークスペース操作を 1 ステップずつ取り消す・やり直す。
 * 入力中の重み、キャラクター名、個別ネガティブ、位置、ドラッグ中の並び替えだけを 1 ステップにまとめる。
 * 欄を離れる、または 3 秒空くと、そのまとまりは終わる。
 * テキスト入力中の Ctrl/Cmd+Z は入力欄に任せ、ダイアログ表示中は反応しない。
 * 永続化の読み込みなど、この dispatch を通らない置換は履歴を捨てる。
 */
export function useTagUndo(
  workspace: Workspace,
  dispatch: Dispatch<WorkspaceAction>,
  preset?: PresetSelectionSync,
) {
  const [past, setPast] = useState<PastStep[]>([]);
  const [future, setFuture] = useState<FutureStep[]>([]);
  const [status, setStatus] = useState('');
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  const ownedRef = useRef(workspace);
  const activeIdRef = useRef<string | null>(preset?.activeId ?? null);
  const setActiveIdRef = useRef(preset?.setActiveId);
  const lastActionRef = useRef<WorkspaceAction | null>(null);
  const lastControlRef = useRef<Element | null>(null);
  const lastAtRef = useRef(0);
  pastRef.current = past;
  futureRef.current = future;
  activeIdRef.current = preset?.activeId ?? null;
  setActiveIdRef.current = preset?.setActiveId;

  // 永続化の読み込みなど、このフックを通らない更新は履歴と対応しないので捨てる。
  if (workspace !== ownedRef.current) {
    ownedRef.current = workspace;
    lastActionRef.current = null;
    if (pastRef.current.length > 0 || futureRef.current.length > 0) {
      pastRef.current = [];
      futureRef.current = [];
      setPast([]);
      setFuture([]);
      setStatus('');
    }
  }

  const apply = useCallback(
    (snapshot: Workspace, activePresetId: string | null) => {
      ownedRef.current = snapshot;
      dispatch({ type: 'commit', workspace: snapshot });
      if (setActiveIdRef.current) {
        activeIdRef.current = activePresetId;
        setActiveIdRef.current(activePresetId);
      }
    },
    [dispatch],
  );

  const trackedDispatch = useCallback<Dispatch<WorkspaceAction>>(
    (action) => {
      const before = ownedRef.current;
      const after = workspaceReducer(before, action);
      if (after === before) {
        dispatch(action);
        return;
      }
      const now = Date.now();
      const previous = lastActionRef.current;
      const activeControl = document.activeElement;
      const sameControl = activeControl !== null && activeControl === lastControlRef.current;
      const editing = sameControl && isTextEntry(activeControl);
      const mergeControl = sameControl && isUndoMergedControl(activeControl);
      const merge =
        previous !== null &&
        previous.type === action.type &&
        (((action.type === 'renameCharacter' || action.type === 'setCharacterNegative' || action.type === 'setCharacterCenter') &&
          previous.type === action.type &&
          'id' in previous &&
          previous.id === action.id &&
          (action.type === 'setCharacterCenter' ? mergeControl : editing) &&
          now - lastAtRef.current < EDIT_MERGE_MS) ||
          (action.type === 'setWeight' &&
            previous.type === 'setWeight' &&
            sameTag(previous, action) &&
            editing &&
            now - lastAtRef.current < EDIT_MERGE_MS) ||
          (action.type === 'moveTo' &&
            previous.type === 'moveTo' &&
            sameTag(previous, action) &&
            now - lastAtRef.current < DRAG_MERGE_MS));
      lastActionRef.current = action;
      lastControlRef.current = activeControl;
      lastAtRef.current = now;
      if (!merge || pastRef.current.length === 0) {
        const next = [
          ...pastRef.current,
          { before, activePresetId: activeIdRef.current },
        ];
        if (next.length > HISTORY_LIMIT) next.shift();
        pastRef.current = next;
        setPast(next);
      }
      if (futureRef.current.length > 0) {
        futureRef.current = [];
        setFuture([]);
      }
      setStatus('');
      ownedRef.current = after;
      dispatch({ type: 'commit', workspace: after });
    },
    [dispatch],
  );

  const undo = useCallback(() => {
    const step = pastRef.current.at(-1);
    if (!step) return;
    const current = ownedRef.current;
    const currentPresetId = activeIdRef.current;
    const nextPast = pastRef.current.slice(0, -1);
    pastRef.current = nextPast;
    setPast(nextPast);
    const nextFuture = [
      ...futureRef.current,
      { state: current, activePresetId: currentPresetId },
    ];
    futureRef.current = nextFuture;
    setFuture(nextFuture);
    lastActionRef.current = null;
    apply(step.before, step.activePresetId);
    setStatus(`元に戻しました。元に戻せる操作は残り ${nextPast.length} 件です。`);
  }, [apply]);

  const redo = useCallback(() => {
    const step = futureRef.current.at(-1);
    if (!step) return;
    const current = ownedRef.current;
    const currentPresetId = activeIdRef.current;
    const nextFuture = futureRef.current.slice(0, -1);
    futureRef.current = nextFuture;
    setFuture(nextFuture);
    const nextPast = [
      ...pastRef.current,
      { before: current, activePresetId: currentPresetId },
    ];
    pastRef.current = nextPast;
    setPast(nextPast);
    lastActionRef.current = null;
    apply(step.state, step.activePresetId);
    setStatus(`やり直しました。やり直せる操作は残り ${nextFuture.length} 件です。`);
  }, [apply]);

  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  useEffect(() => {
    const onFocusOut = (event: FocusEvent) => {
      if (isUndoMergedControl(event.target)) {
        lastActionRef.current = null;
        lastControlRef.current = null;
      }
    };
    document.addEventListener('focusout', onFocusOut);
    return () => document.removeEventListener('focusout', onFocusOut);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (isTextEntry(event.target)) return;
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      const redoKey = key === 'y' || (key === 'z' && event.shiftKey);
      const undoKey = key === 'z' && !event.shiftKey;
      if (!redoKey && !undoKey) return;
      event.preventDefault();
      if (redoKey) redoRef.current();
      else undoRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  return {
    dispatch: trackedDispatch,
    undo,
    redo,
    canUndo,
    canRedo,
    status,
  };
}
