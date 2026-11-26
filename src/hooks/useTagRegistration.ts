import { useCallback, useEffect, useRef, useState } from 'react';
import type { RegisterTagDraft } from '../components/RegisterTagDialog';
import { newId } from '../lib/id';
import { duplicateEntryMessage, findDuplicate } from '../lib/io';
import type { CategoryKey, DictEntry, WorkTag } from '../types';
import type { Dictionary } from './useDictionary';

interface Options {
  entries: DictEntry[];
  save: Dictionary['save'];
  notify: (message: string) => void;
}

/**
 * 編集画面からの辞書登録モーダル制御と、保存後のフォーカス復帰を担う。
 */
export function useTagRegistration({ entries, save, notify }: Options) {
  const [registering, setRegistering] = useState<{ tag: WorkTag; category: CategoryKey } | null>(null);
  const registerReturn = useRef<{ row: HTMLElement | null; section: HTMLElement | null } | null>(null);

  const register = useCallback((tag: WorkTag, category: CategoryKey) => {
    const active = document.activeElement;
    const row = active instanceof Element ? active.closest('li.tag-row') : null;
    const section = active instanceof Element ? active.closest('section.category') : null;
    registerReturn.current = {
      row: row instanceof HTMLElement ? row : null,
      section: section instanceof HTMLElement ? section : null,
    };
    setRegistering({ tag, category });
  }, []);

  const closeRegistration = useCallback((saved: boolean) => {
    if (!saved) registerReturn.current = null;
    setRegistering(null);
  }, []);

  useEffect(() => {
    if (registering || !registerReturn.current) return;
    const { row, section } = registerReturn.current;
    registerReturn.current = null;
    const edit = row?.isConnected ? row.querySelector<HTMLElement>('button[aria-label$=" を編集"]') : null;
    const add = section?.querySelector<HTMLInputElement>('input[aria-label$="にタグを追加"]');
    (edit ?? add)?.focus();
  }, [registering]);

  const saveRegistration = useCallback(
    async (draft: RegisterTagDraft): Promise<string | null> => {
      const entry = {
        id: newId(),
        tag: draft.tag,
        category: draft.category,
        alias: draft.alias,
        default_weight: draft.default_weight,
        sort_order: 0,
        updated_at: '',
      };
      const dup = findDuplicate(entries, entry);
      if (dup) return duplicateEntryMessage(dup);
      try {
        await save(entry);
      } catch (e) {
        return `保存できませんでした: ${String(e)}`;
      }
      notify(
        draft.alias
          ? `「${draft.tag}」（${draft.alias}）を辞書に登録しました`
          : `「${draft.tag}」を辞書に登録しました`,
      );
      return null;
    },
    [entries, notify, save],
  );

  return { registering, register, closeRegistration, saveRegistration };
}
