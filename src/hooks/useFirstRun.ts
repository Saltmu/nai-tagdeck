import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { Workspace } from '../types';
import type { WorkspaceAction } from '../lib/workspace';
import { isEmptyWorkspace } from '../lib/presets';
import { tutorialUrl } from '../lib/tutorialLinks';
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
      // 説明 → 問い → 選択肢の順に読めるようにし、各選択肢で何が起きるかはボタンの中で説明する
      const choice = await dialogs.choose(
        'タグを組み合わせて NovelAI のプロンプトを作り、画像を生成するツールです。\nベースには人数・画風・背景を、キャラにはそれぞれの外見・衣装・ポーズを指定します。作業内容はこのブラウザに自動保存されます。\n\nどの状態から始めますか？',
        [
          {
            value: 'sample',
            label: 'タグの例と辞書を読み込む',
            description: 'ベースとキャラ1人分に例のタグが入った状態で始めます。日本語で検索できるタグ辞書も読み込みます。タグは自由に変更・削除できます。',
            primary: true,
          },
          {
            value: 'dictionary',
            label: 'タグ辞書だけ読み込む',
            description: hasExistingData
              ? '日本語で検索できるタグ辞書を読み込みます。作業中のタグはそのままです。'
              : 'タグは空のまま、日本語で検索できるタグ辞書だけを読み込みます。',
          },
          hasExistingData
            ? { value: 'empty', label: '何も読み込まずに戻る', description: '今の状態のまま使い続けます。' }
            : { value: 'empty', label: '何も読み込まずに始める', description: 'タグも辞書も空の状態から始めます。' },
        ],
        {
          title: hasExistingData ? '初回案内' : 'nai-tagdeck へようこそ',
          links: [
            {
              label: 'チュートリアルで試す',
              description: 'APIトークンの発行から最初の1枚の生成までを練習画面で体験できます（別タブで開きます）。',
              href: tutorialUrl({ scene: 'example', from: 'first-run' }),
            },
          ],
          note: '画像は「生成」を押したときだけ生成されます。外部との通信は、アプリの読み込み・更新と、画像生成時の NovelAI だけです。本ツールは非公式で、動作・生成結果を保証しません。詳しくは設定の「使い方」「免責事項」をご覧ください。',
          dismissOnBackdrop: true,
        },
      );
      if (choice === 'sample') {
        if (!isEmptyWorkspace(workspace) && !(await dialogs.confirm(
          '作業中のタグとキャラクターをタグの例で置き換えますか？辞書と保存済みプリセットは残ります。',
          { okLabel: 'タグの例で置き換える' },
        ))) return;
      }
      if (choice === 'sample' || choice === 'dictionary') {
        await dictionary.restoreInitial();
        if (choice === 'sample') {
          // choice === 'sample' 確定後にだけ読む（初期チャンクには含めない）
          const { createSampleWorkspace } = await import('../lib/sampleWorkspace');
          // ネガティブはタグの例に含めず、作業中のものを残す
          dispatch({ type: 'replace', workspace: { ...createSampleWorkspace(), negative: workspace.negative } });
          presets.setActiveId(null);
        }
        notify(choice === 'sample' ? 'タグの例と辞書を読み込みました' : 'タグ辞書を読み込みました（作業中のタグはそのままです）');
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
