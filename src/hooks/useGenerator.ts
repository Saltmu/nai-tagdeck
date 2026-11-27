import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildGenerateRequest,
  describeError,
  randomSeed,
  requestImages,
  type GenerateRequest,
  type InpaintInput,
  type PreciseReferenceInput,
} from '../lib/novelai';
import { toParams, type GenerationSettings } from '../lib/generation';
import { InpaintImageError } from '../lib/inpaint';
import { promptSelectsFurry } from '../lib/prompt';
import {
  prepareReferenceImageBase64,
  ReferenceImageError,
  type PreciseReferenceItem,
} from '../lib/referenceImage';
import type { GeneratedCharacterDetail, GeneratedImageParams, NewImage } from './useImages';

export interface GenerateArgs {
  token: string;
  prompt: string;
  negative: string;
  characters: Array<{ prompt: string; negative: string; center?: { x: number; y: number } }>;
  settings: GenerationSettings;
  references?: readonly PreciseReferenceItem[];
  inpaint?: InpaintInput;
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

function recordedParams(input: string, params: ReturnType<typeof toParams>): GeneratedImageParams {
  return {
    mode: promptSelectsFurry(input) ? 'furry' : 'anime',
    steps: params.steps,
    scale: params.scale,
    sampler: params.sampler,
    noiseSchedule: params.noiseSchedule,
    cfgRescale: params.cfgRescale,
    dynamicThresholding: params.dynamicThresholding,
  };
}

export function useGenerator(
  onImages: (images: NewImage[]) => void,
  /** 画像の受け取りに成功したときだけ呼ぶ（生成完了後の処理用）。 */
  onSuccess?: () => void,
): Generator {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  useEffect(() => () => controller.current?.abort(), []);

  const generate = useCallback(
    async ({ token, prompt, negative, characters, settings, references, inpaint }: GenerateArgs) => {
      if (controller.current) return; // 同時に1件まで
      const ctrl = new AbortController();
      controller.current = ctrl;
      setGenerating(true);
      setError(null);
      try {
        const seed = settings.seed ?? randomSeed();
        const params = toParams(settings, seed);
        const preparedReferences: PreciseReferenceInput[] = [];
        // インペイント時は精密参照と排他（リクエストに含めない）
        if (!inpaint && references && references.length > 0) {
          for (const ref of references) {
            if (!ref.enabled) continue;
            const imageBase64 = await prepareReferenceImageBase64(ref.blob);
            if (ctrl.signal.aborted) return;
            preparedReferences.push({
              imageBase64,
              type: ref.type,
              strength: ref.strength,
            });
          }
        }
        const body = buildGenerateRequest({
          prompt,
          negative,
          characters,
          params,
          mode: settings.mode,
          references: !inpaint && preparedReferences.length > 0 ? preparedReferences : undefined,
          inpaint,
        });
        const results = await requestImages(token, body, ctrl.signal);
        if (ctrl.signal.aborted) return;
        const negativePrompt = typeof body.parameters.negative_prompt === 'string' ? body.parameters.negative_prompt : negative;
        const characterDetails = recordedCharacters(body);
        const imageParams = recordedParams(body.input, params);
        const resultWidth = inpaint ? inpaint.width : params.width;
        const resultHeight = inpaint ? inpaint.height : params.height;
        onImages(
          results.map((r) => ({
            blob: r.blob,
            seed: r.seed ?? seed,
            width: resultWidth,
            height: resultHeight,
            prompt: body.input,
            characterPrompts: characterDetails.map((c) => c.prompt),
            negativePrompt,
            characterDetails,
            params: imageParams,
            createdAt: Date.now(),
          })),
        );
        onSuccessRef.current?.();
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setError(
            e instanceof ReferenceImageError || e instanceof InpaintImageError ? e.message : describeError(e),
          );
        }
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
