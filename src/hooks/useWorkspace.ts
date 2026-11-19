import { useReducer, useState, type Dispatch } from 'react';
import type { Settings, Workspace } from '../types';
import { emptyWorkspace, hasNegative, normalizeWorkspace, workspaceReducer, type WorkspaceAction } from '../lib/workspace';
import { migrateNegative } from '../lib/backup';
import { getKV, setKV } from '../lib/db';
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/settings';
import { DEFAULT_GENERATION, normalizeGeneration, type GenerationSettings } from '../lib/generation';
import { usePersistence, type PersistenceState } from './usePersistence';

export function useWorkspace(): { workspace: Workspace; dispatch: Dispatch<WorkspaceAction>; loaded: boolean; persistence: PersistenceState } {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, emptyWorkspace);
  const persistence = usePersistence('workspace', workspace, async (raw) => {
    if (hasNegative(raw)) {
      dispatch({ type: 'replace', workspace: normalizeWorkspace(raw) });
      return;
    }
    // ネガティブ対応前のデータ: 設定に残っている文字列のネガティブを移し、移行済みデータを保存する
    const settings = await getKV<unknown>('settings').catch(() => undefined);
    const migrated = migrateNegative(raw, settings);
    await setKV('workspace', migrated).catch(() => undefined);
    dispatch({ type: 'replace', workspace: migrated });
  });
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

