import { useEffect, useId, useMemo, useRef, useState, type Dispatch } from 'react';
import type { Workspace } from '../types';
import type { PresetStore } from '../hooks/usePresets';
import {
  createPreset,
  filterPresets,
  isEmptyWorkspace,
  overwritePreset,
  presetToWorkspace,
  renamePreset,
  sameWorkspace,
  sortPresets,
  type Preset,
} from '../lib/presets';
import { emptyWorkspace, type WorkspaceAction } from '../lib/workspace';
import { scrollOptionIntoList } from '../lib/browser';
import { confirmUnsavedChanges } from './confirmUnsaved';
import { useDialogs } from './Dialogs';
import { EditorActions } from './EditorActions';
import { MoreIcon } from './icons';

interface Props {
  store: PresetStore;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  notify: (message: string) => void;
  onPickPng?: () => void;
}

export function PresetBar({ store, workspace, dispatch, notify, onPickPng }: Props) {
  const id = useId();
  const dialogs = useDialogs();
  const { presets, setPresets, activeId, setActiveId } = store;
  const active = presets.find((p) => p.id === activeId) ?? null;
  const dirty = active ? !sameWorkspace(active.workspace, workspace) : !isEmptyWorkspace(workspace);

  /**
   * 保存していない編集を捨てる前に確認する。読み込み中のプリセットがあれば、上書き保存してから進むこともできる。
   * 進んでよければ true。
   */
  const confirmDiscard = async (action: string, okLabel: string) => {
    const choice = await confirmUnsavedChanges(dialogs, {
      dirty,
      activeName: active?.name ?? null,
      action,
      okLabel,
    });
    if (choice === 'save') overwrite();
    return choice !== null;
  };

  const load = async (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || preset.id === active?.id) return;
    if (!(await confirmDiscard(`「${preset.name}」を読み込みますか？`, '読み込む'))) return;
    dispatch({ type: 'replace', workspace: presetToWorkspace(preset.workspace, workspace) });
    setActiveId(preset.id);
    notify(`「${preset.name}」を読み込みました`);
  };

  const saveAs = async () => {
    const name = (await dialogs.prompt('プリセットの名前', active?.name ?? '', { okLabel: '保存' }))?.trim();
    if (!name) return;
    const same = presets.find((p) => p.name === name);
    if (same) {
      if (!(await dialogs.confirm(`「${name}」はすでにあります。上書きしますか？`, { okLabel: '上書き' }))) return;
      setPresets(overwritePreset(presets, same.id, workspace));
      setActiveId(same.id);
    } else {
      const preset = createPreset(name, workspace);
      setPresets(sortPresets([...presets, preset]));
      setActiveId(preset.id);
    }
    notify(`プリセット「${name}」に保存しました`);
  };

  const overwrite = () => {
    if (!active) return;
    setPresets(overwritePreset(presets, active.id, workspace));
    notify(`プリセット「${active.name}」に変更を上書きしました`);
  };

  const rename = async () => {
    if (!active) return;
    const name = (await dialogs.prompt('新しい名前', active.name, { okLabel: '変更' }))?.trim();
    if (!name || name === active.name) return;
    if (presets.some((p) => p.name === name && p.id !== active.id)) {
      await dialogs.alert(`「${name}」はすでにあります`);
      return;
    }
    setPresets(renamePreset(presets, active.id, name));
  };

  const remove = async () => {
    if (!active) return;
    const ok = await dialogs.confirm(`プリセット「${active.name}」を削除しますか？（今のタグはそのまま残ります）`, {
      okLabel: '削除',
      danger: true,
    });
    if (!ok) return;
    setPresets(presets.filter((p) => p.id !== active.id));
    setActiveId(null);
    notify(`「${active.name}」を削除しました`);
  };

  const startNew = async () => {
    if (!(await confirmDiscard('ベースとキャラクターのタグを消して、空の状態から始めますか？（ネガティブは残ります）', '新規作成'))) return;
    dispatch({ type: 'replace', workspace: { ...emptyWorkspace(), negative: workspace.negative } });
    setActiveId(null);
  };

  return (
    <section className="card preset-bar" aria-label="プリセット">
      <div className="preset-row">
        <label className="preset-select" htmlFor={`${id}-search`}>
          プリセット
        </label>
        <PresetSearch inputId={`${id}-search`} presets={presets} active={active} onPick={load} />
        {dirty && active && <span className="chip chip-weight">変更あり</span>}
        <EditorActions
          label="プリセット操作"
          icon={<MoreIcon />}
          actions={[
            { label: '変更を上書き', run: overwrite, disabled: !active || !dirty },
            { label: '新しいプリセットとして保存', run: saveAs, disabled: isEmptyWorkspace(workspace) },
            { label: '名前変更', run: rename, disabled: !active },
            { label: 'PNGから読み込む', run: () => onPickPng?.(), disabled: !onPickPng },
            { label: '新規', run: startNew },
            { label: '削除', run: remove, disabled: !active, danger: true },
          ]}
        />
      </div>
    </section>
  );
}

interface SearchProps {
  inputId: string;
  presets: Preset[];
  active: Preset | null;
  onPick: (id: string) => void;
}

/** タグ入力と同じく、名前の一部を打って候補から選ぶ。閉じている間は選択中のプリセット名を表示する。 */
function PresetSearch({ inputId, presets, active, onPick }: SearchProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const matches = useMemo(() => (open ? filterPresets(presets, text) : []), [open, presets, text]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const option = list?.children[cursor];
    if (list && option instanceof HTMLElement) scrollOptionIntoList(list, option);
  }, [open, cursor, matches]);

  const close = () => {
    setOpen(false);
    setText('');
  };

  const pick = (preset: Preset) => {
    inputRef.current?.blur();
    close();
    onPick(preset.id);
  };

  const placeholder = open
    ? active?.name || '名前の一部で検索'
    : presets.length === 0
      ? 'プリセットなし'
      : 'プリセットを選択';
  const headText =
    matches.length > 0
      ? `${matches.length}件`
      : presets.length === 0
        ? 'プリセットはまだありません'
        : '一致するプリセットはありません';

  return (
    <div className="preset-search">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && matches.length > 0 ? `${listId}-${cursor}` : undefined}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        value={open ? text : (active?.name ?? '')}
        onChange={(e) => {
          setText(e.target.value);
          setCursor(0);
          setOpen(true);
        }}
        onFocus={() => {
          setCursor(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={(e) => {
          // IME 変換確定の Enter は無視する
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (matches.length === 0) return;
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            setCursor((i) => (i + delta + matches.length) % matches.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const chosen = matches[cursor];
            if (chosen) pick(chosen);
          } else if (e.key === 'Escape') {
            inputRef.current?.blur();
          }
        }}
      />
      {/* 押してもフォーカスを入力欄に残す */}
      <div className="suggest-popup is-below" hidden={!open} onMouseDown={(e) => e.preventDefault()}>
        <div className="suggest-head">
          <span>{headText}</span>
          <button type="button" className="btn btn-small" aria-label="候補を閉じる" onClick={() => inputRef.current?.blur()}>
            閉じる ✕
          </button>
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label="プリセット候補" className="suggestions preset-suggestions">
          {matches.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === cursor}
              className={`suggestion${p.id === active?.id ? ' is-current' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(p)}
            >
              <span className="suggestion-tag">{p.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
