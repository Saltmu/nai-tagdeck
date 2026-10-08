import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE, NEGATIVE } from '../lib/workspace';

const SELECTED_KEY = 'nai-tagdeck:editor-tab';

function loadSelected(): string {
  try { return window.localStorage.getItem(SELECTED_KEY) ?? BASE; }
  catch { return BASE; }
}

function saveSelected(id: string) {
  try { window.localStorage.setItem(SELECTED_KEY, id); }
  catch { /* 保存できなくても画面の選択は変える。 */ }
}

/** 保存データの読み込み、追加、削除、プリセット置換を区別して選択を補正する。 */
export function useEditorSelection(ids: readonly string[], loaded: boolean) {
  const [selected, setSelected] = useState(loadSelected);
  const before = useRef<readonly string[] | null>(null);
  const idsKey = JSON.stringify(ids);
  const select = useCallback((id: string) => {
    setSelected(id);
    saveSelected(id);
  }, []);

  useEffect(() => {
    if (!loaded) { before.current = null; return; }
    const nextIds: string[] = JSON.parse(idsKey);
    const prev = before.current;
    let next = selected;
    if (prev && nextIds.length > prev.length && prev.every((id) => nextIds.includes(id))) {
      next = nextIds.filter((id) => !prev.includes(id)).at(-1) ?? BASE;
    } else if (selected !== BASE && selected !== NEGATIVE && !nextIds.includes(selected)) {
      // 左隣も削除されていたら、さらに左へ探す。
      next = prev?.slice(0, prev.indexOf(selected)).filter((id) => nextIds.includes(id)).at(-1) ?? BASE;
    }
    before.current = nextIds;
    if (next !== selected) select(next);
  }, [idsKey, loaded, selected, select]);

  return { selected, select };
}
