import { useCallback, useRef, useState } from 'react';
import { buildGenerateRequest, describeError, randomSeed, requestImages } from '../lib/novelai';
import { toParams, type GenerationSettings } from '../lib/generation';
import type { NewImage } from './useImages';

export interface GenerateArgs {
  token: string;
  prompt: string;
  negative: string;
  characters: Array<{ prompt: string; negative: string }>;
  settings: GenerationSettings;
}

export interface Generator {
  generating: boolean;
  error: string | null;
  /** ボタンを押したときだけ呼ぶ（規約上、生成は人の操作で始める）。 */
  generate: (args: GenerateArgs) => Promise<void>;
  cancel: () => void;
  dismissError: () => void;
}

export function useGenerator(onImages: (images: NewImage[]) => void): Generator {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const generate = useCallback(
    async ({ token, prompt, negative, characters, settings }: GenerateArgs) => {
      if (controller.current) return; // 同時に1件まで
      const ctrl = new AbortController();
      controller.current = ctrl;
      setGenerating(true);
      setError(null);
      try {
        const seed = settings.seed ?? randomSeed();
        const params = toParams(settings, seed);
        const body = buildGenerateRequest({ prompt, negative, characters, params });
        const results = await requestImages(token, body, ctrl.signal);
        onImages(
          results.map((r) => ({
            blob: r.blob,
            seed: r.seed ?? seed,
            width: params.width,
            height: params.height,
            prompt,
            characterPrompts: characters.map((c) => c.prompt),
            createdAt: Date.now(),
          })),
        );
      } catch (e) {
        if (!ctrl.signal.aborted) setError(describeError(e));
      } finally {
        controller.current = null;
        setGenerating(false);
      }
    },
    [onImages],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);
  const dismissError = useCallback(() => setError(null), []);

  return { generating, error, generate, cancel, dismissError };
}
