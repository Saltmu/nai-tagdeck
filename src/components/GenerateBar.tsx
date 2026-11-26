import { useLayoutEffect, useRef } from 'react';
import type { Generator } from '../hooks/useGenerator';
import type { TokenState } from '../hooks/useToken';
import type { AnlasState } from '../hooks/useAnlas';
import { estimateAnlasCost, PRECISE_REFERENCE_ANLAS, type AnlasEstimate } from '../lib/anlasEstimate';
import { resolveSize, sizeChangePatch, type GenerationSettings, type SizeKey } from '../lib/generation';
import { isFreeGeneration } from '../lib/novelai';
import { referenceTypeLabel, type PreciseReferenceItem } from '../lib/referenceImage';
import { AnlasLine } from './AnlasBalance';
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
  /** 有効な精密参照の先頭アイテム（ON インジケーター表示用）。 */
  activeReference?: PreciseReferenceItem | null;
  /** インジケーターから精密参照を一時 OFF にする。 */
  onDisableReference?: () => void;
  /** インジケーター押下で参照画像タブを開く。 */
  onOpenReferenceTab?: () => void;
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
  activeReference,
  onDisableReference,
  onOpenReferenceTab,
}: Props) {
  const barRef = useRef<HTMLElement>(null);
  const { generating } = generator;
  const customSize = resolveSize(generation);
  const effectiveReferenceCount = referenceCount ?? (activeReference ? 1 : 0);
  const resolvedEstimate =
    estimate ??
    estimateAnlasCost({
      subscription: anlas?.status === 'ready' ? anlas.subscription : null,
      baseIsFree: isFreeGeneration({ width: customSize.width, height: customSize.height, steps: generation.steps }),
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

  return (
    <section ref={barRef} className="generate-bar" aria-label="生成操作">
      {anlas && <AnlasLine anlas={anlas} estimate={resolvedEstimate} />}
      {activeReference && (
        <div className="gen-ref-indicator" role="status">
          {onOpenReferenceTab ? (
            <button
              type="button"
              className="gen-ref-summary"
              onClick={onOpenReferenceTab}
              aria-label={`精密参照 ON（${referenceTypeLabel(activeReference.type)} / +${PRECISE_REFERENCE_ANLAS} Anlas）。参照画像パネルを開く`}
            >
              <img src={activeReference.previewUrl} alt="" className="gen-ref-thumb" />
              <span className="gen-ref-text">
                精密参照 ON（{referenceTypeLabel(activeReference.type)} / +{PRECISE_REFERENCE_ANLAS} Anlas）
              </span>
            </button>
          ) : (
            <div className="gen-ref-summary">
              <img src={activeReference.previewUrl} alt="" className="gen-ref-thumb" />
              <span className="gen-ref-text">
                精密参照 ON（{referenceTypeLabel(activeReference.type)} / +{PRECISE_REFERENCE_ANLAS} Anlas）
              </span>
            </div>
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
      {blocker && token.token && <p className="hint gen-blocker">{blocker}</p>}
      <div className="gen-actions">
        <SizePicker size={generation.size} customSize={customSize} onSizeChange={handleSizeChange} />
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
    </section>
  );
}
