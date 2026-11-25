import { lazy, Suspense, type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { downloadBlob, downloadUrl, timeStamp } from '../lib/browser';
import { imageFileName } from '../lib/imageFileName';
import { MAX_IMAGE_HISTORY_BYTES, MAX_IMAGE_HISTORY_COUNT } from '../lib/imageHistory';
import { ChunkErrorBoundary } from './ChunkErrorBoundary';
import { DownloadIcon, PinIcon, TempIcon } from './icons';
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
  const pinnedCount = images.filter((img) => img.pinned).length;
  const downloadedCount = images.filter((img) => img.downloaded).length;
  const unpinnedUndownloadedCount = images.filter((img) => !img.pinned && !img.downloaded).length;
  const unpinnedDownloadedCount = images.filter((img) => !img.pinned && img.downloaded).length;
  const totalBytes = images.reduce((sum, img) => sum + img.blob.size, 0);
  const countRatio = images.length / MAX_IMAGE_HISTORY_COUNT;
  const byteRatio = totalBytes / MAX_IMAGE_HISTORY_BYTES;
  const useByteScale = byteRatio > countRatio;
  const pinnedBytes = images.reduce((sum, img) => sum + (img.pinned ? img.blob.size : 0), 0);
  const unpinnedUndownloadedBytes = images.reduce((sum, img) => sum + (!img.pinned && !img.downloaded ? img.blob.size : 0), 0);
  const unpinnedDownloadedBytes = images.reduce((sum, img) => sum + (!img.pinned && img.downloaded ? img.blob.size : 0), 0);
  const meterScale = useByteScale
    ? Math.max(MAX_IMAGE_HISTORY_BYTES, totalBytes)
    : Math.max(MAX_IMAGE_HISTORY_COUNT, images.length);
  const pinnedWidth = ((useByteScale ? pinnedBytes : pinnedCount) / meterScale) * 100;
  const unsavedWidth = ((useByteScale ? unpinnedUndownloadedBytes : unpinnedUndownloadedCount) / meterScale) * 100;
  const savedWidth = ((useByteScale ? unpinnedDownloadedBytes : unpinnedDownloadedCount) / meterScale) * 100;
  const isAtLimit = images.length >= MAX_IMAGE_HISTORY_COUNT || totalBytes >= MAX_IMAGE_HISTORY_BYTES;
  const mib = 1024 * 1024;
  const usedMb = totalBytes === 0 ? '0' : (totalBytes / mib < 10 ? (totalBytes / mib).toFixed(1) : String(Math.round(totalBytes / mib)));
  const maxMb = Math.round(MAX_IMAGE_HISTORY_BYTES / mib);

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

      <div
        className="gallery-meter"
        role="group"
        aria-label={`タブを閉じると消去 ${images.length}/${MAX_IMAGE_HISTORY_COUNT}枚・${usedMb}/${maxMb}MB（ピン留め ${pinnedCount}枚、DL操作済み ${downloadedCount}枚）`}
      >
        <div className="gallery-meter-bar" aria-hidden="true">
          {pinnedWidth > 0 && (
            <span
              className="gallery-meter-seg is-pinned"
              style={{ width: `${pinnedWidth}%` }}
            />
          )}
          {unsavedWidth > 0 && (
            <span
              className="gallery-meter-seg is-unsaved"
              style={{ width: `${unsavedWidth}%` }}
            />
          )}
          {savedWidth > 0 && (
            <span
              className="gallery-meter-seg is-saved"
              style={{ width: `${savedWidth}%` }}
            />
          )}
        </div>
        <div className="gallery-meter-meta">
          <span className="gallery-chip is-ephemeral">
            <TempIcon />
            <span>タブを閉じると消去</span>
          </span>
          <span className="gallery-chip is-pinned">
            <PinIcon filled />
            <span>ピン留め {pinnedCount}</span>
          </span>
          <span className="gallery-chip is-saved">
            <DownloadIcon />
            <span>DL操作済 {downloadedCount}</span>
          </span>
          <details className="gallery-meter-help">
            <summary aria-label="履歴上限と削除ルールの詳細">?</summary>
            <ul className="gallery-meter-rules">
              <li>画像はタブのメモリにのみ保持され、閉じると消去されます。</li>
              <li>上限（{MAX_IMAGE_HISTORY_COUNT}枚・{maxMb}MB）を超えると、新しく生成した画像を残し、既存の画像から「ピン留め以外 → DL操作済 → 古い順」で削除されます（既存の画像がすべてピン留めのときは、ピン留め画像から同じ順で削除）。</li>
              <li>DL操作済はダウンロード開始時に付きます（保存をキャンセルした場合も対象）。保存完了はブラウザで確認してください。</li>
            </ul>
          </details>
        </div>
      </div>

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
