import { useCallback, useMemo, useReducer, useRef, useState, type Dispatch } from 'react';
import type { Settings, Workspace } from '../types';
import { emptyWorkspace, hasNegative, normalizeWorkspace, workspaceReducer, type WorkspaceAction } from '../lib/workspace';
import { migrateNegative } from '../lib/backup';
import { getKV, setKV } from '../lib/db';
import { DEFAULT_SETTINGS, legacyNegativePrompt, normalizeSettings } from '../lib/settings';
import { DEFAULT_GENERATION, normalizeGeneration, type GenerationSettings } from '../lib/generation';
import { isStaleWriteError } from '../lib/tabSync';
import { usePersistence, type PersistenceState } from './usePersistence';
import type { SyncBridge } from './useTabSync';

export function useWorkspace(sync?: SyncBridge): {
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  loaded: boolean;
  migrationHeld: boolean;
  persistence: PersistenceState;
} {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, emptyWorkspace);
  const [migrationHeld, setMigrationHeld] = useState(false);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const onSaved = useCallback(() => setMigrationHeld(false), []);

  const persistence = usePersistence(
    'workspace',
    workspace,
    async (raw, isCurrent) => {
      if (raw === undefined) {
        setMigrationHeld(false);
        dispatch({ type: 'replace', workspace: emptyWorkspace() });
        return;
      }
      if (hasNegative(raw)) {
        setMigrationHeld(false);
        dispatch({ type: 'replace', workspace: normalizeWorkspace(raw) });
        return;
      }
      // ネガティブ対応前のデータ: 設定に残っている文字列のネガティブを移し、移行済みデータを保存する
      const rawSettings = syncRef.current?.snapshot
        ? syncRef.current.snapshot.data.kv.settings
        : await getKV<unknown>('settings');
      if (!isCurrent()) return;
      const migrated = migrateNegative(raw, rawSettings);
      let held = syncRef.current?.isLocked() ?? false;
      if (!held) {
        try {
          await setKV('workspace', migrated);
          syncRef.current?.onPersisted();
        } catch (error) {
          if (!isStaleWriteError(error)) throw error;
          syncRef.current?.onStaleWrite(error.reason);
          held = true;
        }
      }
      if (!isCurrent()) return;
      setMigrationHeld(held);
      dispatch({ type: 'replace', workspace: migrated });
    },
    300,
    sync,
    onSaved,
  );
  return { workspace, dispatch, loaded: persistence.loaded, migrationHeld, persistence };
}

export function useGenerationSettings(
  sync?: SyncBridge,
): [GenerationSettings, (patch: Partial<GenerationSettings>) => void, PersistenceState] {
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION);
  const persistence = usePersistence(
    'generation',
    settings,
    (raw) => setSettings(raw === undefined ? DEFAULT_GENERATION : normalizeGeneration(raw)),
    300,
    sync,
  );
  const update = useCallback((patch: Partial<GenerationSettings>) => {
    setSettings((prev) => normalizeGeneration({ ...prev, ...patch }));
  }, []);
  return [settings, update, persistence];
}

export function useSettings(
  workspaceLoaded = true,
  sync?: SyncBridge,
): [Settings, (patch: Partial<Settings>) => void, PersistenceState] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [legacyNegative, setLegacyNegative] = useState<string | null>(null);
  const stored = useMemo(
    () => (legacyNegative !== null && !workspaceLoaded ? { ...settings, negativePrompt: legacyNegative } : settings),
    [settings, legacyNegative, workspaceLoaded],
  );
  const persistence = usePersistence(
    'settings',
    stored,
    (raw) => {
      if (raw === undefined) {
        setLegacyNegative(null);
        setSettings(DEFAULT_SETTINGS);
        return;
      }
      setLegacyNegative(legacyNegativePrompt(raw));
      setSettings(normalizeSettings(raw));
    },
    300,
    sync,
  );
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);
  return [settings, update, persistence];
}
