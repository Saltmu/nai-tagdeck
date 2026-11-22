import { useCallback, useEffect, useRef, useState } from 'react';
import { buildGenerateRequest, describeError, randomSeed, requestImages, type GenerateRequest } from '../lib/novelai';
import { toParams, type GenerationSettings } from '../lib/generation';
import type { GeneratedCharacterDetail, GeneratedImageParams, NewImage } from './useImages';

export interface GenerateArgs {
  token: string;
  prompt: string;
  negative: string;
  characters: Array<{ prompt: string; negative: string; center?: { x: number; y: number } }>;
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

function recordedCharacters(body: GenerateRequest): GeneratedCharacterDetail[] {
  const useCoords = body.parameters.use_coords === true;
  return body.parameters.characterPrompts.map((c) => ({
    prompt: c.prompt,
    negative: c.uc,
    ...(useCoords ? { center: { x: c.center.x, y: c.center.y } } : {}),
  }));
}

function recordedParams(settings: GenerationSettings, params: ReturnType<typeof toParams>): GeneratedImageParams {
  return {
    mode: settings.mode,
    steps: params.steps,
    scale: params.scale,
    sampler: params.sampler,
    noiseSchedule: params.noiseSchedule,
    cfgRescale: params.cfgRescale,
    dynamicThresholding: params.dynamicThresholding,
  };
}

export function useGenerator(onImages: (images: NewImage[]) => void): Generator {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

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
        const body = buildGenerateRequest({ prompt, negative, characters, params, mode: settings.mode });
        const results = await requestImages(token, body, ctrl.signal);
        if (ctrl.signal.aborted) return;
        const negativePrompt = typeof body.parameters.negative_prompt === 'string' ? body.parameters.negative_prompt : negative;
        const characterDetails = recordedCharacters(body);
        const imageParams = recordedParams(settings, params);
        onImages(
          results.map((r) => ({
            blob: r.blob,
            seed: r.seed ?? seed,
            width: params.width,
            height: params.height,
            prompt: body.input,
            characterPrompts: characterDetails.map((c) => c.prompt),
            negativePrompt,
            characterDetails,
            params: imageParams,
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
