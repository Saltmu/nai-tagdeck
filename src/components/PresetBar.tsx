import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Workspace } from '../types';
import type { PresetStore } from '../hooks/usePresets';
import type { UndoExtras } from '../hooks/useTagUndo';
import { isImeComposing } from '../lib/browser';
import { modeLabel, type GenerationSettings } from '../lib/generation';
import {
  createPreset,
  filterPresets,
  generationSaveForOverwrite,
  isEmptyWorkspace,
  overwritePreset,
  presetGenerationOf,
  presetGenerationSummary,
  presetLoadExtras,
  presetToWorkspace,
  renamePreset,
  samePreset,
  sortPresets,
  type Preset,
} from '../lib/presets';
import { emptyWorkspace, type WorkspaceAction } from '../lib/workspace';
import { scrollOptionIntoList } from '../lib/browser';
import { confirmUnsavedChanges } from './confirmUnsaved';
import { useDialogs } from './Dialogs';
import { EditorActions } from './EditorActions';
import { MoreIcon } from './icons';
import { PresetSaveDialog } from './PresetSaveDialog';

interface Props {
  store: PresetStore;
  workspace: Workspace;
  dispatch: (action: WorkspaceAction, extras?: UndoExtras) => void;
  notify: (message: string) => void;
  generation: GenerationSettings;
  characterNegativePrompt: string;
  /** 生成設定と共通キャラネガティブを IndexedDB から読み終えている。失敗時は false。 */
  settingsReady?: boolean;
  /** 作業状態の読み込みと旧データの移行が終わっている。失敗時は false。 */
  workspaceReady?: boolean;
  onPickPng?: () => void;
}

export function PresetBar({
  store,
  workspace,
  dispatch,
  notify,
  generation,
  characterNegativePrompt,
  settingsReady = true,
  workspaceReady = true,
  onPickPng,
}: Props) {
  const id = useId();
  const dialogs = useDialogs();
  const { presets, setPresets, activeId, setActiveId } = store;
  const generationRef = useRef(generation);
  const characterNegativeRef = useRef(characterNegativePrompt);
  const settingsReadyRef = useRef(settingsReady);
  const workspaceReadyRef = useRef(workspaceReady);
  generationRef.current = generation;
  characterNegativeRef.current = characterNegativePrompt;
  settingsReadyRef.current = settingsReady;
  workspaceReadyRef.current = workspaceReady;
  const active = presets.find((p) => p.id === activeId) ?? null;
  const [saveOpen, setSaveOpen] = useState(false);
  const dirty = active
    ? !samePreset(active, { workspace, generation, characterNegativePrompt })
    : !isEmptyWorkspace(workspace);

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
    if (choice === 'save') return overwrite();
    return choice !== null;
  };

  const load = async (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || preset.id === active?.id) return;
    const affectsSettings = preset.generation !== undefined || preset.characterNegativePrompt !== undefined;
    if (affectsSettings && !settingsReadyRef.current) {
      notify('生成設定を読み込めていないため、このプリセットは読み込めません');
      return;
    }
    if (affectsSettings && !workspaceReadyRef.current) {
      notify('作業状態を読み込めていないため、このプリセットは読み込めません');
      return;
    }
    if (!(await confirmDiscard(`「${preset.name}」を読み込みますか？`, '読み込む'))) return;
    dispatch(
      { type: 'replace', workspace: presetToWorkspace(preset.workspace, workspace) },
      presetLoadExtras(preset, {
        generation: generationRef.current,
        characterNegativePrompt: characterNegativeRef.current,
      }),
    );
    setActiveId(preset.id);
    notify(
      preset.generation !== undefined
        ? `「${preset.name}」を読み込みました（生成設定も反映）`
        : `「${preset.name}」を読み込みました`,
    );
  };

  const saveAs = () => setSaveOpen(true);

  const commitSave = async (choice: { name: string; includeGeneration: boolean }) => {
    setSaveOpen(false);
    if (choice.includeGeneration && !settingsReady) {
      notify('生成設定を読み込めていないため、保存を中止しました');
      return;
    }
    // 読み込み前は、チェックを外した扱いで既存の生成設定まで消さない。
    const save = choice.includeGeneration
      ? { generation, characterNegativePrompt }
      : settingsReady
        ? null
        : undefined;
    const same = presets.find((p) => p.name === choice.name);
    if (same) {
      if (!(await dialogs.confirm(`「${choice.name}」はすでにあります。上書きしますか？`, { okLabel: '上書き' }))) return;
      setPresets(overwritePreset(presets, same.id, workspace, save));
      setActiveId(same.id);
    } else {
      const preset = createPreset(choice.name, workspace, save ?? undefined);
      setPresets(sortPresets([...presets, preset]));
      setActiveId(preset.id);
    }
    notify(`プリセット「${choice.name}」に保存しました`);
  };

  const overwrite = () => {
    if (!active) return false;
    const save = generationSaveForOverwrite(active, {
      generation: generationRef.current,
      characterNegativePrompt: characterNegativeRef.current,
    });
    if (save && !settingsReadyRef.current) {
      notify('生成設定を読み込めていないため、上書きできません');
      return false;
    }
    setPresets(overwritePreset(presets, active.id, workspace, save));
    notify(`プリセット「${active.name}」に変更を上書きしました`);
    return true;
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
          shortLabel="操作"
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
      {saveOpen && (
        <PresetSaveDialog
          initialName={active?.name ?? ''}
          includeGeneration={active ? active.generation !== undefined : true}
          canIncludeGeneration={settingsReady}
          summary={presetGenerationSummary(presetGenerationOf(generation))}
          onCancel={() => setSaveOpen(false)}
          onSave={commitSave}
        />
      )}
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
          if (isImeComposing(e)) return;
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
              {p.generation && <span className="chip preset-mode-chip">{modeLabel(p.generation.mode)}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
