import { useId, useLayoutEffect, useRef } from 'react';
import type { Generator } from '../hooks/useGenerator';
import type { InpaintSession } from '../hooks/useInpaintSession';
import type { TokenState } from '../hooks/useToken';
import type { AnlasState } from '../hooks/useAnlas';
import { estimateAnlasCost, PRECISE_REFERENCE_ANLAS, type AnlasEstimate } from '../lib/anlasEstimate';
import { resolveSize, sizeChangePatch, type GenerationSettings, type SizeKey } from '../lib/generation';
import { isFreeGeneration } from '../lib/novelai';
import { referenceTypeLabel, type PreciseReferenceItem } from '../lib/referenceImage';
import { AnlasCostBadge } from './AnlasBalance';
import { NextIcon } from './icons';
import { SizePicker } from './SizePicker';

interface Props {
  generation: GenerationSettings;
  onGenerationChange: (patch: Partial<GenerationSettings>) => void;
  generator: Generator;
  token: TokenState;
  /** 生成できない理由（なければ null）。 */
  blocker: string | null;
  onGenerate: () => void;
  /** Anlas 残高の表示状態。渡さないときは残高の行を出さない。 */
  anlas?: AnlasState;
  /** 事前見積もり。省略時は生成設定と購読情報から算出する。 */
  estimate?: AnlasEstimate;
  /** 有効な精密参照の枚数（#130 用。estimate 未指定時の見積もりに使う）。 */
  referenceCount?: number;
  /** 有効な精密参照一覧（ON インジケーター表示用）。 */
  activeReferences?: readonly PreciseReferenceItem[];
  /** 後方互換: 単一の有効な精密参照アイテム。 */
  activeReference?: PreciseReferenceItem | null;
  /** インジケーターから精密参照を一時 OFF にする。 */
  onDisableReference?: () => void;
  /** インジケーター押下で参照画像タブを開く。 */
  onOpenReferenceTab?: () => void;
  /** 有効なインペイントセッション（インペイント中インジケーター表示用）。 */
  inpaintSession?: InpaintSession | null;
  /** インペイント中インジケーター押下でインペイント画面に戻る。 */
  onResumeInpaint?: () => void;
  /** インペイント中インジケーターからインペイントを一時 OFF にする。 */
  onDisableInpaint?: () => void;
}

/**
 * 生成ボタンとサイズのピクトグラムを常に下部に置くバー。
 * 編集タブでも生成タブでも表示する（生成ペインの子だが、狭い画面では画面下端に固定する）。
 * サイズは生成パネルのサイズ選択と同一の状態（generation.size）を操作し、表示も一致する。
 */
export function GenerateBar({
  generation,
  onGenerationChange,
  generator,
  token,
  blocker,
  onGenerate,
  anlas,
  estimate,
  referenceCount,
  activeReferences,
  activeReference,
  onDisableReference,
  onOpenReferenceTab,
  inpaintSession,
  onResumeInpaint,
  onDisableInpaint,
}: Props) {
  const barRef = useRef<HTMLElement>(null);
  const costBadgeId = useId();
  const { generating } = generator;
  const showCostBadge = Boolean(anlas || estimate);
  const customSize = resolveSize(generation);
  const activeList = inpaintSession ? [] : (activeReferences ?? (activeReference ? [activeReference] : []));
  const effectiveReferenceCount = inpaintSession ? 0 : (referenceCount ?? activeList.length);
  const additionalAnlas = effectiveReferenceCount * PRECISE_REFERENCE_ANLAS;
  const summaryText =
    activeList.length === 1
      ? `精密参照 ON（${referenceTypeLabel(activeList[0]!.type)} / +${additionalAnlas} Anlas）`
      : `精密参照 ${activeList.length}枚 ON（+${additionalAnlas} Anlas）`;
  const inpaintSummaryText = inpaintSession
    ? `インペイント中（${inpaintSession.width}×${inpaintSession.height} / 強さ ${inpaintSession.strength.toFixed(2)}）`
    : '';
  const effectiveSize = inpaintSession
    ? { width: inpaintSession.width, height: inpaintSession.height }
    : customSize;
  const resolvedEstimate =
    estimate ??
    estimateAnlasCost({
      subscription: anlas?.status === 'ready' ? anlas.subscription : null,
      baseIsFree: isFreeGeneration({ width: effectiveSize.width, height: effectiveSize.height, steps: generation.steps }),
      referenceCount: effectiveReferenceCount,
    });

  // 狭い画面では下端に固定するため、実測の高さを --generate-bar-height として公開する。
  // ドックや通知の持ち上げに使う。作業画面でなければ高さは 0 になる。
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const publish = () => {
      const height = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--generate-bar-height', `${height}px`);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        document.documentElement.style.removeProperty('--generate-bar-height');
      };
    }
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--generate-bar-height');
    };
  }, []);

  /** ピクトグラムからのサイズ変更。カスタムは現在の実効寸法で入る。 */
  const handleSizeChange = (next: SizeKey) => {
    onGenerationChange(sizeChangePatch(generation, next));
  };

  const indicatorContent = (
    <>
      <span className="gen-ref-thumbs" aria-hidden="true">
        {activeList.slice(0, 3).map((ref) => (
          <img key={ref.id} src={ref.previewUrl} alt="" className="gen-ref-thumb" />
        ))}
        {activeList.length > 3 && <span className="gen-ref-more">+{activeList.length - 3}</span>}
      </span>
      <span className="gen-ref-text">{summaryText}</span>
    </>
  );

  const inpaintIndicatorContent = inpaintSession && (
    <>
      <img src={inpaintSession.sourceUrl} alt="" className="gen-inpaint-thumb" aria-hidden="true" />
      <span className="gen-inpaint-text">{inpaintSummaryText}</span>
      {onResumeInpaint && (
        <span className="gen-inpaint-return" aria-hidden="true">
          戻る
          <NextIcon />
        </span>
      )}
    </>
  );

  return (
    <section ref={barRef} className="generate-bar" aria-label="生成操作">
      {activeList.length > 0 && (
        <div className="gen-ref-indicator" role="status">
          {onOpenReferenceTab ? (
            <button
              type="button"
              className="gen-ref-summary"
              onClick={onOpenReferenceTab}
              aria-label={`${summaryText}。参照画像パネルを開く`}
            >
              {indicatorContent}
            </button>
          ) : (
            <div className="gen-ref-summary">{indicatorContent}</div>
          )}
          {onDisableReference && (
            <button
              type="button"
              className="btn btn-small gen-ref-disable"
              onClick={onDisableReference}
              aria-label="精密参照を一時 OFF にする"
            >
              一時 OFF
            </button>
          )}
        </div>
      )}
      {inpaintSession && (
        <div className="gen-inpaint-indicator" role="status">
          {onResumeInpaint ? (
            <button
              type="button"
              className="gen-inpaint-summary"
              onClick={onResumeInpaint}
              aria-label={`${inpaintSummaryText}。インペイント画面に戻る`}
              title="インペイント画面に戻る"
            >
              {inpaintIndicatorContent}
            </button>
          ) : (
            <div className="gen-inpaint-summary">{inpaintIndicatorContent}</div>
          )}
          {onDisableInpaint && (
            <button
              type="button"
              className="btn btn-small gen-inpaint-disable"
              onClick={onDisableInpaint}
              aria-label="インペイントを一時 OFF にする"
            >
              一時 OFF
            </button>
          )}
        </div>
      )}
      {blocker && token.token && <p className="hint gen-blocker">{blocker}</p>}
      <div className="gen-actions">
        <SizePicker size={generation.size} customSize={customSize} onSizeChange={handleSizeChange} />
        {generating && (
          <button type="button" className="btn" onClick={generator.cancel}>
            中止
          </button>
        )}
        <div className="gen-submit-wrap">
          <button
            type="button"
            className="btn btn-primary btn-large"
            disabled={generating || blocker !== null}
            title={blocker ?? undefined}
            aria-describedby={showCostBadge ? costBadgeId : undefined}
            onClick={onGenerate}
          >
            {generating ? (
              <>
                <span className="spinner spinner-small" aria-hidden="true" />
                <span>生成中…</span>
              </>
            ) : (
              '生成する'
            )}
          </button>
          {showCostBadge && <AnlasCostBadge id={costBadgeId} estimate={resolvedEstimate} />}
        </div>
      </div>
    </section>
  );
}
