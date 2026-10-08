import { useReducer, useState, type Dispatch } from 'react';
import type { Settings, Workspace } from '../types';
import { emptyWorkspace, normalizeWorkspace, workspaceReducer, type WorkspaceAction } from '../lib/workspace';
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/settings';
import { DEFAULT_GENERATION, normalizeGeneration, type GenerationSettings } from '../lib/generation';
import { usePersistence, type PersistenceState } from './usePersistence';

export function useWorkspace(): { workspace: Workspace; dispatch: Dispatch<WorkspaceAction>; loaded: boolean; persistence: PersistenceState } {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, emptyWorkspace);
  const persistence = usePersistence('workspace', workspace, (raw) =>
    dispatch({ type: 'replace', workspace: normalizeWorkspace(raw) }),
  );
  return { workspace, dispatch, loaded: persistence.loaded, persistence };
}

export function useGenerationSettings(): [GenerationSettings, (patch: Partial<GenerationSettings>) => void, PersistenceState] {
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION);
  const persistence = usePersistence('generation', settings, (raw) => setSettings(normalizeGeneration(raw)));
  return [settings, (patch) => setSettings((prev) => normalizeGeneration({ ...prev, ...patch })), persistence];
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void, PersistenceState] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const persistence = usePersistence('settings', settings, (raw) => setSettings(normalizeSettings(raw)));
  return [settings, (patch) => setSettings((prev) => ({ ...prev, ...patch })), persistence];
}

