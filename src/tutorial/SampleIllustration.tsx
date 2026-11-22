interface Props {
  /** 夕焼け（sunset）タグが有効か */
  sunset?: boolean;
  /** 帽子（hat）タグが有効か */
  hat?: boolean;
  /** 画像のアスペクト比ラベル */
  sizeLabel?: string;
}

/** チュートリアル用の「夕暮れの街を歩く人物」生成例（事前用意のインライン SVG）。 */
export function SampleIllustration({ sunset = true, hat = false, sizeLabel }: Props) {
  return (
    <figure className="tutorial-illustration">
      <svg
        viewBox="0 0 360 440"
        role="img"
        aria-label={`夕暮れの街を歩く人物の生成例${hat ? '（帽子あり）' : '（帽子なし）'}`}
        className="tutorial-illustration-svg"
      >
        <defs>
          <linearGradient id="tut-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sunset ? '#312e81' : '#1e3a8a'} />
            <stop offset="52%" stopColor={sunset ? '#c2410c' : '#3b82f6'} />
            <stop offset="100%" stopColor={sunset ? '#fbbf24' : '#bfdbfe'} />
          </linearGradient>
          <linearGradient id="tut-road" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
        </defs>
        {/* 空 */}
        <rect x="0" y="0" width="360" height="295" fill="url(#tut-sky)" />
        {/* 夕日 */}
        {sunset && <circle cx="265" cy="195" r="44" fill="#fde68a" opacity="0.9" />}
        {/* 遠景の街並み */}
        <path
          d="M0 295 L0 190 L42 190 L42 220 L78 220 L78 165 L120 165 L120 230 L160 230 L160 185 L204 185 L204 235 L248 235 L248 175 L296 175 L296 210 L360 210 L360 295 Z"
          fill="#1e293b"
          opacity="0.88"
        />
        {/* 窓明かり */}
        <g fill="#fef08a" opacity="0.85">
          <rect x="14" y="210" width="8" height="10" />
          <rect x="26" y="210" width="8" height="10" />
          <rect x="90" y="185" width="9" height="11" />
          <rect x="104" y="185" width="9" height="11" />
          <rect x="172" y="205" width="9" height="11" />
          <rect x="260" y="195" width="9" height="11" />
          <rect x="275" y="195" width="9" height="11" />
        </g>
        {/* 街灯 */}
        <rect x="58" y="145" width="5" height="150" fill="#0f172a" />
        <circle cx="60" cy="145" r="10" fill="#fef08a" opacity="0.92" />
        {/* 歩道 */}
        <rect x="0" y="295" width="360" height="145" fill="url(#tut-road)" />
        <line x1="0" y1="315" x2="360" y2="315" stroke="#64748b" strokeWidth="2" opacity="0.5" />
        {/* 人物シルエット（歩く人物） */}
        <g transform="translate(180, 175)">
          {/* 長い髪 */}
          <path d="M-22 18 C-30 55 -28 92 -20 112 L22 112 C30 90 28 52 20 18 Z" fill="#1e1b4b" />
          {/* 顔 */}
          <circle cx="0" cy="18" r="20" fill="#fde4cf" />
          {/* 前髪 */}
          <path d="M-20 14 C-18 -8 18 -8 20 14 C10 6 -10 6 -20 14 Z" fill="#1e1b4b" />
          {/* 帽子（ON のときだけ表示） */}
          {hat && (
            <g>
              <ellipse cx="0" cy="2" rx="30" ry="7" fill="#7c2d12" />
              <path d="M-18 2 C-16 -18 16 -18 18 2 Z" fill="#9a3412" />
            </g>
          )}
          {/* コート */}
          <path d="M-22 44 L22 44 L34 150 L-34 150 Z" fill="#4338ca" />
          {/* マフラー */}
          <rect x="-18" y="38" width="36" height="12" rx="6" fill="#f97316" />
          {/* 脚（歩いているポーズ） */}
          <path d="M-14 150 L-24 215 L-10 215 L-2 150 Z" fill="#0f172a" />
          <path d="M8 150 L24 215 L10 215 L-2 150 Z" fill="#1e293b" />
        </g>
      </svg>
      <figcaption className="tutorial-illustration-caption">
        生成例：夕暮れの街を歩く人物{sizeLabel ? `（${sizeLabel}）` : ''}
      </figcaption>
    </figure>
  );
}
