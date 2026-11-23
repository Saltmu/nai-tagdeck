import { useMemo, useState } from 'react';
import { normalizePresets, type Preset } from '../lib/presets';
import { usePersistence, type PersistenceState } from './usePersistence';

export interface PresetStore {
  presets: Preset[];
  persistence: PersistenceState[];
  setPresets: (presets: Preset[]) => void;
  /** 最後に読み込んだ・保存したプリセット。 */
  activeId: string | null;
  setActiveId: (id: string | null) => void;
}

export function usePresets(reloadRevision = 0): PresetStore {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const presetState = usePersistence('presets', presets, (raw) => {
    setPresets(raw === undefined ? [] : normalizePresets(raw));
  }, 300, reloadRevision);
  const activeState = usePersistence('activePreset', activeId, (raw) => {
    setActiveId(typeof raw === 'string' ? raw : null);
  }, 300, reloadRevision);
  const persistence = useMemo(() => [presetState, activeState], [presetState, activeState]);
  return useMemo(
    () => ({ persistence, presets, setPresets, activeId, setActiveId }),
    [persistence, presets, activeId],
  );
}

