import { useCallback, useMemo, useReducer, useState, type Dispatch } from 'react';
import type { Settings, Workspace } from '../types';
import { emptyWorkspace, hasNegative, normalizeWorkspace, workspaceReducer, type WorkspaceAction } from '../lib/workspace';
import { migrateNegative } from '../lib/backup';
import { getKV, setKV, StaleWriteError } from '../lib/db';
import { isTabSyncLocked, lockTabSyncFromStaleWrite } from '../lib/tabSync';
import { DEFAULT_SETTINGS, legacyNegativePrompt, normalizeSettings } from '../lib/settings';
import { DEFAULT_GENERATION, normalizeGeneration, type GenerationSettings } from '../lib/generation';
import { usePersistence, type PersistenceState } from './usePersistence';

export function useWorkspace(reloadRevision = 0): { workspace: Workspace; dispatch: Dispatch<WorkspaceAction>; loaded: boolean; persistence: PersistenceState } {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, emptyWorkspace);
  const persistence = usePersistence('workspace', workspace, async (raw, isCurrent) => {
    if (raw === undefined) {
      dispatch({ type: 'replace', workspace: emptyWorkspace() });
      return;
    }
    if (hasNegative(raw)) {
      dispatch({ type: 'replace', workspace: normalizeWorkspace(raw) });
      return;
    }
    // ネガティブ対応前のデータ: 設定に残っている文字列のネガティブを移し、移行済みデータを保存する
    const settings = await getKV<unknown>('settings');
    if (!isCurrent()) return;
    const migrated = migrateNegative(raw, settings);
    if (!isTabSyncLocked()) {
      try {
        await setKV('workspace', migrated);
      } catch (error) {
        if (!(error instanceof StaleWriteError)) throw error;
        lockTabSyncFromStaleWrite('workspace');
      }
    }
    if (isCurrent()) dispatch({ type: 'replace', workspace: migrated });
  }, 300, reloadRevision);
  return { workspace, dispatch, loaded: persistence.loaded, persistence };
}

export function useGenerationSettings(reloadRevision = 0): [GenerationSettings, (patch: Partial<GenerationSettings>) => void, PersistenceState] {
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION);
  const persistence = usePersistence('generation', settings, (raw) => {
    setSettings(raw === undefined ? DEFAULT_GENERATION : normalizeGeneration(raw));
  }, 300, reloadRevision);
  const update = useCallback((patch: Partial<GenerationSettings>) => {
    setSettings((prev) => normalizeGeneration({ ...prev, ...patch }));
  }, []);
  return [settings, update, persistence];
}

export function useSettings(workspaceLoaded = true, reloadRevision = 0): [Settings, (patch: Partial<Settings>) => void, PersistenceState] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [legacyNegative, setLegacyNegative] = useState<string | null>(null);
  const stored = useMemo(
    () => (legacyNegative !== null && !workspaceLoaded ? { ...settings, negativePrompt: legacyNegative } : settings),
    [settings, legacyNegative, workspaceLoaded],
  );
  const persistence = usePersistence('settings', stored, (raw) => {
    if (raw === undefined) {
      setLegacyNegative(null);
      setSettings(DEFAULT_SETTINGS);
      return;
    }
    setLegacyNegative(legacyNegativePrompt(raw));
    setSettings(normalizeSettings(raw));
  }, 300, reloadRevision);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);
  return [settings, update, persistence];
}

