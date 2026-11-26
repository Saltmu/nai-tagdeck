import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { diffGenerationSettings, type GenerationSettings } from '../lib/generation';
import type { Workspace } from '../types';
import { workspaceReducer, type WorkspaceAction } from '../lib/workspace';

const HISTORY_LIMIT = 100;
/** ドラッグ中の moveTo は連続するので、この間隔以内なら 1 ステップにまとめる。 */
const DRAG_MERGE_MS = 500;
/** 重み入力とキャラクター名は、この間隔を空けるか欄を離れたら別のステップにする。 */
const EDIT_MERGE_MS = 3000;

/** PNG 読み込みなど、ワークスペースと同時に変えた値。指定した項目だけをそのステップで戻す。 */
export interface UndoExtras {
  characterNegativePrompt?: string;
  /** 適用で値が変わった生成項目だけ。 */
  generation?: Partial<GenerationSettings>;
}

interface ExtrasChange {
  before: UndoExtras;
  after: UndoExtras;
}

/** 変更前の値を取り、Undo / Redo で指定項目だけ戻す。 */
export interface UndoExtrasSync {
  capture: () => { characterNegativePrompt: string; generation: GenerationSettings };
  restore: (extras: UndoExtras) => void;
}

interface PastStep {
  before: Workspace;
  activePresetId: string | null;
  extras?: ExtrasChange;
}

interface FutureStep {
  state: Workspace;
  activePresetId: string | null;
  extras?: ExtrasChange;
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

function isUndoFocusScopedControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isTextEntry(target)) return true;
  return target.closest('[data-undo-merge]') !== null;
}

function sameTag(a: WorkspaceAction, b: WorkspaceAction): boolean {
  if (a.type === 'moveTag' || b.type === 'moveTag') return false;
  if (!('id' in a) || !('id' in b) || !('target' in a) || !('target' in b)) return false;
  if (!('category' in a) || !('category' in b)) return false;
  return a.id === b.id && a.target === b.target && a.category === b.category;
}

function freezeExtras(
  after: UndoExtras,
  current: { characterNegativePrompt: string; generation: GenerationSettings },
): ExtrasChange | undefined {
  const before: UndoExtras = {};
  const frozen: UndoExtras = {};
  if (after.characterNegativePrompt !== undefined && after.characterNegativePrompt !== current.characterNegativePrompt) {
    before.characterNegativePrompt = current.characterNegativePrompt;
    frozen.characterNegativePrompt = after.characterNegativePrompt;
  }
  if (after.generation !== undefined) {
    const diff = diffGenerationSettings(current.generation, after.generation);
    if (diff) {
      before.generation = diff.before;
      frozen.generation = diff.after;
    }
  }
  if (frozen.characterNegativePrompt === undefined && frozen.generation === undefined) return undefined;
  return { before, after: frozen };
}

/**
 * ワークスペース操作を 1 ステップずつ取り消す・やり直す。
 * 入力中の重み、キャラクター名、個別ネガティブ、位置、ドラッグ中の並び替えだけを 1 ステップにまとめる。
 * 欄を離れる、または 3 秒空くと、そのまとまりは終わる。
 * テキスト入力中の Ctrl/Cmd+Z は入力欄に任せ、ダイアログ表示中は反応しない。
 * 永続化の読み込みなど、この dispatch を通らない置換は次の描画で履歴を捨てる。
 * バックアップのように他の状態も同時に変わる置換は、描画前に discardHistory で捨てる。
 * 第2引数で渡した共通キャラネガティブと生成設定は、適用時に変わった項目だけをそのステップの Undo / Redo で戻す。
 * 生成設定や共通キャラネガティブの手入力は履歴に入らないため、Undo 時は適用前の値へ戻す。
 */
export function useTagUndo(
  workspace: Workspace,
  dispatch: Dispatch<WorkspaceAction>,
  preset?: PresetSelectionSync,
  extrasSync?: UndoExtrasSync,
  shortcutsDisabled = false,
) {
  const [past, setPast] = useState<PastStep[]>([]);
  const [future, setFuture] = useState<FutureStep[]>([]);
  const [status, setStatus] = useState('');
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  const ownedRef = useRef(workspace);
  const activeIdRef = useRef<string | null>(preset?.activeId ?? null);
  const setActiveIdRef = useRef(preset?.setActiveId);
  const extrasSyncRef = useRef(extrasSync);
  const lastActionRef = useRef<WorkspaceAction | null>(null);
  const lastControlRef = useRef<Element | null>(null);
  const lastAtRef = useRef(0);
  pastRef.current = past;
  futureRef.current = future;
  activeIdRef.current = preset?.activeId ?? null;
  setActiveIdRef.current = preset?.setActiveId;
  extrasSyncRef.current = extrasSync;

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

  const trackedDispatch = useCallback(
    (action: WorkspaceAction, extras?: UndoExtras) => {
      const before = ownedRef.current;
      const after = workspaceReducer(before, action);
      const sync = extrasSyncRef.current;
      const extrasChange = extras && sync ? freezeExtras(extras, sync.capture()) : undefined;
      if (after === before && !extrasChange) {
        dispatch(action);
        return;
      }
      const now = Date.now();
      const previous = lastActionRef.current;
      const activeControl = document.activeElement;
      const sameControl = activeControl !== null && activeControl === lastControlRef.current;
      const editing = sameControl && isTextEntry(activeControl);
      const sameCenterMerge =
        action.type === 'setCharacterCenter' &&
        previous?.type === 'setCharacterCenter' &&
        previous.id === action.id &&
        (action.mergeKey !== undefined
          ? action.mergeKey === previous.mergeKey &&
            (action.mergeKey.startsWith('drag-') || (sameControl && now - lastAtRef.current < EDIT_MERGE_MS))
          : previous.mergeKey === undefined && editing && now - lastAtRef.current < EDIT_MERGE_MS);
      const merge =
        !extrasChange &&
        previous !== null &&
        previous.type === action.type &&
        (sameCenterMerge ||
          ((action.type === 'renameCharacter' || action.type === 'setCharacterNegative') &&
            previous.type === action.type &&
            'id' in previous &&
            previous.id === action.id &&
            editing &&
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
          { before, activePresetId: activeIdRef.current, extras: extrasChange },
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
      if (after !== before) {
        ownedRef.current = after;
        dispatch({ type: 'commit', workspace: after });
      }
      if (extrasChange) sync?.restore(extrasChange.after);
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
      { state: current, activePresetId: currentPresetId, extras: step.extras },
    ];
    futureRef.current = nextFuture;
    setFuture(nextFuture);
    lastActionRef.current = null;
    apply(step.before, step.activePresetId);
    if (step.extras) extrasSyncRef.current?.restore(step.extras.before);
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
      { before: current, activePresetId: currentPresetId, extras: step.extras },
    ];
    pastRef.current = nextPast;
    setPast(nextPast);
    lastActionRef.current = null;
    apply(step.state, step.activePresetId);
    if (step.extras) extrasSyncRef.current?.restore(step.extras.after);
    setStatus(`やり直しました。やり直せる操作は残り ${nextFuture.length} 件です。`);
  }, [apply]);

  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const shortcutsDisabledRef = useRef(shortcutsDisabled);
  undoRef.current = undo;
  redoRef.current = redo;
  shortcutsDisabledRef.current = shortcutsDisabled;

  useEffect(() => {
    const onFocusOut = (event: FocusEvent) => {
      if (isUndoFocusScopedControl(event.target)) {
        lastActionRef.current = null;
        lastControlRef.current = null;
      }
    };
    document.addEventListener('focusout', onFocusOut);
    return () => document.removeEventListener('focusout', onFocusOut);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shortcutsDisabledRef.current) return;
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

  // 描画前に呼ぶ。永続化の読み込みと同じく履歴は捨てるが、次の描画を待たない。
  // 待っていると、置換を積んだ直後の Ctrl+Z が読み込み前の作業状態を戻す。
  const discardHistory = useCallback(() => {
    lastActionRef.current = null;
    lastControlRef.current = null;
    const hadHistory = pastRef.current.length > 0 || futureRef.current.length > 0;
    pastRef.current = [];
    futureRef.current = [];
    if (!hadHistory) return;
    setPast([]);
    setFuture([]);
    setStatus('');
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  return {
    dispatch: trackedDispatch,
    discardHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    status,
  };
}
