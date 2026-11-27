/** 小さなピクトグラム。色は currentColor に従う。 */

interface SizeIconProps {
  width: number;
  height: number;
}

/** 画像の縦横比をそのまま長方形で描く（長い辺を 14px に合わせる）。 */
export function SizeIcon({ width, height }: SizeIconProps) {
  const long = 14;
  const w = width >= height ? long : (long * width) / height;
  const h = height >= width ? long : (long * height) / width;
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect x={10 - w / 2} y={10 - h / 2} width={w} height={h} rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect x="7" y="7" width="9.5" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 13V4.8c0-.7.6-1.3 1.3-1.3H12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 生成（きらめき）。 */
export function SparkleIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path
        d="M9 2.5l1.5 4.3 4.3 1.5-4.3 1.5L9 14.1 7.5 9.8 3.2 8.3l4.3-1.5zM15.2 12.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"
        fill="currentColor"
      />
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/**
 * Anlas（NovelAI の稲妻アイコン風の金色の稲妻）。
 * 公式の画像ファイルではなく、こちらで描いた SVG。色は本家の金色に寄せている。
 */
export function AnlasIcon() {
  return (
    <svg className="icon anlas-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M11.6 1.8 4.9 11h3.5L7.4 18.2 15.1 9h-3.5Z" fill="#f5b301" />
    </svg>
  );
}

/** 更新（円形の矢印）。 */
export function RefreshIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 3.2v3.2h-3.2" {...stroke} />
    </svg>
  );
}

/** 編集（鉛筆）。 */
export function EditIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M3.5 16.5l.8-3.6L13.6 3.6a1.6 1.6 0 012.3 0l.5.5a1.6 1.6 0 010 2.3l-9.3 9.3zM12 5.2l2.8 2.8" {...stroke} />
    </svg>
  );
}

/** 辞書（本）。 */
export function BookIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M10 5.5C8.6 4.4 6.6 4 4 4v11c2.6 0 4.6.4 6 1.5M10 5.5C11.4 4.4 13.4 4 16 4v11c-2.6 0-4.6.4-6 1.5M10 5.5v11" {...stroke} />
    </svg>
  );
}

/** 辞書に登録（本とプラス）。 */
export function BookPlusIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M9 5.5C7.8 4.5 6.1 4.1 3.8 4.1v10.8c2.3 0 4 .4 5.2 1.4M9 5.5C10.2 4.5 11.9 4.1 14.2 4.1V8M9 5.5v10.8" {...stroke} />
      <path d="M15 11v5M12.5 13.5h5" {...stroke} />
    </svg>
  );
}

/** 設定（スライダー）。 */
export function SettingsIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M3.5 6h8M15 6h1.5M3.5 14H5M8.5 14h8" {...stroke} />
      <circle cx="13.2" cy="6" r="1.7" {...stroke} />
      <circle cx="6.8" cy="14" r="1.7" {...stroke} />
    </svg>
  );
}

/** 前へ（左向き山形）。 */
export function PrevIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M12.5 4.5L7 10l5.5 5.5" {...stroke} />
    </svg>
  );
}

/** 次へ（右向き山形）。 */
export function NextIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M7.5 4.5L13 10l-5.5 5.5" {...stroke} />
    </svg>
  );
}

/** 上向き山形。ドックの開閉に使う。 */
export function ChevronUpIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M4.5 12.5L10 7l5.5 5.5" {...stroke} />
    </svg>
  );
}

/** 保存（下向き矢印とトレイ）。 */
export function DownloadIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M10 3.5v9M6 8.8l4 3.9 4-3.9M3.8 13.5v2.2c0 .5.4.8.8.8h10.8c.4 0 .8-.3.8-.8v-2.2" {...stroke} />
    </svg>
  );
}

/** 削除（ごみ箱）。 */
export function TrashIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M3.5 5.5h13M8 5.5V4c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7v1.5M5.2 5.5l.7 10.3c0 .5.4.9.9.9h6.4c.5 0 .9-.4.9-.9l.7-10.3M8.4 8.6v5.2M11.6 8.6v5.2" {...stroke} />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="16" cy="10" r="1.5" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="m7 4-4 4 4 4M3 8h9a4 4 0 0 1 0 8h-2" {...stroke} />
    </svg>
  );
}

export function RedoIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="m13 4 4 4-4 4m4-4H8a4 4 0 0 0 0 8h2" {...stroke} />
    </svg>
  );
}

/** 検索（虫眼鏡）。 */
export function SearchIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="4.75" {...stroke} />
      <path d="m12 12 4 4" {...stroke} />
    </svg>
  );
}

/** 固定（錠）。 */
export function LockIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" {...stroke} />
      <path d="M7 9V6.8a3 3 0 0 1 6 0V9" {...stroke} />
    </svg>
  );
}

/** 閉じる（×）。 */
export function CloseIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" {...stroke} />
    </svg>
  );
}

/** 完了（チェック）。 */
export function CheckIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" {...stroke} />
    </svg>
  );
}

/** 並べ替え（上下の矢印）。 */
export function SortIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M6 15.5v-11m-3 3 3-3 3 3m5-3v11m-3-3 3 3 3-3" {...stroke} />
    </svg>
  );
}

/** 一括 ON/OFF（チェック／マイナス）。 */
export function ToggleAllIcon({ enable }: { enable: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect x="3.5" y="3.5" width="13" height="13" rx="2" {...stroke} />
      <path d={enable ? 'm6.8 10 2.2 2.2 4.2-4.4' : 'M7 10h6'} {...stroke} />
    </svg>
  );
}

/** ピン留め。filled のとき塗りつぶす。 */
export function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path
        d="M7.2 3.2h5.6l-.6 4.4 2.3 1.5v1.6H5.5V9.1l2.3-1.5z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 10.7V17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** 貼り付け（クリップボード）。 */
export function PasteIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M7.5 4.5h-2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-11a1 1 0 0 0-1-1h-2M7.5 10h5m-5 3h5" {...stroke} />
      <rect x="7.5" y="2.5" width="5" height="4" rx="1" {...stroke} />
    </svg>
  );
}

/** 一時保存（時計）。 */
export function TempIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" {...stroke} />
      <path d="M10 6.5V10l2.4 1.6" {...stroke} />
    </svg>
  );
}

/** ブラシ（絵筆）。 */
export function BrushIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M14.6 3.4a1.6 1.6 0 0 1 2.2 2.2L10.8 11.6 8.4 9.2Z" {...stroke} />
      <path
        d="M8.4 9.2C6.4 9.4 5.2 10.8 5 12.6c-.2 1.2-.8 2.1-1.8 2.8 1.6.9 3.8 1.1 5.4.1 1.4-.9 2.2-2.2 2.2-3.9"
        {...stroke}
      />
    </svg>
  );
}

/** 消しゴム。 */
export function EraserIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path
        d="M10 4.4a1.4 1.4 0 0 1 2 0l3.6 3.6a1.4 1.4 0 0 1 0 2L9.6 16h-2L4 12.4a1.4 1.4 0 0 1 0-2Z"
        {...stroke}
      />
      <path d="M7.2 7.2 12.8 12.8M9.6 16h6.9" {...stroke} />
    </svg>
  );
}

/** 移動（4 方向矢印）。 */
export function MoveIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M10 3.2v13.6M3.2 10h13.6" {...stroke} />
      <path
        d="M7.6 5.6 10 3.2l2.4 2.4M7.6 14.4 10 16.8l2.4-2.4M5.6 7.6 3.2 10l2.4 2.4M14.4 7.6 16.8 10l-2.4 2.4"
        {...stroke}
      />
    </svg>
  );
}

interface BrandProps {
  className?: string;
  width?: number;
  height?: number;
}

/**
 * ヘッダーのブランドアイコン（インライン SVG）。
 * 色は var(--accent) / var(--accent-text) を参照するため、手動のライト／ダーク切替に追従する。
 * <img> で外部 SVG を読むと、SVG 内の @media (prefers-color-scheme) は html[data-theme] を見ない。
 */
export function BrandIcon({ className, width = 24, height = 24 }: BrandProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" width={width} height={height} aria-hidden="true">
      <path d="M7 9h21l14 15-14 15H7Z" fill="var(--accent)" />
      <circle cx="13" cy="24" r="3" fill="var(--accent-text)" />
      <path d="m22 24 5 5 8-10" fill="none" stroke="var(--accent-text)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** ヘッダーのブランドワードマーク（インライン SVG）。文字色は var(--text) を参照する。 */
export function BrandWordmark({ className, width = 108, height = 24 }: BrandProps) {
  return (
    <svg className={className} viewBox="0 0 216 48" width={width} height={height} aria-hidden="true">
      <text
        x="0"
        y="35"
        fill="var(--text)"
        fontFamily="Segoe UI, Arial, sans-serif"
        fontSize="31"
        fontWeight="650"
        letterSpacing="-.6"
        textLength="212"
        lengthAdjust="spacingAndGlyphs"
      >
        nai-tagdeck
      </text>
    </svg>
  );
}
