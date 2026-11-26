import { MAX_IMAGE_HISTORY_COUNT, type ImageHistoryStats } from '../lib/imageHistory';
import { DownloadIcon, PinIcon, TempIcon } from './icons';

interface Props {
  stats: ImageHistoryStats;
  maxCount?: number;
}

export function GalleryMeter({ stats, maxCount = MAX_IMAGE_HISTORY_COUNT }: Props) {
  const {
    count,
    pinnedCount,
    downloadedCount,
    pinnedWidth,
    unsavedWidth,
    savedWidth,
    usedMb,
    maxMb,
  } = stats;

  return (
    <div
      className="gallery-meter"
      role="group"
      aria-label={`タブを閉じると消去 ${count}/${maxCount}枚・${usedMb}/${maxMb}MB（ピン留め ${pinnedCount}枚、DL操作済み ${downloadedCount}枚）`}
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
            <li>上限（{maxCount}枚・{maxMb}MB）を超えると、新しく生成した画像を残し、既存の画像から「ピン留め以外 → DL操作済 → 古い順」で削除されます（既存の画像がすべてピン留めのときは、ピン留め画像から同じ順で削除）。</li>
            <li>DL操作済はダウンロード開始時に付きます（保存をキャンセルした場合も対象）。保存完了はブラウザで確認してください。</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
