import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { TokenState } from '../hooks/useToken';
import {
  CFG_RESCALE_MAX,
  CUSTOM_SIZE_SUGGESTIONS,
  DEFAULT_GENERATION,
  GENERATION_MODES,
  NOISE_SCHEDULES,
  SAMPLERS,
  SIZE_PRESETS,
  adjustCustomHeight,
  adjustCustomWidth,
  modeLabel,
  normalizeScale,
  normalizeSteps,
  resolveSize,
  samplerLabel,
  sizeChangePatch,
  sizeLabel,
  SCALE_MAX,
  SCALE_MIN,
  SEED_MAX,
  STEPS_MAX,
  STEPS_MIN,
  type GenerationSettings,
  type SizeKey,
} from '../lib/generation';
import { FREE_LIMITS } from '../lib/novelai';
import { SizeIcon } from './icons';
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

/** サイズ指定ボタンの向きごとのグルーピング。数字だけでなく向きのピクトグラムと寸法を出す。 */
const SIZE_GROUPS: Array<{ title: string; keys: readonly SizeKey[] }> = [
  { title: '縦向き', keys: ['portrait', 'tall'] },
  { title: '横向き', keys: ['landscape', 'wide'] },
  { title: '正方形', keys: ['square'] },
  { title: 'カスタム', keys: ['custom'] },
];
const SIZE_ORDER: readonly SizeKey[] = ['portrait', 'tall', 'landscape', 'wide', 'square', 'custom'];

export function GeneratePanel({
  generation,
  onGenerationChange,
  token,
  onOpenSettings,
}: Props) {
  const id = useId();
  const freeHelpId = useId();
  const [customHint, setCustomHint] = useState('');
  const [freeHelpOpen, setFreeHelpOpen] = useState(false);
  const [editingField, setEditingField] = useState<'steps' | 'scale' | null>(null);
  const freeHelpBtnRef = useRef<HTMLButtonElement>(null);
  const freeHelpPopoverRef = useRef<HTMLDivElement>(null);
  const customSize = resolveSize(generation);
  const customPixels = customSize.width * customSize.height;
  const sizeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sizeIndex = SIZE_ORDER.indexOf(generation.size);

  useEffect(() => {
    if (!freeHelpOpen) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (freeHelpBtnRef.current?.contains(target) || freeHelpPopoverRef.current?.contains(target))) return;
      setFreeHelpOpen(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setFreeHelpOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [freeHelpOpen]);

  /** サイズ変更。フッターのピクトグラムと同一の状態を操作する。 */
  const handleSizeChange = (next: SizeKey) => {
    onGenerationChange(sizeChangePatch(generation, next));
  };
  /** サイズのラジオグループ内の矢印キー移動（フッターのピクトグラムと同じ操作感）。 */
  const onSizeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(sizeIndex, 0);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % SIZE_ORDER.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + SIZE_ORDER.length) % SIZE_ORDER.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SIZE_ORDER.length - 1;
    if (next === null) return;
    e.preventDefault();
    handleSizeChange(SIZE_ORDER[next]!);
    sizeRefs.current[next]?.focus();
  };
  // カスタムを離れたら丸めの案内は残さない（ピクトグラム側から切り替えたときも同じ）。
  useEffect(() => {
    if (generation.size !== 'custom') setCustomHint('');
  }, [generation.size]);

  const applyCustomSize = (width: number, height: number, hint?: string) => {
    onGenerationChange({ size: 'custom', customWidth: width, customHeight: height });
    setCustomHint(hint ?? '');
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
      {!token.token && (
        <p className="notice">
          NovelAI のトークンが未設定です。
          <button type="button" className="btn btn-small" onClick={onOpenSettings}>
            設定を開く
          </button>
        </p>
      )}

      <div className="gen-grid">
        {/* モードは一番上。2 つしかないのでセレクトではなくボタン式にする。 */}
        <div className="field field-wide">
          <span id={`${id}-mode-label`}>モード</span>
          <div className="mode-toggle" role="group" aria-labelledby={`${id}-mode-label`}>
            {GENERATION_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                className="mode-btn"
                aria-pressed={generation.mode === mode.value}
                onClick={() => onGenerationChange({ mode: mode.value })}
              >
                {modeLabel(mode.value)}
              </button>
            ))}
          </div>
        </div>
        <hr className="gen-divider" />
        {/* サイズ指定は常時表示する。ピクトグラムを押さないと出てこない作りにしない。 */}
        <div className="field field-wide">
          <div className="size-header">
            <span id={`${id}-size-label`}>サイズ</span>
            <span className="chip size-free-chip">V5 / Anlas 消費なしの範囲</span>
            <button
              ref={freeHelpBtnRef}
              type="button"
              className="help-btn size-help-btn"
              aria-label="Anlas 消費なしの範囲の説明"
              aria-expanded={freeHelpOpen}
              aria-controls={freeHelpOpen ? freeHelpId : undefined}
              title="Anlas 消費なしの範囲の説明"
              onClick={() => setFreeHelpOpen((v) => !v)}
            >
              ?
            </button>
          </div>
          {freeHelpOpen && (
            <div
              ref={freeHelpPopoverRef}
              id={freeHelpId}
              className="free-note-popover"
              role="region"
              aria-label="Anlas 消費なしの範囲の説明"
            >
              <div className="free-note-head">
                <strong>Anlas 消費なしの範囲</strong>
                <button
                  type="button"
                  className="icon-btn free-note-close"
                  aria-label="説明を閉じる"
                  onClick={() => setFreeHelpOpen(false)}
                >
                  ✕
                </button>
              </div>
              <p className="hint free-note">
                この範囲は Opus プランで Anlas を消費しない条件です（{FREE_LIMITS.maxSteps} steps 以下、1024×1024 相当以下、1 枚）。
                Tablet / Scroll プランでは同じ設定でも Anlas を消費します。
              </p>
            </div>
          )}
          <div className="size-groups" role="radiogroup" aria-labelledby={`${id}-size-label`} onKeyDown={onSizeKeyDown}>
            {SIZE_GROUPS.map((group) => (
              <div key={group.title} className="size-group" role="group" aria-label={group.title}>
                <span className="size-group-title" aria-hidden="true">{group.title}</span>
                <div className="size-group-buttons">
                  {group.keys.map((key) => {
                    const preset = SIZE_PRESETS.find((s) => s.key === key);
                    const dims = preset ?? customSize;
                    const label = preset?.label ?? sizeLabel({ size: key, customWidth: dims.width, customHeight: dims.height });
                    const index = SIZE_ORDER.indexOf(key);
                    const isTabbable = sizeIndex >= 0 ? index === sizeIndex : index === 0;
                    return (
                      <button
                        key={key}
                        ref={(el) => {
                          sizeRefs.current[index] = el;
                        }}
                        type="button"
                        role="radio"
                        tabIndex={isTabbable ? 0 : -1}
                        aria-checked={generation.size === key}
                        aria-label={label}
                        title={label}
                        className="size-option"
                        onClick={() => handleSizeChange(key)}
                      >
                        <SizeIcon width={dims.width} height={dims.height} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
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
        <hr className="gen-divider" />
        <div className="field field-wide">
          <label htmlFor={`${id}-steps`}>ステップ（{STEPS_MIN}〜{STEPS_MAX}）</label>
          <div className="fader-row">
            <input
              id={`${id}-steps`}
              type="range"
              min={STEPS_MIN}
              max={STEPS_MAX}
              step={1}
              value={generation.steps}
              onChange={(e) => onGenerationChange({ steps: Math.round(Number(e.target.value)) })}
            />
            {editingField === 'steps' ? (
              <NumberField
                className="fader-number"
                ariaLabel="ステップを直接入力"
                value={generation.steps}
                min={STEPS_MIN}
                max={STEPS_MAX}
                step={1}
                autoFocus
                onChange={(v) => {
                  if (v !== null) onGenerationChange({ steps: normalizeSteps(v) });
                }}
                onDone={() => setEditingField(null)}
              />
            ) : (
              <button
                type="button"
                className="fader-value"
                aria-label={`ステップ ${generation.steps}（タップして直接入力）`}
                title="タップして直接入力"
                onClick={() => setEditingField('steps')}
              >
                {generation.steps}
              </button>
            )}
            <button
              type="button"
              className="btn btn-small fader-reset"
              disabled={generation.steps === DEFAULT_GENERATION.steps}
              aria-label={`ステップを既定値（${DEFAULT_GENERATION.steps}）に戻す`}
              title={`既定値（${DEFAULT_GENERATION.steps}）に戻す`}
              onClick={() => onGenerationChange({ steps: DEFAULT_GENERATION.steps })}
            >
              戻す
            </button>
          </div>
          {generation.steps > FREE_LIMITS.maxSteps && (
            <p className="hint steps-paid-note">
              {FREE_LIMITS.maxSteps} steps を超えると Opus プランでも Anlas を消費します。
            </p>
          )}
        </div>
        <div className="field field-wide">
          <label htmlFor={`${id}-scale`}>スケール（{SCALE_MIN}〜{SCALE_MAX}）</label>
          <div className="fader-row">
            <input
              id={`${id}-scale`}
              type="range"
              min={SCALE_MIN}
              max={SCALE_MAX}
              step={0.1}
              value={generation.scale}
              onChange={(e) => onGenerationChange({ scale: Math.round(Number(e.target.value) * 10) / 10 })}
            />
            {editingField === 'scale' ? (
              <NumberField
                className="fader-number"
                ariaLabel="スケールを直接入力"
                value={generation.scale}
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={0.1}
                autoFocus
                onChange={(v) => {
                  if (v !== null) onGenerationChange({ scale: normalizeScale(v) });
                }}
                onDone={() => setEditingField(null)}
              />
            ) : (
              <button
                type="button"
                className="fader-value"
                aria-label={`スケール ${generation.scale.toFixed(1)}（タップして直接入力）`}
                title="タップして直接入力"
                onClick={() => setEditingField('scale')}
              >
                {generation.scale.toFixed(1)}
              </button>
            )}
            <button
              type="button"
              className="btn btn-small fader-reset"
              disabled={generation.scale === DEFAULT_GENERATION.scale}
              aria-label={`スケールを既定値（${DEFAULT_GENERATION.scale.toFixed(1)}）に戻す`}
              title={`既定値（${DEFAULT_GENERATION.scale.toFixed(1)}）に戻す`}
              onClick={() => onGenerationChange({ scale: DEFAULT_GENERATION.scale })}
            >
              戻す
            </button>
          </div>
        </div>
        <hr className="gen-divider" />
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
        <hr className="gen-divider" />
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
