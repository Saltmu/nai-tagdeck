import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CategoryKey, DictEntry } from '../types';
import { categoryLabel } from '../lib/categories';
import { parseTagList } from '../lib/prompt';
import { suggest } from '../lib/suggest';

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
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

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
    <div className="tag-input">
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
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          // IME 変換確定の Enter は無視する
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!expanded) return;
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

      <ul ref={listRef} id={listId} role="listbox" className="suggestions" hidden={!expanded} onMouseDown={(e) => e.preventDefault()}>
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
  );
}
