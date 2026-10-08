import { useCallback, type Dispatch } from 'react';
import type { Settings, Workspace } from '../types';
import type { Dictionary } from './useDictionary';
import type { PresetStore } from './usePresets';
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
}

export function useBackupTransfer({ dictionary, presets, workspace, dispatch, settings, updateSettings, generation, updateGeneration }: Args) {
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
      await dictionary.importEntries(data.dictionary, 'merge');
      presets.setPresets(mergePresets(presets.presets, data.presets));
      presets.setActiveId(null);
      dispatch({ type: 'replace', workspace: data.workspace });
      updateSettings(data.settings);
      updateGeneration(data.generation);
    },
    [dictionary, presets, dispatch, updateSettings, updateGeneration],
  );

  return { getBackup, importBackup };
}
