import { useMemo, type ComponentProps, type KeyboardEvent, type MutableRefObject, type RefObject } from 'react';
import type { Character, TargetId } from '../types';
import { BASE, displayedCharacterName, MAX_CHARACTERS, MAX_ENABLED_CHARACTERS, NEGATIVE } from '../lib/workspace';
import { HistoryControls } from './HistoryControls';

interface Props {
  idPrefix: string;
  panelId: string;
  paneTarget: TargetId;
  activeCharacterId: string | undefined;
  negativeSelected: boolean;
  characters: readonly Character[];
  enabledCount: number;
  tabsRef: RefObject<HTMLDivElement | null>;
  tabsStuck: boolean;
  tabRefs: MutableRefObject<Map<string, HTMLButtonElement | null>>;
  onSelect: (target: TargetId) => void;
  onToggleCharacter: (id: string) => void;
  onAddCharacter: () => void;
  history?: ComponentProps<typeof HistoryControls>;
}

export function EditorTabs({
  idPrefix,
  panelId,
  paneTarget,
  activeCharacterId,
  negativeSelected,
  characters,
  enabledCount,
  tabsRef,
  tabsStuck,
  tabRefs,
  onSelect,
  onToggleCharacter,
  onAddCharacter,
  history,
}: Props) {
  const tabKeys = useMemo<TargetId[]>(() => [BASE, NEGATIVE, ...characters.map((c) => c.id)], [characters]);

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabKeys.indexOf(paneTarget);
    if (index < 0) return;
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabKeys.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabKeys.length) % tabKeys.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabKeys.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextKey = tabKeys[nextIndex]!;
    onSelect(nextKey);
    tabRefs.current.get(nextKey)?.focus();
  };

  return (
    <div
      ref={tabsRef}
      className={`editor-tabs${tabsStuck ? ' is-stuck' : ''}`}
      data-occludes={tabsStuck ? '' : undefined}
    >
      <div className="editor-tablist" role="tablist" aria-label="編集対象" onKeyDown={onTabKeyDown}>
        <button
          ref={(el) => { tabRefs.current.set(BASE, el); }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${BASE}`}
          tabIndex={paneTarget === BASE ? 0 : -1}
          aria-selected={!activeCharacterId && !negativeSelected}
          aria-controls={paneTarget === BASE ? panelId : undefined}
          className="editor-tab"
          onClick={() => onSelect(BASE)}
        >
          ベース
        </button>
        <button
          ref={(el) => { tabRefs.current.set(NEGATIVE, el); }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${NEGATIVE}`}
          tabIndex={paneTarget === NEGATIVE ? 0 : -1}
          aria-selected={negativeSelected}
          aria-controls={paneTarget === NEGATIVE ? panelId : undefined}
          className="editor-tab editor-tab-negative"
          onClick={() => onSelect(NEGATIVE)}
        >
          ネガティブ
        </button>
        {characters.map((c, i) => {
          const name = displayedCharacterName(c, i);
          const locked = !c.enabled && enabledCount >= MAX_ENABLED_CHARACTERS;
          const isSelected = c.id === activeCharacterId;
          return (
            <div key={c.id} className="editor-tab-wrap" role="presentation">
              <input
                type="checkbox"
                className="editor-tab-check"
                checked={c.enabled}
                disabled={locked}
                aria-label={`${name} を生成に含める`}
                title={
                  locked
                    ? `生成対象は最大${MAX_ENABLED_CHARACTERS}人です。他のキャラクターのチェックを外してください`
                    : 'OFF にすると出力・生成から外します'
                }
                onChange={() => onToggleCharacter(c.id)}
              />
              <button
                ref={(el) => { tabRefs.current.set(c.id, el); }}
                type="button"
                role="tab"
                id={`${idPrefix}-tab-${c.id}`}
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                aria-controls={isSelected ? panelId : undefined}
                className={`editor-tab editor-tab-character${c.enabled ? '' : ' is-off'}`}
                onClick={() => onSelect(c.id)}
              >
                {name}
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="editor-tab editor-tab-add"
        aria-label="キャラクターを追加"
        title="キャラクターを追加"
        disabled={characters.length >= MAX_CHARACTERS}
        onClick={onAddCharacter}
      >
        ＋
      </button>
      {history && <HistoryControls {...history} />}
    </div>
  );
}
