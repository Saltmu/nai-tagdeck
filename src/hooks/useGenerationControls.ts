import { useCallback, useEffect, useRef } from 'react';
import type { Settings } from '../types';
import type { Generator } from './useGenerator';
import type { InpaintSession } from './useInpaintSession';
import type { GenerationSettings } from '../lib/generation';
import { createInpaintMaskBase64, InpaintImageError, prepareInpaintBaseImageBase64 } from '../lib/inpaint';
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
  activeInpaint?: InpaintSession | null;
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
  activeInpaint,
  show,
  onOpenSettings,
  shortcutsDisabled = false,
}: Args) {
  const { generating, generate, error } = generator;
  const preparingInpaintRef = useRef(false);
  // ---- 生成（ヘッダー・生成パネル・Ctrl+Enter の共通処理） ----
  // ケモノモードは先頭に fur dataset を補えるため、キャラに ON のタグがあればベースが空でも生成できる
  const missingPrompt = !basePrompt && !(generation.mode === 'furry' && characterPrompts.length > 0);
  const blocker = !token
    ? 'トークンが未設定です'
    : missingPrompt
      ? 'ベースに ON のタグがありません'
      : null;

  const startGenerate = useCallback(() => {
    if (generating || preparingInpaintRef.current || shortcutsDisabled) return;
    if (!token) {
      show('トークンが未設定です。設定タブで入力してください', 3500);
      onOpenSettings();
      return;
    }
    if (missingPrompt) {
      show('ベースに ON のタグがありません', 3000);
      return;
    }
    const characters = characterPrompts.map((c) => ({
      prompt: c.prompt,
      negative: c.negative !== undefined ? c.negative : settings.characterNegativePrompt,
      ...(c.center ? { center: c.center } : {}),
    }));

    if (activeInpaint) {
      preparingInpaintRef.current = true;
      void (async () => {
        try {
          const imageBase64 = await prepareInpaintBaseImageBase64(
            activeInpaint.sourceBlob,
            activeInpaint.width,
            activeInpaint.height,
          );
          const maskBase64 = createInpaintMaskBase64(
            activeInpaint.maskHistory,
            activeInpaint.width,
            activeInpaint.height,
          );
          await generate({
            token,
            prompt: basePrompt,
            negative: negativePrompt,
            characters,
            settings: generation,
            inpaint: {
              imageBase64,
              maskBase64,
              width: activeInpaint.width,
              height: activeInpaint.height,
              strength: activeInpaint.strength,
              addOriginalImage: activeInpaint.addOriginalImage,
            },
          });
        } catch (err) {
          show(
            err instanceof InpaintImageError ? err.message : 'インペイント用の画像を準備できませんでした',
            6000,
          );
        } finally {
          preparingInpaintRef.current = false;
        }
      })();
      return;
    }

    void generate({
      token,
      prompt: basePrompt,
      negative: negativePrompt,
      characters,
      settings: generation,
      references: activeReferences,
    });
  }, [
    generating,
    shortcutsDisabled,
    generate,
    token,
    basePrompt,
    missingPrompt,
    characterPrompts,
    negativePrompt,
    settings,
    generation,
    activeReferences,
    activeInpaint,
    show,
    onOpenSettings,
  ]);

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
