import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CategoryKey, DictEntry } from '../types';
import { categoryLabel } from '../lib/categories';
import { parseTagList } from '../lib/prompt';
import { normalize, suggest } from '../lib/suggest';
import { visibleBounds } from '../lib/browser';
import { choosePlacement, type Placement } from '../lib/placement';
import { INTERACTIONS, splitInteraction, withInteraction, type Interaction } from '../lib/interaction';

/** 候補リストの高さの上限（18rem）と、入力欄との間隔。 */
const POPUP_MAX = 288;
const POPUP_GAP = 4;

interface Props {
  category: CategoryKey;
  label: string;
  entries: DictEntry[];
  onAdd: (tag: string, weight: number) => void;
  /** 候補の表示・非表示が切り替わったとき（表示中のカテゴリを強調するのに使う）。 */
  onExpandedChange?: (expanded: boolean) => void;
  /** キャラ同士の動作（source# / target# / mutual#）を付けるボタンを出す。 */
  interactions?: boolean;
}

export function TagInput({ category, label, entries, onAdd, onExpandedChange, interactions }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Interaction | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [layout, setLayout] = useState<{ placement: Placement; maxHeight: number }>({
    placement: 'below',
    maxHeight: POPUP_MAX,
  });

  // 打ち込んだ "source#…" も読み取り、# より後ろで候補を探す
  const typed = interactions ? splitInteraction(text) : { interaction: null, body: text };
  const interaction = typed.interaction ?? picked;
  const query = typed.body;
  const suggestions = useMemo(() => {
    if (!open || query.includes(',')) return [];
    const list = suggest(entries, query, { category, showCategoryOnEmpty: true });
    if (!interaction) return list;
    // 接頭辞を付け替えると "hug" と "target#hug" が同じになるので1つにまとめる
    const seen = new Set<string>();
    return list.filter(({ entry }) => {
      const key = normalize(withInteraction(entry.tag, interaction));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [open, entries, query, category, interaction]);
  const expanded = suggestions.length > 0;

  useEffect(() => {
    onExpandedChange?.(expanded);
    return () => onExpandedChange?.(false);
  }, [expanded, onExpandedChange]);

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

  // 候補を出している間に外側を押したら、候補を閉じるだけにして背後の要素のクリックは起こさない
  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && areaRef.current?.contains(e.target)) return;
      setOpen(false);
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, true);
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 500);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [expanded]);

  // 追加したあとは候補を閉じる（入力欄を押す・打つと再び開く）
  const reset = () => {
    setText('');
    setPicked(null);
    setActive(0);
    setOpen(false);
    inputRef.current?.focus();
  };

  const pick = (entry: DictEntry) => {
    onAdd(withInteraction(entry.tag, interaction), entry.default_weight);
    reset();
  };

  /** 入力をそのまま追加する（カンマ区切りや強調記法も読む）。 */
  const addRaw = () => {
    const parsed = parseTagList(text);
    if (parsed.length === 0) return;
    for (const p of parsed) onAdd(withInteraction(p.tag, picked ?? splitInteraction(p.tag).interaction), p.weight);
    reset();
  };

  return (
    <div ref={areaRef}>
      {interactions && (
        // 押してもフォーカスを入力欄に残す
        <div className="interaction-picks" role="group" aria-label="キャラ同士の動作" onMouseDown={(e) => e.preventDefault()}>
          <span className="interaction-label">キャラ同士</span>
          {INTERACTIONS.map((it) => (
            <button
              key={it.value}
              type="button"
              className={`btn btn-small${interaction === it.value ? ' btn-primary' : ''}`}
              aria-pressed={interaction === it.value}
              title={`${it.value}# を付けて追加します（${it.label}）`}
              onClick={() => {
                const next = interaction === it.value ? null : it.value;
                // 打ち込んだ接頭辞はボタンの選択に置き換える
                setText(typed.body);
                setPicked(next);
                setOpen(true);
                inputRef.current?.focus();
              }}
            >
              {it.value}#<span className="interaction-sub">{it.label}</span>
            </button>
          ))}
        </div>
      )}
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
          placeholder={interaction ? `${interaction}# に続けるタグ・日本語名・よみ` : 'タグ・日本語名・よみ'}
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
          onFocus={(e) => {
            setActive(0);
            // ダイアログ（相手キャラへの追加など）を閉じてフォーカスが戻ってきただけなら候補は開かない
            if (e.relatedTarget instanceof Element && e.relatedTarget.closest('dialog')) return;
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
                <span className="suggestion-tag">{withInteraction(entry.tag, interaction)}</span>
                {entry.alias && <span className="suggestion-alias">{entry.alias}</span>}
                {entry.category !== category && <span className="chip">{categoryLabel(entry.category)}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
