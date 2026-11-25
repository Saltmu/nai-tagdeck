import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { confirmUnsavedChanges, type UnsavedChoice } from '../components/confirmUnsaved';
import { useDialogs } from '../components/Dialogs';
import type { PromptSource } from '../components/PromptImportDialog';
import { type GenerationSettings, normalizeGeneration } from '../lib/generation';
import { generationSaveForOverwrite, isEmptyWorkspace, overwritePreset, samePreset, sameWorkTags, type Preset } from '../lib/presets';
import { importedBaseForMode, type PromptImport } from '../lib/promptImport';
import { defaultNegativeTags, type WorkspaceAction } from '../lib/workspace';
import type { DictEntry, Settings, Workspace, WorkTag } from '../types';
import type { UndoExtras } from './useTagUndo';
import type { PresetStore } from './usePresets';

interface Options {
  /** 初回読み込みが終わり、PNG の選択と適用を受け付ける。 */
  ready: boolean;
  settingsReady: boolean;
  workspace: Workspace;
  presets: PresetStore;
  settings: Settings;
  generation: GenerationSettings;
  dictionaryEntries: DictEntry[];
  dispatch: (action: WorkspaceAction, extras?: UndoExtras) => void;
  openEditor: () => void;
  notify: (message: string) => void;
}

export interface PromptImportApply {
  promptSource: PromptSource | null;
  pngInputRef: RefObject<HTMLInputElement | null>;
  /** ready が false のときはファイル選択を開かない。 */
  pickPng: (() => void) | undefined;
  openPromptImport: (source: PromptSource) => void;
  closePromptImport: () => void;
  onPngFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  applyPrompt: (result: PromptImport, applyGeneration: boolean) => Promise<boolean>;
}

/** 適用する生成設定のうち、今の値と違う項目だけを Undo 用に残す。 */
function generationPatchFromImport(
  current: GenerationSettings,
  values: Partial<GenerationSettings>,
): Partial<GenerationSettings> {
  const next = normalizeGeneration({ ...current, ...values });
  const patch: Partial<GenerationSettings> = {};
  for (const key of Object.keys(values) as (keyof GenerationSettings)[]) {
    const value = next[key];
    if (value !== undefined && !Object.is(value, current[key])) patch[key] = value as never;
  }
  // サイズが変わり、どちらかがカスタムなら寸法もパッチに含める。プリセットへ戻るときは
  // 寸法を undefined にして、Undo でカスタムへ戻すときに元の寸法を復元できるようにする。
  if (values.size !== undefined && values.size !== current.size &&
      (values.size === 'custom' || current.size === 'custom')) {
    if (!Object.is(next.customWidth, current.customWidth)) patch.customWidth = next.customWidth;
    if (!Object.is(next.customHeight, current.customHeight)) patch.customHeight = next.customHeight;
  }
  return patch;
}

function negativeApplyState(
  workspace: Workspace,
  negative: WorkTag[] | undefined,
  active: Preset | null,
): { negativeChanges: boolean; negativeUnsaved: boolean } {
  const negativeChanges = negative !== undefined && !sameWorkTags(negative, workspace.negative);
  // 古いプリセットはネガティブを持たず、空の作業状態もネガティブを見ない。PNG が編集済みの全体ネガティブを置き換えるときだけ、ここで確認する。
  const negativeUnsaved = negativeChanges
    && !sameWorkTags(workspace.negative, defaultNegativeTags())
    && (active === null || active.workspace.negative === undefined);
  return { negativeChanges, negativeUnsaved };
}

function promptApplyIsDirty(
  active: Preset | null,
  workspace: Workspace,
  generation: GenerationSettings,
  characterNegativePrompt: string,
  negativeUnsaved: boolean,
): boolean {
  const replacingWork = active
    ? !samePreset(active, {
        workspace,
        generation,
        characterNegativePrompt,
      })
    : !isEmptyWorkspace(workspace);
  return replacingWork || negativeUnsaved;
}

function promptApplyConfirmAction(flags: {
  negativeChanges: boolean;
  characterNegativeChanges: boolean;
  generationChanges: boolean;
}): string {
  const also = [
    flags.negativeChanges ? '全体ネガティブ' : '',
    flags.characterNegativeChanges ? '共通のキャラ用ネガティブ' : '',
    flags.generationChanges ? '生成設定' : '',
  ].filter(Boolean);
  return also.length > 0
    ? `画像のプロンプトを適用しますか？作業中のベースとキャラクターを置き換え、${also.join('と')}も更新します。`
    : '画像のプロンプトを適用しますか？作業中のベースとキャラクターを置き換えます。';
}

/** PNG とプロンプト読み込みダイアログから、作業中のタグへ適用する。 */
export function usePromptImportApply({
  ready,
  settingsReady,
  workspace,
  presets,
  settings,
  generation,
  dictionaryEntries,
  dispatch,
  openEditor,
  notify,
}: Options): PromptImportApply {
  const dialogs = useDialogs();
  const [promptSource, setPromptSource] = useState<PromptSource | null>(null);
  const confirmAbortRef = useRef<AbortController | null>(null);
  const pngInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef(workspace);
  const presetsRef = useRef(presets);
  const settingsRef = useRef(settings);
  const generationRef = useRef(generation);
  const entriesRef = useRef(dictionaryEntries);
  workspaceRef.current = workspace;
  presetsRef.current = presets;
  settingsRef.current = settings;
  generationRef.current = generation;
  entriesRef.current = dictionaryEntries;

  const pickPng = useMemo(
    () => (ready ? () => pngInputRef.current?.click() : undefined),
    [ready],
  );
  const openPromptImport = useCallback(
    (source: PromptSource) => {
      if (ready) setPromptSource(source);
    },
    [ready],
  );
  const closePromptImport = useCallback(() => setPromptSource(null), []);
  const onPngFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) openPromptImport({ blob: file, name: file.name });
  }, [openPromptImport]);

  useEffect(() => {
    if (!ready && promptSource !== null) setPromptSource(null);
    return () => { confirmAbortRef.current?.abort(); };
  }, [ready, promptSource]);

  const applyPrompt = async (result: PromptImport, applyGeneration: boolean) => {
    const currentWorkspace = workspaceRef.current;
    const store = presetsRef.current;
    const currentSettings = settingsRef.current;
    const currentGeneration = generationRef.current;
    const currentEntries = entriesRef.current;
    const active = store.presets.find((preset) => preset.id === store.activeId) ?? null;
    const generationPatch = applyGeneration
      ? generationPatchFromImport(currentGeneration, result.generation.values)
      : {};
    const generationChanges = Object.keys(generationPatch).length > 0;
    const { negativeChanges, negativeUnsaved } = negativeApplyState(currentWorkspace, result.negative, active);
    const dirty = promptApplyIsDirty(
      active,
      currentWorkspace,
      currentGeneration,
      currentSettings.characterNegativePrompt,
      negativeUnsaved,
    );
    const nextCharacterNegative = result.characterNegative !== undefined && result.characterNegative !== currentSettings.characterNegativePrompt
      ? result.characterNegative
      : null;
    let choice: UnsavedChoice | null = 'proceed';
    if (dirty) {
      const action = promptApplyConfirmAction({
        negativeChanges,
        characterNegativeChanges: nextCharacterNegative !== null,
        generationChanges,
      });
      confirmAbortRef.current?.abort();
      const controller = new AbortController();
      confirmAbortRef.current = controller;
      try {
        choice = await confirmUnsavedChanges(dialogs, {
          dirty,
          activeName: active?.name ?? null,
          action,
          okLabel: '適用',
          signal: controller.signal,
        });
      } finally {
        if (confirmAbortRef.current === controller) confirmAbortRef.current = null;
      }
      if (!choice || controller.signal.aborted) return false;
      // 確認を開いている間にバックアップや辞書更新などで状態が変わっていたら、古い前提のまま適用せずプレビューへ戻す。
      if (
        currentWorkspace !== workspaceRef.current
        || store.presets !== presetsRef.current.presets
        || store.activeId !== presetsRef.current.activeId
        || currentSettings !== settingsRef.current
        || currentGeneration !== generationRef.current
        || currentEntries !== entriesRef.current
      ) {
        notify('確認中に内容が更新されたため、適用を中止しました。もう一度適用してください');
        return false;
      }
    }
    if (choice === 'save' && active) {
      const save = generationSaveForOverwrite(active, {
        generation: currentGeneration,
        characterNegativePrompt: currentSettings.characterNegativePrompt,
      });
      if (save && !settingsReady) {
        notify('生成設定を読み込めていないため、適用を中止しました');
        return false;
      }
      store.setPresets(overwritePreset(store.presets, active.id, currentWorkspace, save));
    }
    const nextGeneration = applyGeneration
      ? normalizeGeneration({ ...currentGeneration, ...result.generation.values })
      : null;
    const nextMode = nextGeneration?.mode ?? currentGeneration.mode;
    const extras: UndoExtras = {};
    if (nextCharacterNegative !== null) extras.characterNegativePrompt = nextCharacterNegative;
    if (generationChanges) extras.generation = generationPatch;
    dispatch({
      type: 'replace',
      workspace: {
        base: importedBaseForMode(result, nextMode),
        characters: result.characters,
        negative: result.negative ?? currentWorkspace.negative,
      },
    }, extras);
    store.setActiveId(null);
    openEditor();
    notify(choice === 'save' && active
      ? `プリセット「${active.name}」に変更を上書きし、画像のプロンプトを読み込みました`
      : '画像のプロンプトを読み込みました');
    return true;
  };

  return {
    promptSource,
    pngInputRef,
    pickPng,
    openPromptImport,
    closePromptImport,
    onPngFileChange,
    applyPrompt,
  };
}
