import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CategoryKey, DictEntry } from '../types';
import { categoryLabel } from '../lib/categories';
import { parseTagList } from '../lib/prompt';
import { suggest } from '../lib/suggest';
import { visibleBounds } from '../lib/browser';
import { choosePlacement, type Placement } from '../lib/placement';

/** 候補リストの高さの上限（18rem）と、入力欄との間隔。 */
const POPUP_MAX = 288;
const POPUP_GAP = 4;

interface Props {
  category: CategoryKey;
  label: string;
  entries: DictEntry[];
  onAdd: (tag: string, weight: number) => void;
}

export function TagInput({ category, label, entries, onAdd }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [layout, setLayout] = useState<{ placement: Placement; maxHeight: number }>({
    placement: 'below',
    maxHeight: POPUP_MAX,
  });

  const suggestions = useMemo(
    () => (open && !text.includes(',') ? suggest(entries, text, { category, showCategoryOnEmpty: true }) : []),
    [open, entries, text, category],
  );
  const expanded = suggestions.length > 0;

  useEffect(() => {
    if (!expanded) return;
    const option = listRef.current?.children[active];
    if (option instanceof HTMLElement) option.scrollIntoView({ block: 'nearest' });
  }, [active, suggestions, expanded]);

  // 候補を出している間は、入力欄の上下どちらに広く空きがあるかを見て出す向きと高さを決め直す
  useLayoutEffect(() => {
    if (!expanded) return;
    const update = () => {
      const row = rowRef.current;
      const popup = popupRef.current;
      const list = listRef.current;
      if (!row || !popup || !list) return;
      const rect = row.getBoundingClientRect();
      const bounds = visibleBounds();
      // ヘッダー行などリスト以外の高さ ＋ リストを全部出したときの高さ
      const natural = popup.offsetHeight - list.clientHeight + list.scrollHeight;
      const next = choosePlacement({
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
        boundsTop: bounds.top,
        boundsBottom: bounds.bottom,
        desired: Math.min(natural, POPUP_MAX),
        gap: POPUP_GAP,
      });
      setLayout((prev) =>
        prev.placement === next.placement && prev.maxHeight === next.maxHeight ? prev : next,
      );
    };
    update();
    const vv = window.visualViewport;
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [expanded, suggestions]);

  const reset = () => {
    setText('');
    setActive(0);
    inputRef.current?.focus();
  };

  const pick = (entry: DictEntry) => {
    onAdd(entry.tag, entry.default_weight);
    reset();
  };

  /** 入力をそのまま追加する（カンマ区切りや強調記法も読む）。 */
  const addRaw = () => {
    const parsed = parseTagList(text);
    if (parsed.length === 0) return;
    for (const p of parsed) onAdd(p.tag, p.weight);
    reset();
  };

  return (
    <div className="tag-input" ref={rowRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={`${label}にタグを追加`}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        placeholder="タグ・日本語名・よみ"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="enter"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setActive(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          // IME 変換確定の Enter は無視する
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!expanded) {
              setOpen(true);
              return;
            }
            e.preventDefault();
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i + delta + suggestions.length) % suggestions.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const chosen = suggestions[active];
            if (chosen) pick(chosen.entry);
            else addRaw();
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        className="btn"
        disabled={!text.trim()}
        title="入力した文字をそのままタグとして追加（カンマ区切り可）"
        onMouseDown={(e) => e.preventDefault()}
        onClick={addRaw}
      >
        追加
      </button>

      {/* 押してもフォーカスを入力欄に残す（閉じたあともそのまま入力を続けられる） */}
      <div
        ref={popupRef}
        className={`suggest-popup is-${layout.placement}`}
        style={{ maxHeight: layout.maxHeight }}
        hidden={!expanded}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="suggest-head">
          <span>候補 {suggestions.length}件</span>
          <button type="button" className="btn btn-small" aria-label="候補を閉じる" onClick={() => setOpen(false)}>
            閉じる ✕
          </button>
        </div>
        <ul ref={listRef} id={listId} role="listbox" className="suggestions">
          {suggestions.map(({ entry }, i) => (
            <li
              key={entry.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="suggestion"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(entry)}
            >
              <span className="suggestion-tag">{entry.tag}</span>
              {entry.alias && <span className="suggestion-alias">{entry.alias}</span>}
              {entry.category !== category && <span className="chip">{categoryLabel(entry.category)}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
