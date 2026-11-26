import { type ChangeEvent, type KeyboardEvent, useId, useRef } from 'react';
import type { ReferenceImageStore } from '../hooks/useReferenceImage';
import { PRECISE_REFERENCE_ANLAS } from '../lib/anlasEstimate';
import {
  PRECISE_REFERENCE_STRENGTH_MAX,
  PRECISE_REFERENCE_STRENGTH_MIN,
  PRECISE_REFERENCE_STRENGTH_STEP,
} from '../lib/novelai';
import { PRECISE_REFERENCE_TYPES } from '../lib/referenceImage';

interface Props {
  reference: ReferenceImageStore;
}

export function ReferencePanel({ reference }: Props) {
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const item = reference.items[0] ?? null;

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void reference.setFromFile(file);
  };

  const onTypeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!item) return;
    const currentIndex = PRECISE_REFERENCE_TYPES.findIndex((t) => t.value === item.type);
    const current = Math.max(currentIndex, 0);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % PRECISE_REFERENCE_TYPES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (current - 1 + PRECISE_REFERENCE_TYPES.length) % PRECISE_REFERENCE_TYPES.length;
    } else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = PRECISE_REFERENCE_TYPES.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = PRECISE_REFERENCE_TYPES[next]!;
    reference.setType(item.id, target.value);
    typeRefs.current[next]?.focus();
  };

  return (
    <div className="reference-panel">
      <section className="reference-section" aria-labelledby={`${id}-heading`}>
        <div className="reference-head">
          <h3 id={`${id}-heading`} className="reference-title">
            精密参照（V5）
          </h3>
          <span className="chip">+{PRECISE_REFERENCE_ANLAS} Anlas / 枚</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={onFileChange}
        />

        {reference.error && (
          <div className="gen-error" role="alert">
            <p>{reference.error}</p>
            <button type="button" className="icon-btn" aria-label="参照エラーを閉じる" onClick={reference.dismissError}>
              ✕
            </button>
          </div>
        )}

        {!item ? (
          <div className="reference-empty">
            <p className="hint reference-intro">
              参照画像を渡して、キャラクター・スタイル・衣装の見た目をそろえます（PNG / JPEG / WebP）。
            </p>
            <p className="hint reference-cost-note">
              精密参照は Opus 無料枠の対象外です。有効な参照 1 枚あたり {PRECISE_REFERENCE_ANLAS} Anlas かかります。
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={reference.loading}
              onClick={() => fileInputRef.current?.click()}
            >
              {reference.loading ? '読み込み中…' : '参照画像を選択'}
            </button>
          </div>
        ) : (
          <div className="reference-body">
            <div className="reference-preview-card">
              <img src={item.previewUrl} alt={`参照画像: ${item.name}`} className="reference-thumb" />
              <div className="reference-preview-meta">
                <p className="reference-name" title={item.name}>
                  {item.name}
                </p>
                <div className="reference-file-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={reference.loading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {reference.loading ? '読み込み中…' : '差し替え'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => reference.remove(item.id)}
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>

            <label className="check-line reference-enable-label" htmlFor={`${id}-enabled`}>
              <input
                id={`${id}-enabled`}
                type="checkbox"
                role="switch"
                checked={item.enabled}
                onChange={(e) => reference.setEnabled(item.id, e.target.checked)}
              />
              <span>
                {item.enabled
                  ? `精密参照 ON（+${PRECISE_REFERENCE_ANLAS} Anlas）`
                  : '一時 OFF（通常生成 / +0 Anlas）'}
              </span>
            </label>

            <div className="field">
              <span id={`${id}-type-label`}>種別</span>
              <div
                className="reference-type-group"
                role="radiogroup"
                aria-labelledby={`${id}-type-label`}
                onKeyDown={onTypeKeyDown}
              >
                {PRECISE_REFERENCE_TYPES.map((t, index) => {
                  const selected = item.type === t.value;
                  return (
                    <button
                      key={t.value}
                      ref={(el) => {
                        typeRefs.current[index] = el;
                      }}
                      type="button"
                      role="radio"
                      tabIndex={selected ? 0 : -1}
                      aria-checked={selected}
                      className="reference-type-btn"
                      onClick={() => reference.setType(item.id, t.value)}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label htmlFor={`${id}-strength`}>
                強さ（{PRECISE_REFERENCE_STRENGTH_MIN}〜{PRECISE_REFERENCE_STRENGTH_MAX.toFixed(1)}）
              </label>
              <div className="fader-row">
                <input
                  id={`${id}-strength`}
                  type="range"
                  min={PRECISE_REFERENCE_STRENGTH_MIN}
                  max={PRECISE_REFERENCE_STRENGTH_MAX}
                  step={PRECISE_REFERENCE_STRENGTH_STEP}
                  value={item.strength}
                  onChange={(e) => reference.setStrength(item.id, Number(e.target.value))}
                />
                <output htmlFor={`${id}-strength`}>{item.strength.toFixed(2)}</output>
              </div>
            </div>

            <p className="hint reference-cost-note">
              {item.enabled
                ? `精密参照は Opus の無料枠対象外です（有効時 1 枚あたり +${PRECISE_REFERENCE_ANLAS} Anlas）。`
                : '一時 OFF 中のため、画像を保持したまま通常の生成（+0 Anlas）を行います。'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
