import { type CSSProperties, useRef, useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { usePngDrop } from '../hooks/usePngDrop';
import { downloadBlob, downloadUrl, timeStamp } from '../lib/browser';
import { imageZipBlob } from '../lib/imageZip';
import { ImageViewer, imageFileName } from './ImageViewer';
import { PinIcon } from './icons';
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
function thumbStyle(width: number, height: number): CSSProperties {
  return { aspectRatio: `${width} / ${height}`, '--ar': width / height } as CSSProperties;
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
  const [zipping, setZipping] = useState<'all' | 'new' | null>(null);
  const zippingRef = useRef(false);
  const openIndex = images.findIndex((img) => img.id === openId);
  const undownloadedCount = images.filter((img) => !img.downloaded).length;
  const downloadImage = (image: GeneratedImage) => {
    downloadUrl(imageFileName(image), image.url);
    onDownloaded(image.id);
  };
  const downloadZip = async (onlyUndownloaded: boolean) => {
    const targets = images.filter((img) => !onlyUndownloaded || !img.downloaded);
    if (targets.length === 0 || zippingRef.current) return;
    zippingRef.current = true;
    setZipping(onlyUndownloaded ? 'new' : 'all');
    setZipError('');
    try {
      const files = [];
      for (const image of [...targets].reverse()) {
        files.push({
          name: imageFileName(image),
          data: new Uint8Array(await image.blob.arrayBuffer()),
        });
      }
      const prefix = onlyUndownloaded ? 'nai-tagdeck-undownloaded' : 'nai-tagdeck';
      downloadBlob(`${prefix}-${timeStamp()}.zip`, imageZipBlob(files));
      for (const image of targets) onDownloaded(image.id);
    } catch {
      setZipError('ZIP の作成に失敗しました');
    } finally {
      zippingRef.current = false;
      setZipping(null);
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
          画像<span className="count">{images.length}枚</span>
        </h2>
        <div className="gallery-actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={images.length === 0 || zipping !== null}
            aria-busy={zipping === 'all'}
            onClick={() => void downloadZip(false)}
          >
            {zipping === 'all' ? 'ZIPを作成中' : 'すべて ZIP で保存'}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={undownloadedCount === 0 || zipping !== null}
            aria-busy={zipping === 'new'}
            onClick={() => void downloadZip(true)}
          >
            {zipping === 'new' ? 'ZIPを作成中' : '未ダウンロードを ZIP で保存'}
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
      <p className="hint">画像はこのタブのメモリにだけあり、タブを閉じると消えます。残したい画像はピン留めするか、ZIP または PNG でダウンロードしてください。上限を超えるとピン留めしていない画像から削除され、すべてピン留めしているときは古い画像から削除されます。</p>
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
          <span>履歴上限のため、古い画像 {evictedCount}枚を削除しました。残したい画像はピン留めするかダウンロードしてください。</span>
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
            <li key={img.id} className={`thumb${img.pinned ? ' is-pinned' : ''}`} style={thumbStyle(img.width, img.height)}>
              <button type="button" className="thumb-btn" onClick={() => setOpenId(img.id)}>
                <img src={i === 0 ? img.url : (img.thumbUrl ?? img.url)} alt={`生成画像 ${images.length - i}（シード ${img.seed}）`} loading="lazy" />
              </button>
              <button
                type="button"
                className={`btn thumb-pin${img.pinned ? ' is-pinned' : ''}`}
                aria-pressed={img.pinned}
                aria-label={img.pinned ? `生成画像 ${images.length - i}のピン留めを外す` : `生成画像 ${images.length - i}をピン留め`}
                title={img.pinned ? 'ピン留めを外す' : '履歴の自動削除から保護する'}
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
