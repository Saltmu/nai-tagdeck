import { useReducer, useState, type Dispatch } from 'react';
import type { Settings, Workspace } from '../types';
import { emptyWorkspace, normalizeWorkspace, workspaceReducer, type WorkspaceAction } from '../lib/workspace';
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/settings';
import { DEFAULT_GENERATION, normalizeGeneration, type GenerationSettings } from '../lib/generation';
import { usePersistence } from './usePersistence';

export function useWorkspace(): { workspace: Workspace; dispatch: Dispatch<WorkspaceAction>; loaded: boolean } {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, emptyWorkspace);
  const loaded = usePersistence('workspace', workspace, (raw) =>
    dispatch({ type: 'replace', workspace: normalizeWorkspace(raw) }),
  );
  return { workspace, dispatch, loaded };
}

export function useGenerationSettings(): [GenerationSettings, (patch: Partial<GenerationSettings>) => void] {
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION);
  usePersistence('generation', settings, (raw) => setSettings(normalizeGeneration(raw)));
  return [settings, (patch) => setSettings((prev) => normalizeGeneration({ ...prev, ...patch }))];
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  usePersistence('settings', settings, (raw) => setSettings(normalizeSettings(raw)));
  return [settings, (patch) => setSettings((prev) => ({ ...prev, ...patch }))];
}
