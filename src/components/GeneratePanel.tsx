import { useId } from 'react';
import type { Generator } from '../hooks/useGenerator';
import type { TokenState } from '../hooks/useToken';
import {
  CFG_RESCALE_MAX,
  GENERATION_MODES,
  NOISE_SCHEDULES,
  SAMPLERS,
  SCALE_MAX,
  SCALE_MIN,
  SEED_MAX,
  SIZE_PRESETS,
  STEPS_MIN,
  type GenerationSettings,
  type SizeKey,
} from '../lib/generation';
import { FREE_LIMITS } from '../lib/novelai';
import { NumberField } from './NumberField';

interface Props {
  generation: GenerationSettings;
  onGenerationChange: (patch: Partial<GenerationSettings>) => void;
  generator: Generator;
  token: TokenState;
  onOpenSettings: () => void;
  /** 生成できない理由（なければ null）。 */
  blocker: string | null;
  onGenerate: () => void;
}

export function GeneratePanel({
  generation,
  onGenerationChange,
  generator,
  token,
  onOpenSettings,
  blocker,
  onGenerate,
}: Props) {
  const id = useId();
  const { generating } = generator;

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
        <label className="field field-wide" htmlFor={`${id}-mode`}>
          <span>モード</span>
          <select
            id={`${id}-mode`}
            value={generation.mode}
            onChange={(e) => onGenerationChange({ mode: e.target.value === 'furry' ? 'furry' : 'anime' })}
          >
            {GENERATION_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
        </label>
        <label className="field field-wide" htmlFor={`${id}-size`}>
          <span>サイズ</span>
          <select
            id={`${id}-size`}
            value={generation.size}
            onChange={(e) => onGenerationChange({ size: e.target.value as SizeKey })}
          >
            {SIZE_PRESETS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
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
                {s.label}
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

      <div className="gen-actions">
        {generating && (
          <button type="button" className="btn" onClick={generator.cancel}>
            中止
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-large"
          disabled={generating || blocker !== null}
          title={blocker ?? undefined}
          onClick={onGenerate}
        >
          {generating ? '生成中…' : '生成する'}
        </button>
      </div>
      {blocker && token.token && <p className="hint gen-blocker">{blocker}</p>}
    </div>
  );
}
