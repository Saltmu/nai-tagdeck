import { useId } from 'react';
import type { Settings } from '../types';
import type { CharacterPrompt } from '../lib/prompt';
import type { Generator } from '../hooks/useGenerator';
import type { TokenState } from '../hooks/useToken';
import {
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
import { usePanelOpen } from '../hooks/usePanelOpen';

interface Props {
  generation: GenerationSettings;
  onGenerationChange: (patch: Partial<GenerationSettings>) => void;
  generator: Generator;
  token: TokenState;
  basePrompt: string;
  characterPrompts: CharacterPrompt[];
  settings: Settings;
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
  basePrompt,
  characterPrompts,
  settings,
  onOpenSettings,
  blocker,
  onGenerate,
}: Props) {
  const id = useId();
  const [open, toggleOpen] = usePanelOpen('generate');
  const { generating, error } = generator;

  return (
    <section className={`card generate${open ? '' : ' is-collapsed'}`} aria-labelledby={`${id}-title`}>
      <div className="card-head">
        <h2 id={`${id}-title`} className="card-title">
          <span className="generate-title-text">生成</span>
          <button
            type="button"
            className="disclosure generate-disclosure"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={toggleOpen}
          >
            <span className="disclosure-icon" aria-hidden="true" />
            生成
            {generating && <span className="spinner spinner-small" aria-label="生成中" />}
          </button>
        </h2>
        <span className="chip" title={`${FREE_LIMITS.maxSteps} steps 以下・1024×1024 相当以下・1枚`}>
          V5 / Anlas 消費なしの範囲
        </span>
      </div>

      <div id={`${id}-body`} className="generate-body">
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

      <p className="gen-summary">
        ベース {basePrompt ? `${basePrompt.split(', ').length}タグ` : 'なし'}
        {' ／ '}キャラ {characterPrompts.length}人{' ／ '}ネガティブ {settings.negativePrompt.trim() ? 'あり' : 'なし'}
      </p>

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

      {error && (
        <div className="gen-error" role="alert">
          <p>{error}</p>
          <button type="button" className="icon-btn" aria-label="エラーを閉じる" onClick={generator.dismissError}>
            ✕
          </button>
        </div>
      )}
      </div>
    </section>
  );
}
