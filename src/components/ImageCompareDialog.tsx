import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import {
  diffGeneratedImages,
  formatTagWithWeight,
  type PromptDiff,
} from '../lib/imageCompare';
import { formatWeight } from '../lib/prompt';
import { CheckIcon, CloseIcon, DownloadIcon, LockIcon, PinIcon } from './icons';
import { FIT_NORMALIZED_VIEW, type NormalizedZoomView, ViewerZoomStage } from './ViewerZoomStage';

export type CompareViewMode = 'side-by-side' | 'flip';

interface Props {
  imageA: GeneratedImage;
  imageB: GeneratedImage;
  onSwap: () => void;
  onClose: () => void;
  onTogglePin: (id: string) => void;
  onDownload: (image: GeneratedImage) => void;
  onUseSeed: (seed: number) => void;
  onImportPrompt?: (image: GeneratedImage) => void;
}

const COMPARE_STATE = 'naiTagdeckCompare';
const isCompareState = (state: unknown) =>
  typeof state === 'object' && state !== null && (state as Record<string, unknown>)[COMPARE_STATE] === true;

const COPY_MS = 1500;

function PromptDiffBlock({ title, diff }: { title: string; diff: PromptDiff }) {
  return (
    <div className="compare-prompt-block">
      <h4 className="compare-prompt-title">{title}</h4>
      {!diff.hasChanges ? (
        <p className="compare-no-diff">差分なし（一致 {diff.same.length} 件）</p>
      ) : (
        <ul className="compare-tag-list">
          {diff.changed.map((item, idx) => (
            <li key={`c-${idx}-${item.tag}`} className="compare-tag is-changed">
              <span className="compare-tag-badge" aria-label="重み変更">重み変更</span>
              <span className="compare-tag-text">
                {item.tag}: {formatWeight(item.weightA)} → {formatWeight(item.weightB)}
              </span>
            </li>
          ))}
          {diff.removed.map((item, idx) => (
            <li key={`r-${idx}-${item.tag}`} className="compare-tag is-removed">
              <span className="compare-tag-badge" aria-label="A のみ">- Aのみ</span>
              <span className="compare-tag-text">{formatTagWithWeight(item.tag, item.weight)}</span>
            </li>
          ))}
          {diff.added.map((item, idx) => (
            <li key={`a-${idx}-${item.tag}`} className="compare-tag is-added">
              <span className="compare-tag-badge" aria-label="B のみ">+ Bのみ</span>
              <span className="compare-tag-text">{formatTagWithWeight(item.tag, item.weight)}</span>
            </li>
          ))}
        </ul>
      )}
      {diff.same.length > 0 && diff.hasChanges && (
        <details className="compare-same-details">
          <summary>一致するタグ（{diff.same.length} 件）</summary>
          <p className="compare-same-tags">
            {diff.same.map((item) => formatTagWithWeight(item.tag, item.weight)).join(', ')}
          </p>
        </details>
      )}
    </div>
  );
}

interface PaneHeaderProps {
  label: 'A' | 'B';
  image: GeneratedImage;
  seedApplied: boolean;
  onTogglePin: () => void;
  onDownload: () => void;
  onUseSeed: () => void;
  onImportPrompt?: () => void;
}

function ComparePaneHeader({
  label,
  image,
  seedApplied,
  onTogglePin,
  onDownload,
  onUseSeed,
  onImportPrompt,
}: PaneHeaderProps) {
  return (
    <div className="compare-pane-head">
      <div className="compare-pane-meta">
        <span className={`compare-badge is-${label.toLowerCase()}`}>{label}</span>
        <span className="compare-pane-seed">シード {image.seed}</span>
        <span className="compare-pane-time">{new Date(image.createdAt).toLocaleTimeString()}</span>
      </div>
      <div className="compare-pane-actions">
        <button
          type="button"
          className="icon-btn"
          aria-pressed={image.pinned}
          aria-label={`画像 ${label} をピン留め`}
          title={image.pinned ? 'ピン留めを外す' : 'ピン留め'}
          onClick={onTogglePin}
        >
          <PinIcon filled={image.pinned} />
        </button>
        <button
          type="button"
          className={`icon-btn${image.downloaded ? ' is-downloaded' : ''}`}
          aria-label={`画像 ${label} のPNGを${image.downloaded ? '再ダウンロード（DL操作済み）' : 'ダウンロード'}`}
          title={image.downloaded ? 'PNGを再ダウンロード（DL操作済み）' : 'PNGをダウンロード'}
          onClick={onDownload}
        >
          <DownloadIcon />
        </button>
        <button
          type="button"
          className="btn btn-small"
          aria-label={seedApplied ? `画像 ${label} のシードを設定済み` : `画像 ${label} のシードを次に使う`}
          title={seedApplied ? '設定済み' : 'このシードを次の生成で使う'}
          onClick={onUseSeed}
        >
          {seedApplied ? <CheckIcon /> : <LockIcon />}
          <span>{seedApplied ? '設定済み' : 'シード'}</span>
        </button>
        {onImportPrompt && (
          <button
            type="button"
            className="btn btn-small"
            aria-label={`画像 ${label} のプロンプトを読み込む`}
            onClick={onImportPrompt}
          >
            読込
          </button>
        )}
      </div>
    </div>
  );
}

export function ImageCompareDialog({
  imageA,
  imageB,
  onSwap,
  onClose,
  onTogglePin,
  onDownload,
  onUseSeed,
  onImportPrompt,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [viewMode, setViewMode] = useState<CompareViewMode>('side-by-side');
  const [flipSide, setFlipSide] = useState<'A' | 'B'>('A');
  const [syncZoom, setSyncZoom] = useState(true);
  const [sharedZoom, setSharedZoom] = useState<NormalizedZoomView>(FIT_NORMALIZED_VIEW);
  const [metaDiffOnly, setMetaDiffOnly] = useState(false);
  const [appliedSeedId, setAppliedSeedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const diff = useMemo(() => diffGeneratedImages(imageA, imageB), [imageA, imageB]);
  const visibleMeta = useMemo(
    () => (metaDiffOnly ? diff.meta.filter((row) => row.changed) : diff.meta),
    [diff.meta, metaDiffOnly],
  );

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    if (!appliedSeedId) return;
    const t = setTimeout(() => setAppliedSeedId(null), COPY_MS);
    return () => clearTimeout(t);
  }, [appliedSeedId]);

  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    if (!isCompareState(window.history.state)) window.history.pushState({ [COMPARE_STATE]: true }, '');
    const onPopState = () => dialog.current?.close();
    window.addEventListener('popstate', onPopState);
    return () => {
      active.current = false;
      window.removeEventListener('popstate', onPopState);
      queueMicrotask(() => {
        if (!active.current && isCompareState(window.history.state)) window.history.back();
      });
    };
  }, []);

  const handleApplySeed = (image: GeneratedImage, label: 'A' | 'B') => {
    onUseSeed(image.seed);
    setAppliedSeedId(image.id);
    setAnnouncement(`画像 ${label} のシード ${image.seed} を次の生成に設定しました`);
  };

  const toggleFlip = () => {
    setFlipSide((prev) => {
      const next = prev === 'A' ? 'B' : 'A';
      setAnnouncement(`画像 ${next} を表示中`);
      return next;
    });
  };

  const activeFlipImage = flipSide === 'A' ? imageA : imageB;

  return (
    <dialog
      ref={dialog}
      className="viewer compare-dialog"
      aria-label="2枚の画像を比較"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) dialog.current?.close();
      }}
      onKeyDown={(e) => {
        if (viewMode === 'flip' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          const target = e.target as HTMLElement | null;
          if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
          e.preventDefault();
          toggleFlip();
        }
      }}
    >
      <div className="compare-body">
        <header className="compare-header">
          <div className="compare-header-controls">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                onSwap();
                setAnnouncement('画像 A と B を入れ替えました');
              }}
            >
              A ⇄ B 入れ替え
            </button>
            <div className="compare-mode-group" role="group" aria-label="表示モード">
              <button
                type="button"
                className={`btn btn-small${viewMode === 'side-by-side' ? ' is-active' : ''}`}
                aria-pressed={viewMode === 'side-by-side'}
                onClick={() => setViewMode('side-by-side')}
              >
                並べて表示
              </button>
              <button
                type="button"
                className={`btn btn-small${viewMode === 'flip' ? ' is-active' : ''}`}
                aria-pressed={viewMode === 'flip'}
                onClick={() => setViewMode('flip')}
              >
                A・B 切替
              </button>
            </div>
            {viewMode === 'side-by-side' && (
              <button
                type="button"
                className={`btn btn-small${syncZoom ? ' is-active' : ''}`}
                aria-pressed={syncZoom}
                onClick={() => {
                  setSyncZoom((prev) => !prev);
                  setSharedZoom(FIT_NORMALIZED_VIEW);
                }}
              >
                ズーム連動
              </button>
            )}
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => dialog.current?.close()}
            aria-label="閉じる"
            title="閉じる"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="compare-main">
          {viewMode === 'side-by-side' ? (
            <div className="compare-stages is-side-by-side">
              <section className="compare-pane" aria-label="比較画像 A">
                <ComparePaneHeader
                  label="A"
                  image={imageA}
                  seedApplied={appliedSeedId === imageA.id}
                  onTogglePin={() => onTogglePin(imageA.id)}
                  onDownload={() => onDownload(imageA)}
                  onUseSeed={() => handleApplySeed(imageA, 'A')}
                  onImportPrompt={onImportPrompt ? () => onImportPrompt(imageA) : undefined}
                />
                <ViewerZoomStage
                  src={imageA.url}
                  alt={`比較画像 A（シード ${imageA.seed}）`}
                  hasPrev={false}
                  hasNext={false}
                  onPrev={() => {}}
                  onNext={() => {}}
                  showClose={false}
                  syncView={syncZoom ? sharedZoom : undefined}
                  onSyncViewChange={syncZoom ? setSharedZoom : undefined}
                />
              </section>
              <section className="compare-pane" aria-label="比較画像 B">
                <ComparePaneHeader
                  label="B"
                  image={imageB}
                  seedApplied={appliedSeedId === imageB.id}
                  onTogglePin={() => onTogglePin(imageB.id)}
                  onDownload={() => onDownload(imageB)}
                  onUseSeed={() => handleApplySeed(imageB, 'B')}
                  onImportPrompt={onImportPrompt ? () => onImportPrompt(imageB) : undefined}
                />
                <ViewerZoomStage
                  src={imageB.url}
                  alt={`比較画像 B（シード ${imageB.seed}）`}
                  hasPrev={false}
                  hasNext={false}
                  onPrev={() => {}}
                  onNext={() => {}}
                  showClose={false}
                  syncView={syncZoom ? sharedZoom : undefined}
                  onSyncViewChange={syncZoom ? setSharedZoom : undefined}
                />
              </section>
            </div>
          ) : (
            <div className="compare-stages is-flip">
              <div className="compare-flip-bar" role="group" aria-label="表示する画像の切替">
                <button
                  type="button"
                  className={`btn btn-small${flipSide === 'A' ? ' is-active' : ''}`}
                  aria-pressed={flipSide === 'A'}
                  onClick={() => {
                    setFlipSide('A');
                    setAnnouncement('画像 A を表示中');
                  }}
                >
                  A（シード {imageA.seed}）
                </button>
                <button
                  type="button"
                  className={`btn btn-small${flipSide === 'B' ? ' is-active' : ''}`}
                  aria-pressed={flipSide === 'B'}
                  onClick={() => {
                    setFlipSide('B');
                    setAnnouncement('画像 B を表示中');
                  }}
                >
                  B（シード {imageB.seed}）
                </button>
                <span className="hint compare-flip-hint">画像タップ・左右キーでも切替</span>
              </div>
              <section className="compare-pane" aria-label={`比較画像 ${flipSide}`}>
                <ComparePaneHeader
                  label={flipSide}
                  image={activeFlipImage}
                  seedApplied={appliedSeedId === activeFlipImage.id}
                  onTogglePin={() => onTogglePin(activeFlipImage.id)}
                  onDownload={() => onDownload(activeFlipImage)}
                  onUseSeed={() => handleApplySeed(activeFlipImage, flipSide)}
                  onImportPrompt={onImportPrompt ? () => onImportPrompt(activeFlipImage) : undefined}
                />
                <ViewerZoomStage
                  src={activeFlipImage.url}
                  alt={`比較画像 ${flipSide}（シード ${activeFlipImage.seed}）`}
                  hasPrev={false}
                  hasNext={false}
                  onPrev={() => {}}
                  onNext={() => {}}
                  showClose={false}
                  syncView={sharedZoom}
                  onSyncViewChange={setSharedZoom}
                  onSingleTap={toggleFlip}
                />
              </section>
            </div>
          )}

          <aside className="compare-diff-panel" tabIndex={0} aria-label="設定とプロンプトの差分">
            <section className="compare-section">
              <div className="compare-section-head">
                <h3>設定の差分</h3>
                <label className="compare-diff-only">
                  <input
                    type="checkbox"
                    checked={metaDiffOnly}
                    onChange={(e) => setMetaDiffOnly(e.target.checked)}
                  />
                  <span>差分のみ表示</span>
                </label>
              </div>
              {visibleMeta.length === 0 ? (
                <p className="compare-no-diff">設定に差分はありません</p>
              ) : (
                <table className="compare-meta-table">
                  <thead>
                    <tr>
                      <th scope="col">項目</th>
                      <th scope="col">A</th>
                      <th scope="col">B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMeta.map((row) => (
                      <tr key={row.key} className={row.changed ? 'is-changed' : undefined}>
                        <th scope="row">{row.label}</th>
                        <td>{row.valueA}</td>
                        <td>{row.valueB}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="compare-section">
              <h3>プロンプトの差分</h3>
              <PromptDiffBlock title="ベースプロンプト" diff={diff.basePrompt} />
              {diff.characters.map((ch) => (
                <div key={ch.index} className="compare-char-block">
                  <div className="compare-char-head">
                    <h4>
                      キャラ {ch.index + 1}
                      {!ch.presentA && <span className="compare-tag-badge is-added">+ Bのみ</span>}
                      {!ch.presentB && <span className="compare-tag-badge is-removed">- Aのみ</span>}
                    </h4>
                    {ch.centerChanged && (
                      <span className="compare-center-diff">
                        座標: {ch.centerLabelA} → {ch.centerLabelB}
                      </span>
                    )}
                  </div>
                  <PromptDiffBlock title={`キャラ ${ch.index + 1} 正プロンプト`} diff={ch.prompt} />
                  {(ch.negative.hasChanges || ch.negative.same.length > 0) && (
                    <PromptDiffBlock title={`キャラ ${ch.index + 1} ネガティブ`} diff={ch.negative} />
                  )}
                </div>
              ))}
              {diff.hasNegativeData && (
                <PromptDiffBlock title="全体ネガティブ" diff={diff.negativePrompt} />
              )}
            </section>
          </aside>
        </div>

        <span className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </span>
      </div>
    </dialog>
  );
}
