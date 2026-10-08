import { useCallback, useEffect } from 'react';
import type { Settings } from '../types';
import type { Generator } from './useGenerator';
import type { GenerationSettings } from '../lib/generation';
import type { buildCharacterPrompts } from '../lib/prompt';

interface Args {
  generator: Generator;
  token: string | null;
  basePrompt: string;
  characterPrompts: ReturnType<typeof buildCharacterPrompts>;
  settings: Settings;
  generation: GenerationSettings;
  show: (message: string, duration?: number) => void;
  onOpenSettings: () => void;
}

export function useGenerationControls({ generator, token, basePrompt, characterPrompts, settings, generation, show, onOpenSettings }: Args) {
  const { generating, generate, error } = generator;
  // ---- 生成（ヘッダー・生成パネル・Ctrl+Enter の共通処理） ----
  const blocker = !token
    ? 'トークンが未設定です'
    : !basePrompt
      ? 'ベースに ON のタグがありません'
      : null;

  const startGenerate = useCallback(() => {
    if (generating) return;
    if (!token) {
      show('トークンが未設定です。設定タブで入力してください', 3500);
      onOpenSettings();
      return;
    }
    if (!basePrompt) {
      show('ベースに ON のタグがありません', 3000);
      return;
    }
    void generate({
      token,
      prompt: basePrompt,
      negative: settings.negativePrompt,
      characters: characterPrompts.map((c) => ({ prompt: c.prompt, negative: settings.characterNegativePrompt })),
      settings: generation,
    });
  }, [generating, generate, token, basePrompt, characterPrompts, settings, generation, show, onOpenSettings]);

  // Ctrl+Enter（Mac は ⌘+Enter）でどこからでも生成する
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        startGenerate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [startGenerate]);

  // 生成パネルが見えていないとき（狭い画面の編集タブ）でも失敗に気づけるようにする
  useEffect(() => {
    if (error) show(error, 6000);
  }, [error, show]);

  return { blocker, startGenerate };
}
