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
  commitAll?: (replacement: AppDataReplacement) => Promise<boolean>;
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
      const latestDict = dictionaryRef.current;
      const latestPresets = presetsRef.current;
      const mergedPresets = mergePresets(latestPresets.presets, data.presets);
      if (commitAllRef.current) {
        if (!latestDict.loaded) {
          throw new Error('辞書の読み込みが完了していないため保存できません');
        }
        const mergedDictionary = mergeEntries(latestDict.entries, data.dictionary, 'merge');
        const committed = await commitAllRef.current({
          dictionary: mergedDictionary,
          kv: {
            workspace: data.workspace,
            presets: mergedPresets,
            activePreset: null,
            settings: data.settings,
            generation: data.generation,
          },
        });
        if (committed) {
          latestPresets.setPresets(mergedPresets);
          latestPresets.setActiveId(null);
          dispatch({ type: 'replace', workspace: data.workspace });
          updateSettings(data.settings);
          updateGeneration(data.generation);
          return;
        }
      }
      await latestDict.importEntries(data.dictionary, 'merge');
      const currentPresets = presetsRef.current;
      currentPresets.setPresets(mergePresets(currentPresets.presets, data.presets));
      currentPresets.setActiveId(null);
      dispatch({ type: 'replace', workspace: data.workspace });
      updateSettings(data.settings);
      updateGeneration(data.generation);
    },
    [dispatch, updateSettings, updateGeneration],
  );

  return { getBackup, importBackup };
}
