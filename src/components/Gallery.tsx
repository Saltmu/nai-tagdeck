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
  onSaveConfirmed: (id: string) => void;
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
  onSaveConfirmed,
  onTogglePin,
  onPickPng,
  onReadPng,
}: Props) {
  const dialogs = useDialogs();
  const [openId, setOpenId] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
  const [zipError, setZipError] = useState('');
  const [zipMessage, setZipMessage] = useState('');
  const [zipping, setZipping] = useState<'all' | 'new' | null>(null);
  const zippingRef = useRef(false);
  const zipAllRef = useRef<HTMLButtonElement>(null);
  const openIndex = images.findIndex((img) => img.id === openId);
  const unsavedCount = images.filter((img) => !img.saveConfirmed).length;
  const downloadImage = async (image: GeneratedImage) => {
    downloadUrl(imageFileName(image), image.url);
    if (image.saveConfirmed) return;
    const saved = await dialogs.confirm(
      'PNG を保存できましたか？保存できていれば、未ダウンロードの ZIP からは外れます。',
      { okLabel: '保存できた' },
    );
    if (saved) onSaveConfirmed(image.id);
  };
  const downloadZip = async (onlyUnsaved: boolean) => {
    const targets = images.filter((img) => !onlyUnsaved || !img.saveConfirmed);
    if (targets.length === 0 || zippingRef.current) return;
    zippingRef.current = true;
    setZipping(onlyUnsaved ? 'new' : 'all');
    setZipError('');
    setZipMessage('');
    try {
      const files = [];
      for (const image of [...targets].reverse()) {
        files.push({
          name: imageFileName(image),
          data: new Uint8Array(await image.blob.arrayBuffer()),
        });
      }
      const prefix = onlyUnsaved ? 'nai-tagdeck-undownloaded' : 'nai-tagdeck';
      downloadBlob(`${prefix}-${timeStamp()}.zip`, imageZipBlob(files));
      // <a download> では保存完了を検知できない。保存できたと答えた画像だけ、次の未ダウンロード ZIP から外す。
      const saved = await dialogs.confirm(
        `${targets.length}枚の ZIP を保存できましたか？保存できていれば、次の「未ダウンロードを ZIP で保存」からは外れます。`,
        { okLabel: '保存できた' },
      );
      if (saved) {
        for (const image of targets) onSaveConfirmed(image.id);
        const unsavedLeft = images.some((img) => !img.saveConfirmed && !targets.some((target) => target.id === img.id));
        if (!unsavedLeft) zipAllRef.current?.focus();
      } else {
        setZipMessage('保存していないときは、もう一度 ZIP で保存できます。');
      }
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
            ref={zipAllRef}
            type="button"
            className="btn btn-small"
            disabled={images.length === 0}
            aria-busy={zipping === 'all'}
            onClick={() => void downloadZip(false)}
          >
            {zipping === 'all' ? 'ZIPを作成中' : 'すべて ZIP で保存'}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={unsavedCount === 0}
            title="保存できたか未確認の画像をまとめます"
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
      <p className="hint">画像はこのタブのメモリにだけあり、タブを閉じると消えます。残したい画像はピン留めするか、ZIP または PNG でダウンロードしてください。上限を超えると、ピン留めしていない画像から削除します。その中では、保存できた画像を先に、同じ条件なら古い画像から削除します。すべてピン留めしているときも同じ順です。</p>
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
      {zipMessage && <p className="notice" role="status">{zipMessage}</p>}
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
                  title={img.pinned ? 'ピン留めを外す' : '履歴の自動削除から保護する'}
                  onClick={() => onTogglePin(img.id)}
                >
                  <PinIcon filled={img.pinned} />
                </button>
                <button
                  type="button"
                  className={`btn thumb-download${img.saveConfirmed ? ' is-downloaded' : ''}`}
                  aria-label={`生成画像 ${images.length - i}のPNGを${img.saveConfirmed ? '再ダウンロード（ダウンロード済み）' : 'ダウンロード'}`}
                  title={img.saveConfirmed ? 'PNGを再ダウンロード（ダウンロード済み）' : 'PNGをダウンロード'}
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
