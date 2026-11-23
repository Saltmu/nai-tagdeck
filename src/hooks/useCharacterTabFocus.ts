import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch } from 'react';
import type { Character } from '../types';
import { BASE, NEGATIVE, type WorkspaceAction } from '../lib/workspace';

/** 消えたキャラのタブ、生成チェック、カードにフォーカスがあったか。履歴ボタンなど残っている要素は対象外。 */
function focusWasInRemovedCharacter(element: HTMLElement | null): boolean {
  if (!element || element.isConnected) return false;
  return element.closest('.editor-tab-wrap, .character') !== null;
}

function focusOnEditorTab(element: EventTarget | null): element is HTMLElement {
  return element instanceof HTMLElement
    && element.getAttribute('role') === 'tab'
    && element.closest('.editor-tablist') !== null;
}

function disabledCharacterCheck(element: EventTarget | null): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.classList.contains('editor-tab-check') && element.disabled;
}

/** 生成枠が埋まり、フォーカスしていたチェックが無効になったか。無効のまま残る環境でも対象にする。 */
function focusLeftDisabledCharacterCheck(element: HTMLElement | null): boolean {
  if (!disabledCharacterCheck(element)) return false;
  const active = document.activeElement;
  return active == null || active === document.body || active === element;
}

/** キャラの複製・削除・Undo のあと、消えたタブや複製先のタブへフォーカスを戻す。 */
export function useCharacterTabFocus(
  characters: readonly Character[],
  selected: string,
  dispatch: Dispatch<WorkspaceAction>,
) {
  const focusCopiedTab = useRef(false);
  const copiedTabId = useRef<string | null>(null);
  const knownCharacterIds = useRef(characters.map((c) => c.id));
  const lastFocused = useRef<HTMLElement | null>(null);
  const pendingRemovedTabFocus = useRef(false);
  const pendingAddedTabFocus = useRef<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const dispatchForCard = useCallback((action: WorkspaceAction) => {
    if (action.type === 'duplicateCharacter') focusCopiedTab.current = true;
    dispatch(action);
  }, [dispatch]);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocused.current = event.target;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  useLayoutEffect(() => {
    const ids = characters.map((c) => c.id);
    const prev = knownCharacterIds.current;
    const added = ids.filter((characterId) => !prev.includes(characterId));
    knownCharacterIds.current = ids;
    const addedId = added.at(-1) ?? null;
    const checkDisabled = focusLeftDisabledCharacterCheck(lastFocused.current);
    if (focusWasInRemovedCharacter(lastFocused.current) || (checkDisabled && !addedId)) {
      pendingRemovedTabFocus.current = true;
    }
    if (focusCopiedTab.current) {
      focusCopiedTab.current = false;
      copiedTabId.current = addedId;
    } else if (addedId && (focusOnEditorTab(lastFocused.current) || checkDisabled)) {
      pendingAddedTabFocus.current = addedId;
    }
    const copied = copiedTabId.current;
    const restored = pendingAddedTabFocus.current;
    const focusFree = document.activeElement == null
      || document.activeElement === document.body
      || disabledCharacterCheck(document.activeElement);
    if (copied && selected === copied) {
      copiedTabId.current = null;
      pendingAddedTabFocus.current = null;
      pendingRemovedTabFocus.current = false;
      tabRefs.current.get(copied)?.focus();
    } else if (restored && selected === restored) {
      pendingAddedTabFocus.current = null;
      if (focusOnEditorTab(document.activeElement) || focusFree) tabRefs.current.get(restored)?.focus();
    } else if (pendingRemovedTabFocus.current) {
      const ready = selected === BASE || selected === NEGATIVE || ids.includes(selected);
      if (ready) {
        pendingRemovedTabFocus.current = false;
        if (focusFree) tabRefs.current.get(selected)?.focus();
      }
    }
    lastFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [characters, selected]);
  return { tabRefs, dispatchForCard };
}
