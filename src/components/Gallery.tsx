import { lazy, Suspense, type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { downloadBlob, downloadUrl, timeStamp } from '../lib/browser';
import { imageFileName } from '../lib/imageFileName';
import { MAX_IMAGE_HISTORY_COUNT, summarizeImageHistory } from '../lib/imageHistory';
import { ChunkErrorBoundary } from './ChunkErrorBoundary';
import { GalleryMeter } from './GalleryMeter';
import { DownloadIcon, PinIcon } from './icons';
import { useDialogs } from './Dialogs';
import type { PromptSource } from './PromptImportDialog';

const ImageViewer = lazy(() => import('./ImageViewer').then((m) => ({ default: m.ImageViewer })));

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
}: Props) {
  const dialogs = useDialogs();
  const id = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [zipError, setZipError] = useState('');
  const [zipping, setZipping] = useState(false);
  const zippingRef = useRef(false);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const zipAlive = useRef(true);
  useEffect(() => {
    zipAlive.current = true;
    return () => {
      zipAlive.current = false;
    };
  }, []);
  const openIndex = images.findIndex((img) => img.id === openId);
  const stats = summarizeImageHistory(images);
  const { pinnedCount, isAtLimit, usedMb, maxMb } = stats;

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
    onReadPng({ blob, name, fallbackImage });
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
      ) : (
        <ul className="thumbs">
          {generating && (
            <li className="thumb is-pending" style={thumbStyle(pendingSize.width, pendingSize.height)}>
              <span className="spinner" aria-hidden="true" />
              <span className="visually-hidden">生成中</span>
            </li>
          )}
          {images.map((img, i) => (
            <li key={img.id} className="thumb-frame" style={ratioVar(img.width, img.height)}>
              <div className={`thumb${img.pinned ? ' is-pinned' : ''}`}>
                <button type="button" className="thumb-btn" onClick={() => setOpenId(img.id)}>
                  <img src={i === 0 ? img.url : (img.thumbUrl ?? img.url)} alt={`生成画像 ${images.length - i}（シード ${img.seed}）`} loading="lazy" />
                </button>
              </div>
              <div className="thumb-actions">
                <button
                  type="button"
                  className={`btn thumb-pin${img.pinned ? ' is-pinned' : ''}`}
                  aria-pressed={img.pinned}
                  aria-label={`生成画像 ${images.length - i}をピン留め`}
                  title={img.pinned ? 'ピン留めを外す' : 'ピン留め（上限超過時に後から削除・ZIP保存対象）'}
                  onClick={() => onTogglePin(img.id)}
                >
                  <PinIcon filled={img.pinned} />
                </button>
                <button
                  type="button"
                  className={`btn thumb-download${img.downloaded ? ' is-downloaded' : ''}`}
                  aria-label={`生成画像 ${images.length - i}のPNGを${img.downloaded ? '再ダウンロード（DL操作済み）' : 'ダウンロード'}`}
                  title={img.downloaded ? 'PNGを再ダウンロード（DL操作済み）' : 'PNGをダウンロード'}
                  onClick={() => downloadImage(img)}
                >
                  <DownloadIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {openIndex >= 0 && (
        <ChunkErrorBoundary>
          <Suspense fallback={null}>
            <ImageViewer
              image={images[openIndex]!}
              hasPrev={openIndex > 0}
              hasNext={openIndex < images.length - 1}
              onPrev={() => setOpenId(images[openIndex - 1]?.id ?? null)}
              onNext={() => setOpenId(images[openIndex + 1]?.id ?? null)}
              onClose={() => setOpenId(null)}
              onRemove={() => {
                const next = images[openIndex + 1] ?? images[openIndex - 1];
                onRemove(images[openIndex]!.id);
                setOpenId(next?.id ?? null);
              }}
              onUseSeed={onUseSeed}
              onDownload={() => downloadImage(images[openIndex]!)}
              onTogglePin={() => onTogglePin(images[openIndex]!.id)}
              onImportPrompt={onPickPng ? () => {
                const image = images[openIndex]!;
                openImport(image.blob, imageFileName(image), image);
              } : undefined}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}
    </section>
  );
}
