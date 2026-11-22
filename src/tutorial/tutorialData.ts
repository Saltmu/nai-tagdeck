import type { DictEntry, Workspace } from '../types';
import { sampleDictionary } from '../lib/sampleDictionary';
import { emptyWorkspace, newCharacter, workspaceReducer } from '../lib/workspace';
import type { TutorialEntrySource, TutorialSceneId } from '../lib/tutorialLinks';

export type TutorialMode = 'watch' | 'try';

export type TutorialStepId =
  | 'example-overview'
  | 'token-open-settings'
  | 'token-open-account'
  | 'token-get-persistent'
  | 'token-overwrite'
  | 'token-copy'
  | 'register-paste'
  | 'register-save'
  | 'editor-load-sample'
  | 'editor-add-background'
  | 'editor-toggle-hat'
  | 'generate-run'
  | 'complete';

export interface TutorialChapter {
  id: TutorialSceneId;
  number: number;
  title: string;
  summary: string;
  firstStepId: TutorialStepId;
}

export interface TutorialStep {
  id: TutorialStepId;
  chapterId: TutorialSceneId;
  title: string;
  subtitle: string;
  actionHint: string;
  autoAdvanceMs: number;
}

export const PRACTICE_TOKEN = 'pst-tutorial-sample-token-00000000';
export const NOVELAI_URL = 'https://novelai.net/';

export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  {
    id: 'example',
    number: 1,
    title: '完成例を見る',
    summary: '夕暮れの街を歩く人物の生成例から、ベースとキャラの役割をつかみます。',
    firstStepId: 'example-overview',
  },
  {
    id: 'issue-token',
    number: 2,
    title: 'トークンを発行する',
    summary: 'NovelAI のアカウント設定から Persistent API Token を発行してコピーする流れを体験します。',
    firstStepId: 'token-open-settings',
  },
  {
    id: 'register-token',
    number: 3,
    title: 'トークンを登録する',
    summary: 'nai-tagdeck の設定画面に練習用トークンを貼り付け、保存先を選んで保存します。',
    firstStepId: 'register-paste',
  },
  {
    id: 'edit-tags',
    number: 4,
    title: '見本のタグを編集する',
    summary: '日本語から背景タグを追加し、キャラの帽子タグを OFF にしてプロンプトの変化を確認します。',
    firstStepId: 'editor-load-sample',
  },
  {
    id: 'generate',
    number: 5,
    title: '最初の1枚を生成する',
    summary: 'サイズを選んで生成例を表示し、本体での生成やプロンプトのコピーへ進みます。',
    firstStepId: 'generate-run',
  },
];

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'example-overview',
    chapterId: 'example',
    title: '完成例を見る',
    subtitle: '「夕暮れの街を歩く人物」の生成例です。背景は「ベース」、服装や小物は「キャラ」で指定します。',
    actionHint: '「次へ」を押して、API トークンの発行手順へ進みましょう。',
    autoAdvanceMs: 4200,
  },
  {
    id: 'token-open-settings',
    chapterId: 'issue-token',
    title: 'NovelAI で Settings を開く',
    subtitle: 'NovelAI の画面右上にある歯車アイコン「Settings」を開きます（練習用パネルです）。',
    actionHint: 'ハイライトされた「Settings」を押してください。',
    autoAdvanceMs: 3200,
  },
  {
    id: 'token-open-account',
    chapterId: 'issue-token',
    title: 'Account を開く',
    subtitle: '設定メニューから「Account」タブを選びます。',
    actionHint: 'ハイライトされた「Account」を押してください。',
    autoAdvanceMs: 3000,
  },
  {
    id: 'token-get-persistent',
    chapterId: 'issue-token',
    title: 'Get Persistent API Token を押す',
    subtitle: 'アカウント画面にある「Get Persistent API Token」を押して発行ダイアログを開きます。',
    actionHint: '「Get Persistent API Token」を押してください。',
    autoAdvanceMs: 3200,
  },
  {
    id: 'token-overwrite',
    chapterId: 'issue-token',
    title: '確認して Overwrite を押す',
    subtitle: '初回でも「Overwrite（上書き）」と表示されます。すでに発行済みの場合は再発行すると旧トークンが無効になります。',
    actionHint: '注意点を確認して「Overwrite」を押してください。',
    autoAdvanceMs: 4200,
  },
  {
    id: 'token-copy',
    chapterId: 'issue-token',
    title: '発行されたトークンをコピー',
    subtitle: '発行された練習用トークンをコピーします。実トークンは NovelAI で発行して本体へ直接貼り付けます。',
    actionHint: '「コピー」ボタンを押してください。',
    autoAdvanceMs: 3200,
  },
  {
    id: 'register-paste',
    chapterId: 'register-token',
    title: '練習用トークンを貼り付ける',
    subtitle: 'nai-tagdeck の「設定」→「NovelAI のトークン」入力欄へ練習用トークンを貼り付けます。',
    actionHint: '「練習用トークンを貼り付け」を押すか、入力欄へ貼り付けてください。',
    autoAdvanceMs: 3200,
  },
  {
    id: 'register-save',
    chapterId: 'register-token',
    title: '保存先を確認して保存する',
    subtitle: '共用端末なら「このタブだけ」、自分の端末なら「このブラウザに保存」を選び、保存を押します。',
    actionHint: '保存先を確認して「保存」を押してください。',
    autoAdvanceMs: 3600,
  },
  {
    id: 'editor-load-sample',
    chapterId: 'edit-tags',
    title: 'タグの例と辞書を読み込む',
    subtitle: '「タグの例と辞書を読み込む」を押すと、ベースとキャラ1人分の見本タグ・日本語辞書が入ります。',
    actionHint: '「タグの例と辞書を読み込む」を押してください。',
    autoAdvanceMs: 3400,
  },
  {
    id: 'editor-add-background',
    chapterId: 'edit-tags',
    title: 'ベースに背景タグを追加する',
    subtitle: 'ベースの上部入力欄で「夕焼け」など日本語を打ち、候補から背景タグを選びます。カテゴリとプロンプトに即反映されます。',
    actionHint: '上部入力欄で「夕焼け」と入力して候補（sunset 等）を選んでください。',
    autoAdvanceMs: 3800,
  },
  {
    id: 'editor-toggle-hat',
    chapterId: 'edit-tags',
    title: 'キャラの帽子タグを OFF にする',
    subtitle: 'キャラの「hat」タグを OFF にします。タグは編集欄に残ったまま、プロンプトからだけ外れます。',
    actionHint: 'キャラの衣装にある「hat」のチェックを外して OFF にしてください。',
    autoAdvanceMs: 3800,
  },
  {
    id: 'generate-run',
    chapterId: 'generate',
    title: 'サイズを選んで生成する',
    subtitle: '出力サイズを選んで「生成」を押すと、事前に用意した生成例が表示されます（API 通信は行いません）。',
    actionHint: 'サイズを確認して「生成」を押してください。',
    autoAdvanceMs: 3400,
  },
  {
    id: 'complete',
    chapterId: 'generate',
    title: 'チュートリアル完了',
    subtitle: 'お疲れさまでした！元の nai-tagdeck タブへ戻って実際に生成するか、プロンプトのコピー手順を確認できます。',
    actionHint: '本体タブへ戻るか、下の導線から次の操作を選んでください。',
    autoAdvanceMs: 0,
  },
];

export function stepIndexByScene(scene: TutorialSceneId): number {
  const chapter = TUTORIAL_CHAPTERS.find((c) => c.id === scene);
  if (!chapter) return 0;
  const idx = TUTORIAL_STEPS.findIndex((s) => s.id === chapter.firstStepId);
  return idx >= 0 ? idx : 0;
}

export interface InitialTutorialLocation {
  stepIndex: number;
  showChapters: boolean;
  from: TutorialEntrySource | null;
}

export function parseTutorialLocation(search: string): InitialTutorialLocation {
  const params = new URLSearchParams(search);
  const sceneParam = params.get('scene') as TutorialSceneId | null;
  const viewParam = params.get('view');
  const fromParam = params.get('from');
  const validScene = TUTORIAL_CHAPTERS.some((c) => c.id === sceneParam) ? sceneParam : null;
  const from: TutorialEntrySource | null =
    fromParam === 'first-run' || fromParam === 'howto' || fromParam === 'token-settings' ? fromParam : null;
  return {
    stepIndex: validScene ? stepIndexByScene(validScene) : 0,
    showChapters: viewParam === 'chapters',
    from,
  };
}

/** チュートリアル専用の練習用辞書。夕焼け・街並み・帽子などの日本語検索を確実に含む（既存同名タグは上書き）。 */
export function createTutorialDictionary(): DictEntry[] {
  const now = new Date().toISOString();
  const extras: Array<[DictEntry['category'], string, string]> = [
    ['background', 'sunset', '夕焼け 夕暮れ ゆうやけ ゆうぐれ 背景'],
    ['background', 'evening street', '夕暮れの街 街並み まち 背景'],
    ['background', 'cityscape', '街並み 都市 まち 背景'],
    ['outfit', 'hat', '帽子 ぼうし'],
    ['outfit', 'coat', 'コート 上着'],
    ['pose', 'walking', '歩く あるく'],
  ];
  const overrideTags = new Set(extras.map(([, tag]) => tag.toLowerCase()));
  const base = sampleDictionary().filter((e) => !overrideTags.has(e.tag.toLowerCase()));
  const added: DictEntry[] = extras.map(([category, tag, alias], i) => ({
    id: `tutorial-dict-${tag.replace(/\s+/g, '-')}`,
    tag,
    alias,
    category,
    default_weight: 1,
    sort_order: i * 10,
    updated_at: now,
  }));
  return [...added, ...base];
}

/** チュートリアル用の見本ワークスペース（夕暮れの街を歩く人物、帽子タグあり）。 */
export function createTutorialSampleWorkspace(): Workspace {
  let workspace = emptyWorkspace();
  const character = newCharacter(0);
  character.name = 'キャラ1';
  workspace.characters = [character];
  const picks = [
    ['base', 'quality', 'very aesthetic'],
    ['base', 'quality', 'amazing quality'],
    ['base', 'subject', '1girl'],
    ['base', 'background', 'evening street'],
    [character.id, 'subject', 'girl'],
    [character.id, 'appearance', 'long hair'],
    [character.id, 'outfit', 'coat'],
    [character.id, 'outfit', 'hat'],
    [character.id, 'pose', 'walking'],
  ] as const;
  for (const [target, category, tag] of picks) {
    workspace = workspaceReducer(workspace, { type: 'add', target, category, tag });
  }
  return workspace;
}
