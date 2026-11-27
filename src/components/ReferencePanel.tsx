import { type ChangeEvent, type KeyboardEvent, useId, useRef } from 'react';
import type { InpaintSessionStore } from '../hooks/useInpaintSession';
import type { ReferenceImageStore } from '../hooks/useReferenceImage';
import { PRECISE_REFERENCE_ANLAS } from '../lib/anlasEstimate';
import { isMaskEmpty } from '../lib/inpaint';
import {
  PRECISE_REFERENCE_STRENGTH_MAX,
  PRECISE_REFERENCE_STRENGTH_MIN,
  PRECISE_REFERENCE_STRENGTH_STEP,
} from '../lib/novelai';
import { MAX_PRECISE_REFERENCES, PRECISE_REFERENCE_TYPES } from '../lib/referenceImage';

interface Props {
  reference: ReferenceImageStore;
  inpaint?: InpaintSessionStore;
  onStartInpaintFile?: (file: File) => void;
  onResumeInpaint?: () => void;
  onToggleInpaintEnabled?: (enabled: boolean) => void;
  onDiscardInpaint?: () => void;
}

export function ReferencePanel({
  reference,
  inpaint,
  onStartInpaintFile,
  onResumeInpaint,
  onToggleInpaintEnabled,
  onDiscardInpaint,
}: Props) {
  const id = useId();
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const inpaintInputRef = useRef<HTMLInputElement>(null);
  const replacingIdRef = useRef<string | null>(null);
  const typeRefs = useRef<Record<string, Array<HTMLButtonElement | null>>>({});

  const activeCount = reference.activeItems.length;
  const totalAnlas = activeCount * PRECISE_REFERENCE_ANLAS;
  const atLimit = reference.items.length >= MAX_PRECISE_REFERENCES;
  const inpaintSession = inpaint?.session ?? null;
  const inpaintHasMask = inpaintSession
    ? !isMaskEmpty(inpaintSession.maskHistory, inpaintSession.width, inpaintSession.height)
    : false;

  const onAddFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    void reference.addFromFiles(files);
  };

  const onReplaceFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const targetId = replacingIdRef.current;
    replacingIdRef.current = null;
    if (!file || !targetId) return;
    void reference.replaceFromFile(targetId, file);
  };

  const onInpaintFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (onStartInpaintFile) onStartInpaintFile(file);
    else if (inpaint) void inpaint.startFromFile(file);
  };

  const onTypeKeyDown = (itemId: string, currentType: string, e: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = PRECISE_REFERENCE_TYPES.findIndex((t) => t.value === currentType);
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
    reference.setType(itemId, target.value);
    typeRefs.current[itemId]?.[next]?.focus();
  };

  return (
    <div className="reference-panel">
      <section className="reference-section" aria-labelledby={`${id}-heading`}>
        <div className="reference-head">
          <h3 id={`${id}-heading`} className="reference-title">
            精密参照（V5）
          </h3>
          <div className="reference-head-actions">
            <span className="chip">
              {reference.items.length === 0
                ? `+${PRECISE_REFERENCE_ANLAS} Anlas / 枚`
                : `${activeCount}/${reference.items.length}枚有効（+${totalAnlas} Anlas）`}
            </span>
            {reference.items.length >= 2 && (
              <button type="button" className="btn btn-small btn-danger" onClick={reference.clear}>
                すべて削除
              </button>
            )}
          </div>
        </div>

        <input
          ref={addInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="reference-add-input"
          hidden
          onChange={onAddFileChange}
        />
        <input
          ref={replaceInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="reference-replace-input"
          hidden
          onChange={onReplaceFileChange}
        />

        {reference.error && (
          <div className="gen-error" role="alert">
            <p>{reference.error}</p>
            <button type="button" className="icon-btn" aria-label="参照エラーを閉じる" onClick={reference.dismissError}>
              ✕
            </button>
          </div>
        )}

        {reference.items.length === 0 ? (
          <div className="reference-empty">
            <p className="hint reference-intro">
              参照画像を渡して、キャラクター・スタイル・衣装の見た目をそろえます（PNG / JPEG / WebP、複数枚可）。
            </p>
            <p className="hint reference-cost-note">
              精密参照は Opus 無料枠の対象外です。有効な参照 1 枚あたり {PRECISE_REFERENCE_ANLAS} Anlas かかります（最大 {MAX_PRECISE_REFERENCES} 枚）。
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={reference.loading}
              onClick={() => addInputRef.current?.click()}
            >
              {reference.loading ? '読み込み中…' : '参照画像を選択'}
            </button>
          </div>
        ) : (
          <div className="reference-body">
            <div className="reference-list">
              {reference.items.map((item, index) => {
                const slotId = `${id}-${item.id}`;
                return (
                  <article
                    key={item.id}
                    className={`reference-card${item.enabled ? '' : ' is-disabled'}`}
                    aria-label={`参照画像 ${index + 1}`}
                  >
                    <div className="reference-preview-card">
                      <span className="reference-slot-badge">#{index + 1}</span>
                      <img src={item.previewUrl} alt={`参照画像 ${index + 1}: ${item.name}`} className="reference-thumb" />
                      <div className="reference-preview-meta">
                        <p className="reference-name" title={item.name}>
                          {item.name}
                        </p>
                        <div className="reference-file-actions">
                          {reference.items.length > 1 && (
                            <>
                              <button
                                type="button"
                                className="btn btn-small"
                                disabled={index === 0}
                                aria-label={`参照画像 ${index + 1} を上へ移動`}
                                title="上へ移動"
                                onClick={() => reference.moveItem(item.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="btn btn-small"
                                disabled={index === reference.items.length - 1}
                                aria-label={`参照画像 ${index + 1} を下へ移動`}
                                title="下へ移動"
                                onClick={() => reference.moveItem(item.id, 1)}
                              >
                                ↓
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={reference.loading}
                            onClick={() => {
                              replacingIdRef.current = item.id;
                              replaceInputRef.current?.click();
                            }}
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

                    <label className="check-line reference-enable-label" htmlFor={`${slotId}-enabled`}>
                      <input
                        id={`${slotId}-enabled`}
                        type="checkbox"
                        role="switch"
                        checked={item.enabled}
                        onChange={(e) => reference.setEnabled(item.id, e.target.checked)}
                      />
                      <span>
                        {item.enabled
                          ? `有効（+${PRECISE_REFERENCE_ANLAS} Anlas）`
                          : '一時 OFF（通常生成 / +0 Anlas）'}
                      </span>
                    </label>

                    <div className="field">
                      <span id={`${slotId}-type-label`}>種別</span>
                      <div
                        className="reference-type-group"
                        role="radiogroup"
                        aria-labelledby={`${slotId}-type-label`}
                        onKeyDown={(e) => onTypeKeyDown(item.id, item.type, e)}
                      >
                        {PRECISE_REFERENCE_TYPES.map((t, typeIndex) => {
                          const selected = item.type === t.value;
                          return (
                            <button
                              key={t.value}
                              ref={(el) => {
                                if (!typeRefs.current[item.id]) typeRefs.current[item.id] = [];
                                typeRefs.current[item.id]![typeIndex] = el;
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
                      <label htmlFor={`${slotId}-strength`}>
                        強さ（{PRECISE_REFERENCE_STRENGTH_MIN}〜{PRECISE_REFERENCE_STRENGTH_MAX.toFixed(1)}）
                      </label>
                      <div className="fader-row">
                        <input
                          id={`${slotId}-strength`}
                          type="range"
                          min={PRECISE_REFERENCE_STRENGTH_MIN}
                          max={PRECISE_REFERENCE_STRENGTH_MAX}
                          step={PRECISE_REFERENCE_STRENGTH_STEP}
                          value={item.strength}
                          onChange={(e) => reference.setStrength(item.id, Number(e.target.value))}
                        />
                        <output htmlFor={`${slotId}-strength`}>{item.strength.toFixed(2)}</output>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="reference-footer">
              <button
                type="button"
                className="btn"
                disabled={reference.loading || atLimit}
                onClick={() => addInputRef.current?.click()}
              >
                {reference.loading
                  ? '読み込み中…'
                  : `参照画像を追加（${reference.items.length}/${MAX_PRECISE_REFERENCES}）`}
              </button>
              <p className="hint reference-cost-note">
                {activeCount > 0
                  ? `精密参照は Opus の無料枠対象外です（有効 ${activeCount} 枚 / +${totalAnlas} Anlas）。`
                  : 'すべて一時 OFF 中のため、画像を保持したまま通常の生成（+0 Anlas）を行います。'}
              </p>
            </div>
          </div>
        )}
      </section>

      {inpaint && (
        <section className="reference-section inpaint-panel-section" aria-labelledby={`${id}-inpaint-heading`}>
          <div className="reference-head">
            <h3 id={`${id}-inpaint-heading`} className="reference-title">
              インペイント（部分描き直し）
            </h3>
            <div className="reference-head-actions">
              <span className="chip">
                {inpaint.activeSession ? 'インペイント中' : inpaintSession ? '一時 OFF' : '無料枠対応'}
              </span>
            </div>
          </div>

          <input
            ref={inpaintInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="inpaint-file-input"
            hidden
            onChange={onInpaintFileChange}
          />

          {inpaint.error && (
            <div className="gen-error" role="alert">
              <p>{inpaint.error}</p>
              <button
                type="button"
                className="icon-btn"
                aria-label="インペイントエラーを閉じる"
                onClick={inpaint.dismissError}
              >
                ✕
              </button>
            </div>
          )}

          {activeCount > 0 && (
            <p className="hint inpaint-exclusion-note">
              精密参照とインペイントは同時に使えません。インペイントを開くときに精密参照を一時 OFF へ切り替えられます。
            </p>
          )}

          {inpaintSession ? (
            <article className={`inpaint-session-card${inpaint.activeSession ? '' : ' is-disabled'}`} aria-label="一時保持中のインペイント">
              <div className="reference-preview-card">
                <img
                  src={inpaintSession.sourceUrl}
                  alt={`インペイント対象: ${inpaintSession.name}`}
                  className="inpaint-session-thumb"
                />
                <div className="reference-preview-meta">
                  <p className="reference-name" title={inpaintSession.name}>
                    {inpaintSession.name}
                  </p>
                  <p className="hint inpaint-session-meta">
                    {inpaintSession.width}×{inpaintSession.height} ·{' '}
                    {inpaintHasMask ? 'マスク描画済み' : 'マスク未描画'} · 強さ{' '}
                    {inpaintSession.strength.toFixed(2)}
                  </p>
                  <div className="reference-file-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={() => (onResumeInpaint ? onResumeInpaint() : inpaint.resume())}
                    >
                      マスク編集を再開
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={inpaint.loading}
                      onClick={() => inpaintInputRef.current?.click()}
                    >
                      {inpaint.loading ? '読み込み中…' : '別の画像で開始'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => (onDiscardInpaint ? onDiscardInpaint() : inpaint.discard())}
                    >
                      破棄
                    </button>
                  </div>
                </div>
              </div>
              <label className="check-line reference-enable-label" htmlFor={`${id}-inpaint-enabled`}>
                <input
                  id={`${id}-inpaint-enabled`}
                  type="checkbox"
                  role="switch"
                  checked={Boolean(inpaint.activeSession)}
                  disabled={!inpaintHasMask}
                  onChange={(e) => {
                    if (onToggleInpaintEnabled) onToggleInpaintEnabled(e.target.checked);
                    else inpaint.setEnabled(e.target.checked);
                  }}
                />
                <span>
                  {inpaint.activeSession
                    ? '有効（通常の「生成する」ボタンでインペイント実行）'
                    : inpaintHasMask
                      ? '一時 OFF（通常生成）'
                      : 'マスクを描画して確定すると有効にできます'}
                </span>
              </label>
            </article>
          ) : (
            <div className="reference-empty">
              <p className="hint reference-intro">
                画像の一部をマスクで塗って描き直します（PNG / JPEG / WebP、無料枠サイズへ自動調整）。
              </p>
              <button
                type="button"
                className="btn"
                disabled={inpaint.loading}
                onClick={() => inpaintInputRef.current?.click()}
              >
                {inpaint.loading ? '読み込み中…' : '画像を選択してインペイント'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
