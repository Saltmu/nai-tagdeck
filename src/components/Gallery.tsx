import { lazy, Suspense, type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { downloadBlob, downloadUrl, timeStamp } from '../lib/browser';
import { imageFileName } from '../lib/imageFileName';
import { MAX_IMAGE_HISTORY_COUNT, summarizeImageHistory } from '../lib/imageHistory';
import { ChunkErrorBoundary } from './ChunkErrorBoundary';
import { GalleryMeter } from './GalleryMeter';
import { DownloadIcon, MoreIcon, PinIcon } from './icons';
import { useDialogs } from './Dialogs';
import type { PromptSource } from './PromptImportDialog';

const ImageViewer = lazy(() => import('./ImageViewer').then((m) => ({ default: m.ImageViewer })));
const ImageCompareDialog = lazy(() => import('./ImageCompareDialog').then((m) => ({ default: m.ImageCompareDialog })));

export type GalleryFilter = 'all' | 'pinned' | 'undownloaded';

interface Props {
  images: GeneratedImage[];
  generating: boolean;
  /** 生成中のプレースホルダーの縦横比に使う。 */
  pendingSize: { width: number; height: number };
  evictedCount?: number;
  onDismissEviction?: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onUseSeed: (seed: number) => void;
  onDownloaded: (id: string) => void;
  onTogglePin: (id: string) => void;
  onPickPng?: () => void;
  onReadPng: (source: PromptSource) => void;
  onUseAsReference?: (image: GeneratedImage) => void;
}

/** 先頭（最新）の1枚は全幅で大きく見せる。その幅の上限を縦横比から決めるため --ar を渡す。 */
function ratioVar(width: number, height: number): CSSProperties {
  return { '--ar': width / height } as CSSProperties;
}

function thumbStyle(width: number, height: number): CSSProperties {
  return { ...ratioVar(width, height), aspectRatio: `${width} / ${height}` };
}

export function Gallery({
  images,
  generating,
  pendingSize,
  evictedCount = 0,
  onDismissEviction,
  onRemove,
  onClear,
  onUseSeed,
  onDownloaded,
  onTogglePin,
  onPickPng,
  onReadPng,
  onUseAsReference,
}: Props) {
  const dialogs = useDialogs();
  const id = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<GalleryFilter>('all');
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparePair, setComparePair] = useState<[string, string] | null>(null);
  const [zipError, setZipError] = useState('');
  const [zipping, setZipping] = useState(false);
  const zippingRef = useRef(false);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const openMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const zipAlive = useRef(true);
  useEffect(() => {
    zipAlive.current = true;
    return () => {
      zipAlive.current = false;
    };
  }, []);

  useEffect(() => {
    const idSet = new Set(images.map((img) => img.id));
    setSelectedIds((prev) => {
      const next = prev.filter((sid) => idSet.has(sid));
      return next.length === prev.length ? prev : next;
    });
    setComparePair((prev) => {
      if (!prev) return null;
      return idSet.has(prev[0]) && idSet.has(prev[1]) ? prev : null;
    });
    setMenuOpenId((prev) => (prev && idSet.has(prev) ? prev : null));
    if (images.length < 2) {
      setCompareMode(false);
    }
  }, [images]);

  useEffect(() => {
    if (compareMode) setMenuOpenId(null);
  }, [compareMode]);

  useEffect(() => {
    if (!menuOpenId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (openMenuWrapRef.current && !openMenuWrapRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const targetId = menuOpenId;
        setMenuOpenId(null);
        moreButtonRefs.current[targetId]?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpenId]);

  const stats = summarizeImageHistory(images);
  const { pinnedCount, isAtLimit, usedMb, maxMb } = stats;
  const undownloadedCount = images.filter((img) => !img.downloaded).length;

  const visibleImages =
    filter === 'pinned'
      ? images.filter((img) => img.pinned)
      : filter === 'undownloaded'
        ? images.filter((img) => !img.downloaded)
        : images;

  const showPending = generating && filter !== 'pinned';
  const isUniform = filter !== 'all' || compareMode;

  const openImage = openId ? images.find((img) => img.id === openId) ?? null : null;
  const visibleOpenIndex = openImage ? visibleImages.findIndex((img) => img.id === openImage.id) : -1;

  const compareImageA = comparePair ? images.find((img) => img.id === comparePair[0]) ?? null : null;
  const compareImageB = comparePair ? images.find((img) => img.id === comparePair[1]) ?? null : null;

  const downloadImage = (image: GeneratedImage) => {
    downloadUrl(imageFileName(image), image.url);
    if (!image.downloaded) onDownloaded(image.id);
  };
  const downloadPinnedZip = async () => {
    const targets = images.filter((img) => img.pinned);
    if (targets.length === 0 || zippingRef.current) return;
    zippingRef.current = true;
    setZipping(true);
    setZipError('');
    const stillPresent = () => zipAlive.current && targets.every((target) => imagesRef.current.some((img) => img.id === target.id));
    try {
      const files = [];
      for (const image of [...targets].reverse()) {
        if (!stillPresent()) return;
        files.push({
          name: imageFileName(image),
          data: new Uint8Array(await image.blob.arrayBuffer()),
        });
      }
      if (!stillPresent()) return;
      // ZIP 作成時のみ読む（初期チャンクには含めない）
      const { imageZipBlob } = await import('../lib/imageZip');
      if (!stillPresent()) return;
      downloadBlob(`nai-tagdeck-pinned-${timeStamp()}.zip`, imageZipBlob(files));
      for (const image of targets) onDownloaded(image.id);
    } catch {
      setZipError('ZIP の作成に失敗しました');
    } finally {
      zippingRef.current = false;
      setZipping(false);
    }
  };
  const openImport = (blob: Blob, name: string, fallbackImage?: GeneratedImage) => {
    setOpenId(null);
    setComparePair(null);
    setSelectedIds([]);
    setCompareMode(false);
    onReadPng({ blob, name, fallbackImage });
  };

  const toggleCompareMode = () => {
    setCompareMode((prev) => {
      if (prev) setSelectedIds([]);
      return !prev;
    });
  };

  const toggleSelectForCompare = (imageId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(imageId)) return prev.filter((sid) => sid !== imageId);
      if (prev.length >= 2) return prev;
      const next = [...prev, imageId];
      if (next.length === 2) {
        setComparePair([next[0]!, next[1]!]);
      }
      return next;
    });
  };

  const closeCompare = () => {
    setComparePair(null);
    setSelectedIds([]);
    setCompareMode(false);
  };

  return (
    <section className="card gallery" aria-label="生成した画像">
      <div className="card-head">
        <h2 className="card-title">
          画像
          <span className={`count${isAtLimit ? ' is-full' : ''}`}>
            {images.length}/{MAX_IMAGE_HISTORY_COUNT}枚 · {usedMb}/{maxMb}MB
          </span>
        </h2>
        <div className="gallery-actions">
          <button
            type="button"
            className="btn btn-small gallery-zip-btn"
            disabled={pinnedCount === 0}
            aria-busy={zipping}
            aria-describedby={pinnedCount === 0 ? `${id}-actions-hint` : undefined}
            title={pinnedCount === 0 ? 'ピン留めした画像をまとめて ZIP で保存します' : `ピン留めした ${pinnedCount}枚を ZIP で保存`}
            onClick={() => void downloadPinnedZip()}
          >
            <PinIcon filled={pinnedCount > 0} />
            <span>{zipping ? 'ZIPを作成中' : 'ピン留めを ZIP 保存'}</span>
            {pinnedCount > 0 && !zipping && <span className="gallery-zip-count">{pinnedCount}</span>}
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger"
            disabled={images.length === 0}
            aria-describedby={images.length === 0 ? `${id}-actions-hint` : undefined}
            onClick={async () => {
              const ok = await dialogs.confirm(`画像 ${images.length}枚をすべて削除しますか？（削除した画像は戻せません。DL操作済みの画像も含め、端末に保存されているか確認してから削除してください）`, {
                okLabel: 'すべて削除',
                danger: true,
              });
              if (ok) onClear();
            }}
          >
            すべて削除
          </button>
        </div>
      </div>
      {(images.length === 0 || pinnedCount === 0) && (
        <p className="hint gallery-actions-hint" id={`${id}-actions-hint`} role="note">
          {images.length === 0
            ? '画像がまだありません'
            : 'ピン留めした画像がありません。ZIP保存するには画像をピン留めしてください'}
        </p>
      )}

      <GalleryMeter stats={stats} />

      {images.length > 0 && (
        <div className="gallery-toolbar">
          <div className="gallery-filter-bar" role="group" aria-label="表示フィルタ">
            <button
              type="button"
              className={`btn btn-small gallery-filter-btn${filter === 'all' ? ' is-active' : ''}`}
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              <span>すべて</span>
              <span className="gallery-filter-count">{images.length}</span>
            </button>
            <button
              type="button"
              className={`btn btn-small gallery-filter-btn${filter === 'pinned' ? ' is-active' : ''}`}
              aria-pressed={filter === 'pinned'}
              onClick={() => setFilter('pinned')}
            >
              <span>ピン留め</span>
              <span className="gallery-filter-count">{pinnedCount}</span>
            </button>
            <button
              type="button"
              className={`btn btn-small gallery-filter-btn${filter === 'undownloaded' ? ' is-active' : ''}`}
              aria-pressed={filter === 'undownloaded'}
              onClick={() => setFilter('undownloaded')}
            >
              <span>未DL</span>
              <span className="gallery-filter-count">{undownloadedCount}</span>
            </button>
          </div>
          <button
            type="button"
            className={`btn btn-small gallery-compare-toggle${compareMode ? ' is-active' : ''}`}
            disabled={images.length < 2}
            aria-pressed={compareMode}
            onClick={toggleCompareMode}
          >
            比較
          </button>
        </div>
      )}

      {compareMode && (
        <div className="gallery-compare-bar" role="status" aria-live="polite">
          <span>比較する画像を 2 枚選んでください（{selectedIds.length}/2 枚選択中）</span>
          <div className="gallery-compare-bar-actions">
            <button
              type="button"
              className="btn btn-small"
              disabled={selectedIds.length !== 2}
              onClick={() => {
                if (selectedIds.length === 2) {
                  setComparePair([selectedIds[0]!, selectedIds[1]!]);
                }
              }}
            >
              比較を開く
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={selectedIds.length === 0}
              onClick={() => setSelectedIds([])}
            >
              選択を解除
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setCompareMode(false);
                setSelectedIds([]);
              }}
            >
              終了
            </button>
          </div>
        </div>
      )}

      {zipError && <p className="error-banner" role="alert">{zipError}</p>}
      {evictedCount > 0 && (
        <div className="notice" role="status">
          <span>履歴上限のため、古い画像 {evictedCount}枚を削除しました。</span>
          {onDismissEviction && (
            <button type="button" className="btn btn-small" onClick={onDismissEviction}>
              閉じる
            </button>
          )}
        </div>
      )}

      {images.length === 0 && !generating ? (
        <div className="gallery-empty" role="status">
          生成した画像はここに表示されます
        </div>
      ) : visibleImages.length === 0 && !showPending ? (
        <div className="gallery-empty" role="status">
          <p className="gallery-empty-text">
            {filter === 'pinned' ? 'ピン留めした画像はありません' : '未 DL の画像はありません'}
          </p>
          <button type="button" className="btn btn-small" onClick={() => setFilter('all')}>
            すべて表示
          </button>
        </div>
      ) : (
        <ul className={`thumbs${isUniform ? ' is-uniform' : ''}`}>
          {showPending && (
            <li className="thumb is-pending" style={thumbStyle(pendingSize.width, pendingSize.height)}>
              <span className="spinner" aria-hidden="true" />
              <span className="visually-hidden">生成中</span>
            </li>
          )}
          {visibleImages.map((img, i) => {
            const globalIndex = images.findIndex((item) => item.id === img.id);
            const displayNumber = globalIndex >= 0 ? images.length - globalIndex : visibleImages.length - i;
            const selectedIndex = selectedIds.indexOf(img.id);
            const compareBadge = selectedIndex === 0 ? 'A' : selectedIndex === 1 ? 'B' : null;
            const menuOpen = !compareMode && menuOpenId === img.id;
            return (
              <li key={img.id} className={`thumb-frame${menuOpen ? ' is-menu-open' : ''}`} style={ratioVar(img.width, img.height)}>
                <div className={`thumb${img.pinned ? ' is-pinned' : ''}${compareBadge ? ' is-selected' : ''}`}>
                  <button
                    type="button"
                    className={`thumb-btn${compareMode ? ' is-selectable' : ''}`}
                    aria-pressed={compareMode ? compareBadge !== null : undefined}
                    aria-label={
                      compareMode
                        ? compareBadge
                          ? `生成画像 ${displayNumber}（比較対象 ${compareBadge} に選択中）`
                          : `生成画像 ${displayNumber} を比較対象に選択`
                        : undefined
                    }
                    onClick={() => {
                      if (compareMode) toggleSelectForCompare(img.id);
                      else setOpenId(img.id);
                    }}
                  >
                    <img
                      src={!isUniform && i === 0 ? img.url : (img.thumbUrl ?? img.url)}
                      alt={`生成画像 ${displayNumber}（シード ${img.seed}）`}
                      loading="lazy"
                    />
                  </button>
                  {compareBadge && (
                    <span className={`thumb-compare-badge is-${compareBadge.toLowerCase()}`} aria-hidden="true">
                      {compareBadge}
                    </span>
                  )}
                </div>
                <div className="thumb-actions">
                  <button
                    type="button"
                    className={`btn thumb-pin${img.pinned ? ' is-pinned' : ''}`}
                    aria-pressed={img.pinned}
                    aria-label={`生成画像 ${displayNumber}をピン留め`}
                    title={img.pinned ? 'ピン留めを外す' : 'ピン留め（上限超過時に後から削除・ZIP保存対象）'}
                    onClick={() => onTogglePin(img.id)}
                  >
                    <PinIcon filled={img.pinned} />
                  </button>
                  <button
                    type="button"
                    className={`btn thumb-download${img.downloaded ? ' is-downloaded' : ''}`}
                    aria-label={`生成画像 ${displayNumber}のPNGを${img.downloaded ? '再ダウンロード（DL操作済み）' : 'ダウンロード'}`}
                    title={img.downloaded ? 'PNGを再ダウンロード（DL操作済み）' : 'PNGをダウンロード'}
                    onClick={() => downloadImage(img)}
                  >
                    <DownloadIcon />
                  </button>
                  {!compareMode && onUseAsReference && (
                    <div className="thumb-menu-wrap" ref={menuOpen ? openMenuWrapRef : undefined}>
                      <button
                        ref={(el) => { moreButtonRefs.current[img.id] = el; }}
                        type="button"
                        className="btn thumb-more"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? `${id}-menu-${img.id}` : undefined}
                        aria-label={`生成画像 ${displayNumber}のメニュー`}
                        title="その他の操作"
                        onClick={() => setMenuOpenId((prev) => (prev === img.id ? null : img.id))}
                      >
                        <MoreIcon />
                      </button>
                      {menuOpen && (
                        <div
                          id={`${id}-menu-${img.id}`}
                          className="thumb-menu"
                          role="menu"
                          aria-label={`生成画像 ${displayNumber}の操作`}
                        >
                          <button
                            type="button"
                            className="thumb-menu-item"
                            role="menuitem"
                            autoFocus
                            onClick={() => {
                              setMenuOpenId(null);
                              onUseAsReference(img);
                            }}
                          >
                            参照に使う
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {openImage && (
        <ChunkErrorBoundary>
          <Suspense fallback={null}>
            <ImageViewer
              image={openImage}
              hasPrev={visibleOpenIndex > 0}
              hasNext={visibleOpenIndex >= 0 && visibleOpenIndex < visibleImages.length - 1}
              onPrev={() => setOpenId(visibleImages[visibleOpenIndex - 1]?.id ?? null)}
              onNext={() => setOpenId(visibleImages[visibleOpenIndex + 1]?.id ?? null)}
              onClose={() => setOpenId(null)}
              onRemove={() => {
                const next =
                  visibleOpenIndex >= 0
                    ? visibleImages[visibleOpenIndex + 1] ?? visibleImages[visibleOpenIndex - 1]
                    : visibleImages[0];
                onRemove(openImage.id);
                setOpenId(next?.id ?? null);
              }}
              onUseSeed={onUseSeed}
              onDownload={() => downloadImage(openImage)}
              onTogglePin={() => onTogglePin(openImage.id)}
              onImportPrompt={onPickPng ? () => openImport(openImage.blob, imageFileName(openImage), openImage) : undefined}
              onUseAsReference={
                onUseAsReference
                  ? () => {
                      setOpenId(null);
                      onUseAsReference(openImage);
                    }
                  : undefined
              }
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      {compareImageA && compareImageB && (
        <ChunkErrorBoundary>
          <Suspense fallback={null}>
            <ImageCompareDialog
              imageA={compareImageA}
              imageB={compareImageB}
              onSwap={() => setComparePair((prev) => (prev ? [prev[1], prev[0]] : null))}
              onClose={closeCompare}
              onTogglePin={onTogglePin}
              onDownload={downloadImage}
              onUseSeed={onUseSeed}
              onImportPrompt={onPickPng ? (img) => openImport(img.blob, imageFileName(img), img) : undefined}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}
    </section>
  );
}
