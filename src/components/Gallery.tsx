import { type CSSProperties, type DragEvent, useRef, useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { downloadUrl } from '../lib/browser';
import { ImageViewer, imageFileName } from './ImageViewer';
import { useDialogs } from './Dialogs';
import type { PromptSource } from './PromptImportDialog';

interface Props {
  images: GeneratedImage[];
  generating: boolean;
  /** 生成中のプレースホルダーの縦横比に使う。 */
  pendingSize: { width: number; height: number };
  onRemove: (id: string) => void;
  onClear: () => void;
  onUseSeed: (seed: number) => void;
  onDownloaded: (id: string) => void;
  onPickPng?: () => void;
  onReadPng: (source: PromptSource) => void;
}

/** 先頭（最新）の1枚は全幅で大きく見せる。その幅の上限を縦横比から決めるため --ar を渡す。 */
function thumbStyle(width: number, height: number): CSSProperties {
  return { aspectRatio: `${width} / ${height}`, '--ar': width / height } as CSSProperties;
}

export function Gallery({ images, generating, pendingSize, onRemove, onClear, onUseSeed, onDownloaded, onPickPng, onReadPng }: Props) {
  const dialogs = useDialogs();
  const [openId, setOpenId] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const openIndex = images.findIndex((img) => img.id === openId);
  const downloadImage = (image: GeneratedImage) => {
    downloadUrl(imageFileName(image), image.url);
    onDownloaded(image.id);
  };
  const openImport = (blob: Blob, name: string) => {
    setFileError('');
    setOpenId(null);
    onReadPng({ blob, name });
  };
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <section className="card gallery" aria-label="生成した画像">
      <div className="card-head">
        <h2 className="card-title">
          画像<span className="count">{images.length}枚</span>
        </h2>
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
      <p className="hint">画像はこのタブのメモリにだけあり、タブを閉じると消えます。残したい画像はダウンロードしてください。</p>
      <div
        className={`png-drop-zone${dragging ? ' is-dragging' : ''}`}
        onDragEnter={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          if (onPickPng) {
            dragDepth.current++;
            setDragging(true);
          }
        }}
        onDragOver={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = onPickPng ? 'copy' : 'none';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!onPickPng) return;
          const files = e.dataTransfer.files;
          if (files.length > 1) setFileError('PNG を1枚ずつドロップしてください');
          else if (files[0]) openImport(files[0], files[0].name);
        }}
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

      {images.length === 0 && !generating ? null : (
        <ul className="thumbs">
          {generating && (
            <li className="thumb is-pending" style={thumbStyle(pendingSize.width, pendingSize.height)}>
              <span className="spinner" aria-hidden="true" />
              <span className="visually-hidden">生成中</span>
            </li>
          )}
          {images.map((img, i) => (
            <li key={img.id} className="thumb" style={thumbStyle(img.width, img.height)}>
              <button type="button" className="thumb-btn" onClick={() => setOpenId(img.id)}>
                <img src={i === 0 ? img.url : (img.thumbUrl ?? img.url)} alt={`生成画像 ${images.length - i}（シード ${img.seed}）`} loading="lazy" />
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
          onImportPrompt={onPickPng ? () => {
            const image = images[openIndex]!;
            openImport(image.blob, imageFileName(image));
          } : undefined}
        />
      )}
    </section>
  );
}
