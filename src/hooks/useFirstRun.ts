import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { Workspace } from '../types';
import type { WorkspaceAction } from '../lib/workspace';
import { isEmptyWorkspace } from '../lib/presets';
import { createSampleWorkspace } from '../lib/sampleWorkspace';
import { useDialogs } from '../components/Dialogs';
import type { Dictionary } from './useDictionary';
import type { PresetStore } from './usePresets';

const STORAGE_KEY = 'nai-tagdeck:first-run-complete';

interface Options {
  ready: boolean;
  hasExistingData: boolean;
  dictionary: Dictionary;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  presets: PresetStore;
  notify: (message: string) => void;
  onOpenEditor: () => void;
}

export function useFirstRun({ ready, hasExistingData, dictionary, workspace, dispatch, presets, notify, onOpenEditor }: Options) {
  const dialogs = useDialogs();
  const checked = useRef(false);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  const complete = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, 'true'); }
    catch { notify('初回案内の表示状態を保存できませんでした。次回も表示される場合があります。'); }
  }, [notify]);

  const showGuide = useCallback(async () => {
    if (!ready || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const choice = await dialogs.choose(
        'サンプルから始めますか？\nベースには人数・画風・背景、キャラにはそれぞれの外見・衣装・ポーズを指定します。\n編集用のタグサンプルと、日本語で検索できる初期辞書を読み込めます。タグは自由に変更できます。画像生成は「生成」を押すまで行われません。\n\nアプリの読み込み・更新を除き、外部通信は画像生成時のNovelAIのみです。本ツールは非公式で、動作・生成結果を保証しません。詳しくは設定の「使い方」「免責事項」をご確認ください。',
        [
          { value: 'sample', label: 'サンプルと辞書を読み込む', primary: true },
          { value: 'dictionary', label: '辞書だけ読み込む' },
          { value: 'empty', label: hasExistingData ? '読み込まずに戻る' : '空の状態で始める' },
        ],
        { dismissOnBackdrop: true },
      );
      if (choice === 'sample') {
        if (!isEmptyWorkspace(workspace) && !(await dialogs.confirm(
          '作業中のタグとキャラクターをサンプルで置き換えますか？辞書と保存済みプリセットは残ります。',
          { okLabel: 'サンプルで置き換える' },
        ))) return;
      }
      if (choice === 'sample' || choice === 'dictionary') {
        await dictionary.restoreInitial();
        if (choice === 'sample') {
          // ネガティブはサンプルに含めず、作業中のものを残す
          dispatch({ type: 'replace', workspace: { ...createSampleWorkspace(), negative: workspace.negative } });
          presets.setActiveId(null);
        }
        notify(choice === 'sample' ? 'サンプルと初期辞書を読み込みました' : '初期辞書を読み込みました（作業中のタグはそのままです）');
        onOpenEditor();
      }
      // 空の状態・キャンセル・範囲外タップでは既存データを変更しない。
      complete();
    } catch (error) {
      notify(`読み込めませんでした。設定の「初回案内をもう一度表示」から再試行してください。${String(error)}`);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [ready, hasExistingData, dialogs, workspace, dictionary, dispatch, presets, notify, onOpenEditor, complete]);

  useEffect(() => {
    if (!ready || checked.current) return;
    checked.current = true;
    let completed = false;
    try { completed = localStorage.getItem(STORAGE_KEY) === 'true'; } catch { /* 保存できなくても案内は使える。 */ }
    if (completed) return;
    if (hasExistingData) complete();
    else void showGuide();
  }, [ready, hasExistingData, complete, showGuide]);

  return { showGuide, busy };
}
