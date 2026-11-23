import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { WorkTag } from '../types';
import { normalize } from '../lib/tagText';
import type { PromptTagCategory } from '../lib/tagClassification';
import type { BaseCategorySuggestion } from '../components/CategorySection';

/**
 * 上部入力欄でベースに追加した未分類タグへ、行 ID が確定したタイミングで
 * ベクトル分類の候補を結び付ける。PNG 取り込み等の別行へは引き継がない。
 */
export function useUnclassifiedSuggestions(unclassified: readonly WorkTag[]) {
  const [suggestions, setSuggestions] = useState<Record<string, BaseCategorySuggestion>>({});
  const pending = useRef<Map<string, PromptTagCategory | null>>(new Map());
  const [version, setVersion] = useState(0);

  const noteSuggestion = useCallback((tag: string, suggested: PromptTagCategory | null) => {
    pending.current.set(normalize(tag), suggested);
    setVersion((v) => v + 1);
  }, []);

  const clearSuggestion = useCallback((tag: string) => {
    noteSuggestion(tag, null);
  }, [noteSuggestion]);

  useLayoutEffect(() => {
    if (pending.current.size === 0) return;
    const queued = pending.current;
    pending.current = new Map();
    const byTag = new Map(unclassified.map((t) => [normalize(t.tag), t.id]));
    setSuggestions((prev) => {
      let next: Record<string, BaseCategorySuggestion> | null = null;
      for (const [key, suggested] of queued) {
        const rowId = byTag.get(key);
        if (!rowId) continue;
        if (suggested) {
          const current = (next ?? prev)[rowId];
          if (current?.tag === key && current.category === suggested) continue;
          next ??= { ...prev };
          next[rowId] = { tag: key, category: suggested };
        } else if (rowId in (next ?? prev)) {
          next ??= { ...prev };
          delete next[rowId];
        }
      }
      return next ?? prev;
    });
  }, [unclassified, version]);

  return { suggestions, noteSuggestion, clearSuggestion };
}
