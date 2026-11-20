import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { Workspace } from '../types';
import { tagsOf, workspaceReducer, type WorkspaceAction } from '../lib/workspace';

const HISTORY_LIMIT = 100;
/** ドラッグ中の moveTo は連続するので、この間隔以内なら 1 ステップにまとめる。 */
const DRAG_MERGE_MS = 500;
/** 重み入力とキャラクター名は、この間隔を空けるか欄を離れたら別のステップにする。 */
const EDIT_MERGE_MS = 3000;

interface PastStep {
  before: Workspace;
  label: string;
}

interface FutureStep {
  state: Workspace;
  label: string;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'file', 'color', 'submit', 'reset', 'image', 'hidden'].includes(type);
}

function tagText(state: Workspace, action: WorkspaceAction): string | undefined {
  if (action.type === 'moveFromUnclassified') {
    return tagsOf(state, action.target, 'unclassified')?.find((tag) => tag.id === action.id)?.tag;
  }
  if (!('target' in action) || !('category' in action)) return undefined;
  const tags = tagsOf(state, action.target, action.category);
  if (!tags) return undefined;
  if (action.type === 'add') return action.tag.trim();
  if (action.type === 'pickOne') return action.tag ?? undefined;
  if ('id' in action) return tags.find((tag) => tag.id === action.id)?.tag;
  return undefined;
}

function actionLabel(before: Workspace, action: WorkspaceAction): string {
  const tag = tagText(before, action);
  const quoted = tag ? `「${tag}」` : 'タグ';
  switch (action.type) {
    case 'add':
      return `${quoted}を追加しました`;
    case 'toggle':
      return `${quoted}のON/OFFを切り替えました`;
    case 'setWeight':
      return `${quoted}の重みを変更しました`;
    case 'setTag':
      return `${quoted}の名前を変更しました`;
    case 'remove':
      return `${quoted}を削除しました`;
    case 'restore':
      return `${quoted}を元に戻しました`;
    case 'move':
    case 'moveTo':
      return `${quoted}の順番を変更しました`;
    case 'setAll':
      return action.enabled ? 'タグをすべてONにしました' : 'タグをすべてOFFにしました';
    case 'pickOne':
      return action.tag === null ? 'よく使うタグを解除しました' : `${quoted}を選びました`;
    case 'moveFromUnclassified':
      return `${quoted}を移動しました`;
    case 'addCharacter':
      return 'キャラクターを追加しました';
    case 'removeCharacter':
      return 'キャラクターを削除しました';
    case 'renameCharacter':
      return 'キャラクター名を変更しました';
    case 'toggleCharacter':
      return 'キャラクターのON/OFFを切り替えました';
    case 'moveCharacter':
      return 'キャラクターの順番を変更しました';
    case 'replace':
    case 'commit':
      return '作業内容を置き換えました';
  }
}

function sameTag(a: WorkspaceAction, b: WorkspaceAction): boolean {
  if (a.type === 'moveFromUnclassified' || b.type === 'moveFromUnclassified') return false;
  if (!('id' in a) || !('id' in b) || !('target' in a) || !('target' in b)) return false;
  if (!('category' in a) || !('category' in b)) return false;
  return a.id === b.id && a.target === b.target && a.category === b.category;
}

/**
 * ワークスペース操作を 1 ステップずつ取り消す・やり直す。
 * 入力中の重み変更とキャラクター名、ドラッグ中の並び替えだけを 1 ステップにまとめる。
 * 欄を離れる、通知を閉じる、または 3 秒空くと、そのまとまりは終わる。
 * テキスト入力中の Ctrl/Cmd+Z は入力欄に任せ、ダイアログ表示中は反応しない。
 * 永続化の読み込みなど、この dispatch を通らない置換は履歴を捨てる。
 */
export function useTagUndo(
  workspace: Workspace,
  dispatch: Dispatch<WorkspaceAction>,
  notify: (message: string) => void,
) {
  const [past, setPast] = useState<PastStep[]>([]);
  const [future, setFuture] = useState<FutureStep[]>([]);
  const [barHidden, setBarHidden] = useState(false);
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  const ownedRef = useRef(workspace);
  const lastActionRef = useRef<WorkspaceAction | null>(null);
  const lastAtRef = useRef(0);
  pastRef.current = past;
  futureRef.current = future;

  // 永続化の読み込みなど、このフックを通らない更新は履歴と対応しないので捨てる。
  if (workspace !== ownedRef.current) {
    ownedRef.current = workspace;
    lastActionRef.current = null;
    if (pastRef.current.length > 0 || futureRef.current.length > 0) {
      pastRef.current = [];
      futureRef.current = [];
      setPast([]);
      setFuture([]);
    }
  }

  const apply = useCallback(
    (snapshot: Workspace) => {
      ownedRef.current = snapshot;
      dispatch({ type: 'commit', workspace: snapshot });
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
      const editing = isTextEntry(document.activeElement);
      const merge =
        previous !== null &&
        previous.type === action.type &&
        ((action.type === 'renameCharacter' &&
          previous.type === 'renameCharacter' &&
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
      lastAtRef.current = now;
      if (!merge || pastRef.current.length === 0) {
        const next = [...pastRef.current, { before, label: actionLabel(before, action) }];
        if (next.length > HISTORY_LIMIT) next.shift();
        pastRef.current = next;
        setPast(next);
      }
      if (futureRef.current.length > 0) {
        futureRef.current = [];
        setFuture([]);
      }
      setBarHidden(false);
      ownedRef.current = after;
      dispatch({ type: 'commit', workspace: after });
    },
    [dispatch],
  );

  const undo = useCallback(() => {
    const step = pastRef.current.at(-1);
    if (!step) return;
    const current = ownedRef.current;
    const nextPast = pastRef.current.slice(0, -1);
    pastRef.current = nextPast;
    setPast(nextPast);
    const nextFuture = [...futureRef.current, { state: current, label: step.label }];
    futureRef.current = nextFuture;
    setFuture(nextFuture);
    lastActionRef.current = null;
    setBarHidden(false);
    apply(step.before);
    notify('元に戻しました');
  }, [apply, notify]);

  const redo = useCallback(() => {
    const step = futureRef.current.at(-1);
    if (!step) return;
    const current = ownedRef.current;
    const nextFuture = futureRef.current.slice(0, -1);
    futureRef.current = nextFuture;
    setFuture(nextFuture);
    const nextPast = [...pastRef.current, { before: current, label: step.label }];
    pastRef.current = nextPast;
    setPast(nextPast);
    lastActionRef.current = null;
    setBarHidden(false);
    apply(step.state);
    notify('やり直しました');
  }, [apply, notify]);

  const dismiss = useCallback(() => {
    lastActionRef.current = null;
    setBarHidden(true);
  }, []);

  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  useEffect(() => {
    const onFocusOut = (event: FocusEvent) => {
      if (isTextEntry(event.target)) lastActionRef.current = null;
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
    dismiss,
    canUndo,
    canRedo,
    label: past.at(-1)?.label ?? null,
    barOpen: !barHidden && (canUndo || canRedo),
  };
}
