import { useCallback, useEffect } from 'react';
import type { Settings } from '../types';
import type { Generator } from './useGenerator';
import type { GenerationSettings } from '../lib/generation';
import type { buildCharacterPrompts } from '../lib/prompt';
import type { PreciseReferenceItem } from '../lib/referenceImage';

interface Args {
  generator: Generator;
  token: string | null;
  basePrompt: string;
  characterPrompts: ReturnType<typeof buildCharacterPrompts>;
  /** ネガティブのタグから組み立てた文面。 */
  negativePrompt: string;
  settings: Settings;
  generation: GenerationSettings;
  activeReferences?: readonly PreciseReferenceItem[];
  show: (message: string, duration?: number) => void;
  onOpenSettings: () => void;
  /** 競合解決中など、グローバルショートカットと生成開始を止める間は true。 */
  shortcutsDisabled?: boolean;
}

export function useGenerationControls({
  generator,
  token,
  basePrompt,
  characterPrompts,
  negativePrompt,
  settings,
  generation,
  activeReferences,
  show,
  onOpenSettings,
  shortcutsDisabled = false,
}: Args) {
  const { generating, generate, error } = generator;
  // ---- 生成（ヘッダー・生成パネル・Ctrl+Enter の共通処理） ----
  // ケモノモードは先頭に fur dataset を補えるため、キャラに ON のタグがあればベースが空でも生成できる
  const missingPrompt = !basePrompt && !(generation.mode === 'furry' && characterPrompts.length > 0);
  const blocker = !token
    ? 'トークンが未設定です'
    : missingPrompt
      ? 'ベースに ON のタグがありません'
      : null;

  const startGenerate = useCallback(() => {
    if (generating || shortcutsDisabled) return;
    if (!token) {
      show('トークンが未設定です。設定タブで入力してください', 3500);
      onOpenSettings();
      return;
    }
    if (missingPrompt) {
      show('ベースに ON のタグがありません', 3000);
      return;
    }
    void generate({
      token,
      prompt: basePrompt,
      negative: negativePrompt,
      characters: characterPrompts.map((c) => ({
        prompt: c.prompt,
        negative: c.negative !== undefined ? c.negative : settings.characterNegativePrompt,
        ...(c.center ? { center: c.center } : {}),
      })),
      settings: generation,
      references: activeReferences,
    });
  }, [generating, shortcutsDisabled, generate, token, basePrompt, missingPrompt, characterPrompts, negativePrompt, settings, generation, activeReferences, show, onOpenSettings]);

  // Ctrl+Enter（Mac は ⌘+Enter）でどこからでも生成する
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shortcutsDisabled) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        startGenerate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsDisabled, startGenerate]);

  // 生成パネルが見えていないとき（狭い画面の編集タブ）でも失敗に気づけるようにする
  useEffect(() => {
    if (error) show(error, 6000);
  }, [error, show]);

  return { blocker, startGenerate };
}
