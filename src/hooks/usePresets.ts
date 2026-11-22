import { useCallback, useMemo, useRef, useState } from 'react';
import { normalizePresets, type Preset } from '../lib/presets';
import { usePersistence, type PersistenceState } from './usePersistence';

export interface PresetStore {
  presets: Preset[];
  persistence: PersistenceState[];
  setPresets: (presets: Preset[]) => void;
  /** 直列の保存が成功するまで待つ。失敗したら false。画面上の一覧は変えない。 */
  commitPresets: (presets: Preset[]) => Promise<boolean>;
  /** 最後に読み込んだ・保存したプリセット。 */
  activeId: string | null;
  setActiveId: (id: string | null) => void;
}

export function usePresets(): PresetStore {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const commitPresetsRef = useRef<(next: Preset[]) => Promise<boolean>>(async () => false);
  const presetState = usePersistence('presets', presets, (raw) => setPresets(normalizePresets(raw)), 300, commitPresetsRef);
  const activeState = usePersistence('activePreset', activeId, (raw) => setActiveId(typeof raw === 'string' ? raw : null));
  const persistence = useMemo(() => [presetState, activeState], [presetState, activeState]);
  const commitPresets = useCallback((next: Preset[]) => commitPresetsRef.current(next), []);
  return useMemo(
    () => ({ persistence, presets, setPresets, commitPresets, activeId, setActiveId }),
    [persistence, presets, activeId, commitPresets],
  );
}

