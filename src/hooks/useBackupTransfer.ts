import { useCallback, useRef, type Dispatch } from 'react';
import type { Settings, Workspace } from '../types';
import type { Dictionary } from './useDictionary';
import type { PresetStore } from './usePresets';
import type { AppDataReplacement } from '../lib/db';
import { mergeEntries } from '../lib/io';
import { mergePresets } from '../lib/presets';
import type { Backup } from '../lib/backup';
import type { GenerationSettings } from '../lib/generation';
import type { WorkspaceAction } from '../lib/workspace';

interface Args {
  dictionary: Dictionary;
  presets: PresetStore;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  generation: GenerationSettings;
  updateGeneration: (patch: Partial<GenerationSettings>) => void;
  /** 1 トランザクションで辞書と全 KV をコミットしてから他タブへ通知する経路。 */
  commitAll?: (
    prepare: AppDataReplacement | (() => Promise<AppDataReplacement> | AppDataReplacement),
  ) => Promise<boolean>;
}

export function useBackupTransfer({
  dictionary,
  presets,
  workspace,
  dispatch,
  settings,
  updateSettings,
  generation,
  updateGeneration,
  commitAll,
}: Args) {
  const dictionaryRef = useRef(dictionary);
  dictionaryRef.current = dictionary;
  const presetsRef = useRef(presets);
  presetsRef.current = presets;
  const commitAllRef = useRef(commitAll);
  commitAllRef.current = commitAll;
  const importingRef = useRef(false);

  const getBackup = useCallback(
    (): Backup => ({
      dictionary: dictionary.entries,
      presets: presets.presets,
      workspace,
      settings,
      generation,
    }),
    [dictionary.entries, presets.presets, workspace, settings, generation],
  );

  const importBackup = useCallback(
    async (data: Backup) => {
      if (importingRef.current) {
        throw new Error('別のバックアップを読み込み中です。完了してからやり直してください');
      }
      importingRef.current = true;
      try {
        if (commitAllRef.current) {
          const committed = await commitAllRef.current(async () => {
            // 進行中の辞書編集が書き終わってから、トランザクション内の最新辞書へマージする
            await dictionaryRef.current.flush?.();
            if (!dictionaryRef.current.loaded) {
              throw new Error('辞書の読み込みが完了していないため保存できません');
            }
            const mergedPresets = mergePresets(presetsRef.current.presets, data.presets);
            return {
              dictionary: (current) => mergeEntries(current, data.dictionary, 'merge'),
              kv: {
                workspace: data.workspace,
                presets: mergedPresets,
                activePreset: null,
                settings: data.settings,
                generation: data.generation,
              },
            };
          });
          // commitAll が true のときは useTabSync の snapshot 経由で全ストアへ反映済み
          if (committed) return;
        }
        await dictionaryRef.current.importEntries(data.dictionary, 'merge');
        const currentPresets = presetsRef.current;
        currentPresets.setPresets(mergePresets(currentPresets.presets, data.presets));
        currentPresets.setActiveId(null);
        dispatch({ type: 'replace', workspace: data.workspace });
        updateSettings(data.settings);
        updateGeneration(data.generation);
      } finally {
        importingRef.current = false;
      }
    },
    [dispatch, updateSettings, updateGeneration],
  );

  return { getBackup, importBackup };
}
