import { useId, type Dispatch } from 'react';
import type { Workspace } from '../types';
import type { PresetStore } from '../hooks/usePresets';
import {
  createPreset,
  isEmptyWorkspace,
  overwritePreset,
  renamePreset,
  sameWorkspace,
  sortPresets,
} from '../lib/presets';
import { emptyWorkspace, normalizeWorkspace, type WorkspaceAction } from '../lib/workspace';

interface Props {
  store: PresetStore;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  notify: (message: string) => void;
}

export function PresetBar({ store, workspace, dispatch, notify }: Props) {
  const id = useId();
  const { presets, setPresets, activeId, setActiveId } = store;
  const active = presets.find((p) => p.id === activeId) ?? null;
  const dirty = active ? !sameWorkspace(active.workspace, workspace) : !isEmptyWorkspace(workspace);

  /** 保存していない編集を捨てる前に確認する。 */
  const confirmDiscard = (action: string) =>
    !dirty ||
    window.confirm(
      active
        ? `「${active.name}」への変更は保存されていません。${action}`
        : `今のタグはプリセットに保存されていません。${action}`,
    );

  const load = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || !confirmDiscard(`「${preset.name}」を読み込みますか？`)) return;
    dispatch({ type: 'replace', workspace: normalizeWorkspace(structuredClone(preset.workspace)) });
    setActiveId(preset.id);
    notify(`「${preset.name}」を読み込みました`);
  };

  const saveAs = () => {
    const name = window.prompt('プリセットの名前', active?.name ?? '')?.trim();
    if (!name) return;
    const same = presets.find((p) => p.name === name);
    if (same) {
      if (!window.confirm(`「${name}」はすでにあります。上書きしますか？`)) return;
      setPresets(overwritePreset(presets, same.id, workspace));
      setActiveId(same.id);
    } else {
      const preset = createPreset(name, workspace);
      setPresets(sortPresets([...presets, preset]));
      setActiveId(preset.id);
    }
    notify(`「${name}」に保存しました`);
  };

  const overwrite = () => {
    if (!active) return;
    setPresets(overwritePreset(presets, active.id, workspace));
    notify(`「${active.name}」を上書き保存しました`);
  };

  const rename = () => {
    if (!active) return;
    const name = window.prompt('新しい名前', active.name)?.trim();
    if (!name || name === active.name) return;
    if (presets.some((p) => p.name === name && p.id !== active.id)) {
      window.alert(`「${name}」はすでにあります`);
      return;
    }
    setPresets(renamePreset(presets, active.id, name));
  };

  const remove = () => {
    if (!active || !window.confirm(`プリセット「${active.name}」を削除しますか？（今のタグはそのまま残ります）`)) return;
    setPresets(presets.filter((p) => p.id !== active.id));
    setActiveId(null);
    notify(`「${active.name}」を削除しました`);
  };

  const startNew = () => {
    if (!confirmDiscard('すべてのタグを消して、空の状態から始めますか？')) return;
    dispatch({ type: 'replace', workspace: emptyWorkspace() });
    setActiveId(null);
  };

  return (
    <section className="card preset-bar" aria-label="プリセット">
      <div className="preset-row">
        <label className="preset-select" htmlFor={`${id}-select`}>
          <span>プリセット</span>
          <select id={`${id}-select`} value={active?.id ?? ''} onChange={(e) => load(e.target.value)}>
            <option value="" disabled>
              {presets.length === 0 ? '（まだありません）' : '（未選択）'}
            </option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {dirty && active && <span className="chip chip-weight">変更あり</span>}
      </div>
      <div className="preset-actions">
        <button type="button" className="btn btn-small" disabled={!active || !dirty} onClick={overwrite}>
          上書き保存
        </button>
        <button type="button" className="btn btn-small" disabled={isEmptyWorkspace(workspace)} onClick={saveAs}>
          名前を付けて保存
        </button>
        <button type="button" className="btn btn-small" disabled={!active} onClick={rename}>
          名前変更
        </button>
        <button type="button" className="btn btn-small btn-danger" disabled={!active} onClick={remove}>
          削除
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-small" onClick={startNew}>
          新規
        </button>
      </div>
    </section>
  );
}
