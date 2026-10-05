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
