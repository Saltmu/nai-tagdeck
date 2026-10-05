import { useState } from 'react';
import type { GeneratedImage } from '../hooks/useImages';
import { downloadBlob } from '../lib/browser';
import { ImageViewer, imageFileName } from './ImageViewer';

interface Props {
  images: GeneratedImage[];
  generating: boolean;
  /** 生成中のプレースホルダーの縦横比に使う。 */
  pendingSize: { width: number; height: number };
  onRemove: (id: string) => void;
  onClear: () => void;
  onUseSeed: (seed: number) => void;
}

export function Gallery({ images, generating, pendingSize, onRemove, onClear, onUseSeed }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = images.findIndex((img) => img.id === openId);

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
          onClick={() => {
            if (window.confirm(`画像 ${images.length}枚をすべて削除しますか？（保存していない画像は戻せません）`)) onClear();
          }}
        >
          すべて削除
        </button>
      </div>
      <p className="hint">画像はこのタブのメモリにだけあり、タブを閉じると消えます。残したい画像は保存してください。</p>

      {images.length === 0 && !generating ? null : (
        <ul className="thumbs">
          {generating && (
            <li className="thumb is-pending" style={{ aspectRatio: `${pendingSize.width} / ${pendingSize.height}` }}>
              <span className="spinner" aria-hidden="true" />
              <span className="visually-hidden">生成中</span>
            </li>
          )}
          {images.map((img, i) => (
            <li key={img.id} className="thumb" style={{ aspectRatio: `${img.width} / ${img.height}` }}>
              <button type="button" className="thumb-btn" onClick={() => setOpenId(img.id)}>
                <img src={img.url} alt={`生成画像 ${images.length - i}（シード ${img.seed}）`} loading="lazy" />
              </button>
              <button
                type="button"
                className="btn thumb-download"
                aria-label={`生成画像 ${images.length - i}をダウンロード`}
                title="ダウンロード"
                onClick={() => downloadBlob(imageFileName(img), img.blob)}
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
        />
      )}
    </section>
  );
}
