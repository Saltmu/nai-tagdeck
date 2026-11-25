import { useEffect, useId, useState } from 'react';
import type { TokenState } from '../hooks/useToken';
import {
  CFG_RESCALE_MAX,
  CUSTOM_SIZE_SUGGESTIONS,
  GENERATION_MODES,
  NOISE_SCHEDULES,
  SAMPLERS,
  SIZE_PRESETS,
  adjustCustomHeight,
  adjustCustomWidth,
  modeLabel,
  resolveSize,
  samplerLabel,
  sizeChangePatch,
  SCALE_MAX,
  SCALE_MIN,
  SEED_MAX,
  STEPS_MIN,
  type GenerationSettings,
  type SizeKey,
} from '../lib/generation';
import { FREE_LIMITS } from '../lib/novelai';
import { NumberField } from './NumberField';

interface Props {
  generation: GenerationSettings;
  onGenerationChange: (patch: Partial<GenerationSettings>) => void;
  token: TokenState;
  onOpenSettings: () => void;
}

function formatPixels(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function GeneratePanel({
  generation,
  onGenerationChange,
  token,
  onOpenSettings,
}: Props) {
  const id = useId();
  const [customHint, setCustomHint] = useState('');
  const customSize = resolveSize(generation);
  const customPixels = customSize.width * customSize.height;
  // カスタムを離れたら丸めの案内は残さない（ピクトグラム側から切り替えたときも同じ）。
  useEffect(() => {
    if (generation.size !== 'custom') setCustomHint('');
  }, [generation.size]);

  const applyCustomSize = (width: number, height: number, hint?: string) => {
    onGenerationChange({ size: 'custom', customWidth: width, customHeight: height });
    setCustomHint(hint ?? '');
  };
  /** サイズ選択（セレクト）からの変更。フッターのピクトグラムと同一の状態を操作する。 */
  const handleSizeChange = (next: SizeKey) => {
    onGenerationChange(sizeChangePatch(generation, next));
  };
  const applyCustomWidth = (value: number | null) => {
    if (value === null) return;
    const adjusted = adjustCustomWidth(value, customSize.height);
    const hints: string[] = [];
    if (adjusted.width !== value) hints.push(`幅を 64 の倍数に丸め、${adjusted.width} にしました`);
    if (adjusted.height !== customSize.height) hints.push(`無料枠に収まるよう高さを ${adjusted.height} に調整しました`);
    applyCustomSize(adjusted.width, adjusted.height, hints.join('。') + (hints.length > 0 ? '。' : ''));
  };
  const applyCustomHeight = (value: number | null) => {
    if (value === null) return;
    const adjusted = adjustCustomHeight(customSize.width, value);
    const hints: string[] = [];
    if (adjusted.height !== value) hints.push(`高さを 64 の倍数に丸め、${adjusted.height} にしました`);
    if (adjusted.width !== customSize.width) hints.push(`無料枠に収まるよう幅を ${adjusted.width} に調整しました`);
    applyCustomSize(adjusted.width, adjusted.height, hints.join('。') + (hints.length > 0 ? '。' : ''));
  };

  return (
    <div className="generate">
      <span className="chip">V5 / Anlas 消費なしの範囲</span>
      <p className="hint free-note">
        この範囲は Opus プランで Anlas を消費しない条件です（{FREE_LIMITS.maxSteps} steps 以下、1024×1024 相当以下、1 枚）。
        Tablet / Scroll プランでは同じ設定でも Anlas を消費します。
      </p>
      {!token.token && (
        <p className="notice">
          NovelAI のトークンが未設定です。
          <button type="button" className="btn btn-small" onClick={onOpenSettings}>
            設定を開く
          </button>
        </p>
      )}

      <div className="gen-grid">
        {/* サイズ指定は常時表示する。ピクトグラムを押さないと出てこない作りにしない。 */}
        <label className="field field-wide" htmlFor={`${id}-size`}>
          <span>サイズ</span>
          <select
            id={`${id}-size`}
            value={generation.size}
            onChange={(e) => handleSizeChange(e.target.value as SizeKey)}
          >
            {SIZE_PRESETS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
            <option value="custom">カスタム {customSize.width}×{customSize.height}</option>
          </select>
        </label>
        <label className="field field-wide" htmlFor={`${id}-mode`}>
          <span>モード</span>
          <select
            id={`${id}-mode`}
            value={generation.mode}
            onChange={(e) => onGenerationChange({ mode: e.target.value === 'furry' ? 'furry' : 'anime' })}
          >
            {GENERATION_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{modeLabel(mode.value)}</option>
            ))}
          </select>
        </label>
        {generation.size === 'custom' && (
          <div className="field field-wide custom-size">
            <span className="custom-size-title">カスタムサイズ</span>
            <div className="custom-size-fields">
              <label className="field" htmlFor={`${id}-custom-width`}>
                <span>幅</span>
                <NumberField
                  id={`${id}-custom-width`}
                  value={customSize.width}
                  min={FREE_LIMITS.minSide}
                  max={FREE_LIMITS.maxSide}
                  step={FREE_LIMITS.sizeStep}
                  onChange={applyCustomWidth}
                />
              </label>
              <label className="field" htmlFor={`${id}-custom-height`}>
                <span>高さ</span>
                <NumberField
                  id={`${id}-custom-height`}
                  value={customSize.height}
                  min={FREE_LIMITS.minSide}
                  max={FREE_LIMITS.maxSide}
                  step={FREE_LIMITS.sizeStep}
                  onChange={applyCustomHeight}
                />
              </label>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => applyCustomSize(customSize.height, customSize.width)}
              >
                縦横を入れ替え
              </button>
            </div>
            <div className="custom-size-suggestions" aria-label="カスタムサイズの候補">
              {CUSTOM_SIZE_SUGGESTIONS.map((s) => (
                <button
                  key={`${s.width}x${s.height}`}
                  type="button"
                  className="btn btn-small"
                  aria-label={`カスタムサイズ ${s.width}×${s.height} にする`}
                  onClick={() => applyCustomSize(s.width, s.height)}
                >
                  {s.width}×{s.height}
                </button>
              ))}
            </div>
            <p className="hint custom-size-status" aria-live="polite">
              {customSize.width}×{customSize.height}（{formatPixels(customPixels)} / {formatPixels(FREE_LIMITS.maxPixels)} px）
              {customHint ? `　${customHint}` : ''}
            </p>
          </div>
        )}
        <label className="field" htmlFor={`${id}-steps`}>
          <span>ステップ（〜{FREE_LIMITS.maxSteps}）</span>
          <NumberField
            id={`${id}-steps`}
            value={generation.steps}
            min={STEPS_MIN}
            max={FREE_LIMITS.maxSteps}
            step={1}
            onChange={(v) => onGenerationChange({ steps: v ?? generation.steps })}
          />
        </label>
        <label className="field" htmlFor={`${id}-scale`}>
          <span>スケール</span>
          <NumberField
            id={`${id}-scale`}
            value={generation.scale}
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={0.1}
            onChange={(v) => onGenerationChange({ scale: v ?? generation.scale })}
          />
        </label>
        <label className="field" htmlFor={`${id}-sampler`}>
          <span>サンプラー</span>
          <select
            id={`${id}-sampler`}
            value={generation.sampler}
            onChange={(e) => onGenerationChange({ sampler: e.target.value })}
          >
            {SAMPLERS.map((s) => (
              <option key={s.value} value={s.value}>
                {samplerLabel(s.value)}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={`${id}-noise`}>
          <span>ノイズスケジュール</span>
          <select
            id={`${id}-noise`}
            value={generation.noiseSchedule}
            onChange={(e) => onGenerationChange({ noiseSchedule: e.target.value })}
          >
            {NOISE_SCHEDULES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="field field-wide">
          <label htmlFor={`${id}-seed`}>シード（空欄でランダム）</label>
          <div className="seed-row">
            <NumberField
              id={`${id}-seed`}
              value={generation.seed}
              min={0}
              max={SEED_MAX}
              step={1}
              allowEmpty
              placeholder="ランダム"
              onChange={(v) => onGenerationChange({ seed: v })}
            />
            <button
              type="button"
              className="btn"
              disabled={generation.seed === null}
              onClick={() => onGenerationChange({ seed: null })}
            >
              ランダムに戻す
            </button>
          </div>
        </div>
      </div>

      <details className="accordion gen-advanced">
        <summary>詳細設定</summary>
        <div className="accordion-body">
          <label className="field" htmlFor={`${id}-cfg`}>
            <span>CFG リスケール（0〜{CFG_RESCALE_MAX}）</span>
            <NumberField
              id={`${id}-cfg`}
              value={generation.cfgRescale}
              min={0}
              max={CFG_RESCALE_MAX}
              step={0.01}
              onChange={(v) => onGenerationChange({ cfgRescale: v ?? generation.cfgRescale })}
            />
          </label>
          <label className="check-line" htmlFor={`${id}-dynamic`}>
            <input
              id={`${id}-dynamic`}
              type="checkbox"
              checked={generation.dynamicThresholding}
              onChange={(e) => onGenerationChange({ dynamicThresholding: e.target.checked })}
            />
            ダイナミックしきい値
          </label>
          <p className="hint">既定は CFG リスケール 0、ダイナミックしきい値オフです。</p>
        </div>
      </details>
    </div>
  );
}
