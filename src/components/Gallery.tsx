import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { usePngDrop } from '../hooks/usePngDrop';
import { downloadBlob, downloadUrl, timeStamp } from '../lib/browser';
import { MAX_IMAGE_HISTORY_COUNT } from '../lib/imageHistory';
import { imageZipBlob } from '../lib/imageZip';
import { ImageViewer, imageFileName } from './ImageViewer';
import { DownloadIcon, PinIcon, TempIcon } from './icons';
import { useDialogs } from './Dialogs';
import type { PromptSource } from './PromptImportDialog';

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
  const [openId, setOpenId] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
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
  const meterScale = Math.max(MAX_IMAGE_HISTORY_COUNT, images.length);

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
      downloadBlob(`nai-tagdeck-pinned-${timeStamp()}.zip`, imageZipBlob(files));
      for (const image of targets) onDownloaded(image.id);
    } catch {
      setZipError('ZIP の作成に失敗しました');
    } finally {
      zippingRef.current = false;
      setZipping(false);
    }
  };
  const openImport = (blob: Blob, name: string) => {
    setFileError('');
    setOpenId(null);
    onReadPng({ blob, name });
  };
  const { dragging, dropProps } = usePngDrop({
    enabled: !!onPickPng,
    onDropFile: ({ blob, name }) => openImport(blob, name),
    onMultipleFiles: () => setFileError('PNG を1枚ずつドロップしてください'),
  });

  return (
    <section className="card gallery" aria-label="生成した画像">
      <div className="card-head">
        <h2 className="card-title">
          画像
          <span className={`count${images.length >= MAX_IMAGE_HISTORY_COUNT ? ' is-full' : ''}`}>
            {images.length}/{MAX_IMAGE_HISTORY_COUNT}
          </span>
        </h2>
        <div className="gallery-actions">
          <button
            type="button"
            className="btn btn-small gallery-zip-btn"
            disabled={pinnedCount === 0}
            aria-busy={zipping}
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
            onClick={async () => {
              const ok = await dialogs.confirm(`画像 ${images.length}枚をすべて削除しますか？（ダウンロードしていない画像は戻せません）`, {
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

      <div
        className="gallery-meter"
        role="group"
        aria-label={`タブ内一時保存 ${images.length}/${MAX_IMAGE_HISTORY_COUNT}枚（ピン留め保護 ${pinnedCount}枚、保存済み ${downloadedCount}枚）`}
      >
        <div className="gallery-meter-bar" aria-hidden="true">
          {pinnedCount > 0 && (
            <span
              className="gallery-meter-seg is-pinned"
              style={{ width: `${(pinnedCount / meterScale) * 100}%` }}
            />
          )}
          {unpinnedUndownloadedCount > 0 && (
            <span
              className="gallery-meter-seg is-unsaved"
              style={{ width: `${(unpinnedUndownloadedCount / meterScale) * 100}%` }}
            />
          )}
          {unpinnedDownloadedCount > 0 && (
            <span
              className="gallery-meter-seg is-saved"
              style={{ width: `${(unpinnedDownloadedCount / meterScale) * 100}%` }}
            />
          )}
        </div>
        <div className="gallery-meter-meta">
          <span className="gallery-chip is-ephemeral" title="このタブのメモリに一時保存（タブを閉じると消去）">
            <TempIcon />
            <span>タブ一時保存</span>
          </span>
          <span className="gallery-chip is-pinned" title="ピン留め画像は自動削除から保護され、ZIP 保存の対象になります">
            <PinIcon filled />
            <span>保護 {pinnedCount}</span>
          </span>
          <span className="gallery-chip is-saved" title="上限時はピン留め以外から、保存済み・古い順に自動削除">
            <DownloadIcon />
            <span>保存済 {downloadedCount}</span>
          </span>
        </div>
      </div>

      <div
        className={`png-drop-zone${dragging ? ' is-dragging' : ''}`}
        {...dropProps}
      >
        <button type="button" className="btn btn-small" disabled={!onPickPng} onClick={() => {
          setFileError('');
          onPickPng?.();
        }}>
          PNGから読み込む
        </button>
        <span className="hint">または NovelAI の PNG をここにドロップ</span>
      </div>
      {fileError && <p className="error-banner" role="alert">{fileError}</p>}
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

      {images.length === 0 && !generating ? null : (
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
                  title={img.pinned ? 'ピン留めを外す' : '自動削除から保護して ZIP 保存対象にする'}
                  onClick={() => onTogglePin(img.id)}
                >
                  <PinIcon filled={img.pinned} />
                </button>
                <button
                  type="button"
                  className={`btn thumb-download${img.downloaded ? ' is-downloaded' : ''}`}
                  aria-label={`生成画像 ${images.length - i}のPNGを${img.downloaded ? '再ダウンロード（ダウンロード済み）' : 'ダウンロード'}`}
                  title={img.downloaded ? 'PNGを再ダウンロード（ダウンロード済み）' : 'PNGをダウンロード'}
                  onClick={() => downloadImage(img)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {openIndex >= 0 && (
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
            openImport(image.blob, imageFileName(image));
          } : undefined}
        />
      )}
    </section>
  );
}
