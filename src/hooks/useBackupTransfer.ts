import { useCallback, useRef, type Dispatch } from 'react';
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
  const presetsRef = useRef(presets);
  presetsRef.current = presets;

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
      const latestPresets = presetsRef.current;
      latestPresets.setPresets(mergePresets(latestPresets.presets, data.presets));
      latestPresets.setActiveId(null);
      dispatch({ type: 'replace', workspace: data.workspace });
      updateSettings(data.settings);
      updateGeneration(data.generation);
    },
    [dictionary, dispatch, updateSettings, updateGeneration],
  );

  return { getBackup, importBackup };
}
