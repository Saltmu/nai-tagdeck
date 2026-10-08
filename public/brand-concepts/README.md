# nai-tagdeck ヘッダロゴ10案

`index.html` は、全10案のライト・ダーク比較と幅変更プレビューです。
開発サーバーでは `/brand-concepts/`、ファイル単体でも開けます。
`overview.png` は全案の一覧画像です。

各案には透過SVGを用意しています。

- `*-icon-*.svg`: ピクト単体、48 × 48
- `*-wordmark-*.svg`: 文字単体、216 × 48
- `*-lockup-*.svg`: ピクト＋文字、276 × 48
- `*-light.svg` / `*-dark.svg`: 指定テーマの固定色
- `*-auto.svg`: OSの `prefers-color-scheme` に追従

文字は正確な `nai-tagdeck` をSVG textで描画します。外部フォントは使わず、
Segoe UI / Arial（05はmonospace）にフォールバックします。
背景は透過です。現在のアプリのCSSトークンを使用しています。

## 狭いヘッダでの表示

比較ページではピクトと文字を別画像にして、ブランド部分の実際の利用可能幅で
文字を隠しています。ヘッダ本体への採用は、案を選んだあとに行います。

プレビューでは519px以下でブランドを24pxのピクトだけにします。
メニューは本体と同じ804px以下でピクトのみ、805px以上でピクト＋文字です。
スライダーの指定幅をそのままヘッダ幅に使い、表示枠より広い場合は横スクロールできます。

```html
<div class="brand-slot">
  <div class="brand" aria-label="nai-tagdeck">
    <img src="01-card-deck-icon-auto.svg" width="24" height="24" alt="">
    <img class="brand-wordmark" src="01-card-deck-wordmark-auto.svg" alt="nai-tagdeck">
  </div>
</div>
```

```css
.brand-slot { flex: 0 1 138px; min-width: 24px; container-type: inline-size; }
.brand { display: flex; align-items: center; gap: 6px; height: 24px; }
.brand img { display: block; }
.brand-wordmark { width: 108px; height: 24px; flex: none; }
@container (max-width: 137px) { .brand-wordmark { display: none; } }
```

既存の `.app-title` は519px以下で全体が非表示になります。採用時にはそのルールを
変更し、ピクトを常時表示するようにします。`auto` は現在のアプリと同じOS設定に追従します。

## 再生成

`node scripts/make-brand-concepts.mjs` でSVG・比較ページ・manifestを再生成します。
任意で `node scripts/render-brand-preview.cjs <sharpモジュールのパス>` からPNG一覧を再生成できます。
