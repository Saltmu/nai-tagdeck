import { useReducer, useState, type Dispatch } from 'react';
import type { Settings, Workspace } from '../types';
import { emptyWorkspace, normalizeWorkspace, workspaceReducer, type WorkspaceAction } from '../lib/workspace';
import { usePersistence } from './usePersistence';

export function useWorkspace(): { workspace: Workspace; dispatch: Dispatch<WorkspaceAction>; loaded: boolean } {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, emptyWorkspace);
  const loaded = usePersistence('workspace', workspace, (raw) =>
    dispatch({ type: 'replace', workspace: normalizeWorkspace(raw) }),
  );
  return { workspace, dispatch, loaded };
}

const DEFAULT_SETTINGS: Settings = { weightSyntax: 'numeric' };

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  usePersistence('settings', settings, (raw) => {
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<Settings>;
      setSettings({
        weightSyntax: r.weightSyntax === 'brace' ? 'brace' : 'numeric',
      });
    }
  });
  return [settings, (patch) => setSettings((prev) => ({ ...prev, ...patch }))];
}
