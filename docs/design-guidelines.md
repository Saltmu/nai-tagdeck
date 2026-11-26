# nai-tagdeck 画面デザインガイド

UI の追加・改修時に見た目・操作感・ダークモード対応・モバイル配慮がブレないようにするための基準。
値の正本は [src/styles/tokens.css](../src/styles/tokens.css) に置き、この文書では判断基準と再利用する部品をまとめる。

## 1. 基本方針

- **ツール優先の密度設計**: タグ編集と画像生成を反復する作業画面のため、装飾より視認性・一覧性・操作回数の少なさを優先する。
- **ライト / ダーク同格**: すべての要素で両テーマのコントラストを確保する。[tokens.css](../src/styles/tokens.css) でテーマに依存するトークンを追加・変更するときは、`:root`、`@media (prefers-color-scheme: dark)` 内の `:root:not([data-theme='light'])`、`:root[data-theme='dark']` の 3 ブロックを常に同期させる。
- **生成画像に左右されない操作性**: 生成画像の上に重なるボタンやラベルは下地の明暗が不定のため、テーマ連動色ではなく `--overlay-*` または `--scrim-*` を使う。
- **段階的適用**: 既存の機能別 CSS を一括で書き換えず、新規実装・今後触る箇所から本ガイドのトークンと共通クラスへ寄せる。

## 2. デザイントークン（正本：`src/styles/tokens.css`）

### カラー

| カテゴリ | トークン | 主な用途 |
| --- | --- | --- |
| 背景・面 | `--bg`, `--surface`, `--surface-2` | ページ背景、カード／ヘッダー面、副次面・ホバー面 |
| 文字・罫線 | `--text`, `--muted`, `--border` | 本文、補助文・アイコン、枠線・区切り線 |
| アクセント | `--accent`, `--accent-hover`, `--accent-text`, `--accent-soft` | 主操作、選択中タブ・アクティブ背景 |
| 状態 | `--danger`, `--weighted` | 危険操作の文字／枠・エラー、重み付きタグ強調 |
| 危険操作（塗りつぶし） | `--danger-fill`, `--danger-fill-hover`, `--danger-fill-soft`, `--danger-fill-text` | 白文字を載せる赤背景の危険ボタン（テーマ非連動） |
| 通知・背景幕 | `--toast-bg`, `--toast-text`, `--backdrop`, `--backdrop-strong`, `--suggest-dim` | 下部トースト、モーダル背景（`::backdrop` は古いブラウザ互換のためフォールバック併記可）、ビューアなど強い暗転が要る背景幕、候補表示中に周りを覆うグレー（後ろ 2 つはテーマ非連動） |
| 画像上オーバーレイ | `--overlay-*`, `--scrim-bg`, `--scrim-text` | 生成画像・ビューア上の操作ボタン（テーマ非連動） |

### 角丸

新規コードでは原則として以下の 4 段階を使う（既存の `--radius` は `--radius-lg` と同値の互換エイリアス）。円形ボタンは `50%`、親の角丸に追従する要素は `inherit` を使ってよい。

| トークン | 値 | 主な用途 |
| --- | --- | --- |
| `--radius-sm` | `6px` | アコーディオン、小さなチップ・内側要素 |
| `--radius-md` | `8px` | ボタン、入力欄、タブ、メニュー項目 |
| `--radius-lg`（`--radius`） | `10px` | カード、ダイアログ、パネル枠 |
| `--radius-pill` | `999px` | トースト、件数バッジ、ピル型ラベル |

例外として、構造固有の角丸はトークン化せず直書きしてよい（該当箇所に理由コメントを明記する）。

- `2px`: ドラッグハンドル（`dock.css` の `.dock-bar::before`）、インラインハイライト（`editor.css` の `.tag-name mark`）
- `4px`: 極小座標ラベル（`characters.css` の `.center-marker-label`）、インライン `code`（`token.css` の `.token-status code`）
- `16px 16px 0 0`: ボトムシートの上角（`dock.css` のモバイル時 `.dock`）

### 文字サイズ

- 基準は `body { font-size: 15px; line-height: 1.5; }`（[base.css](../src/styles/base.css)）。
- **必須制約**: `input:not([type='checkbox'])` / `select` / `textarea` は iOS での自動ズームを防ぐため **`16px` 以上** を維持する。

| トークン | 値 | 主な用途 |
| --- | --- | --- |
| `--text-xs` | `0.75rem` | 件数バッジ、極小ラベル・補足 |
| `--text-caption` | `0.8rem` | フォームラベル、比較 UI の見出し・注記などの高密度な補助テキスト |
| `--text-sm` | `0.85rem` | 小ボタン、副次的な見出し・補足テキスト |
| `--text-base` | `1rem` | カード見出し、標準テキスト |
| `--text-lg` | `1.1rem` | ダイアログ見出し |

例外として、単独ページの `h1` はページ固有サイズを直書きしてよい（該当箇所に理由コメントを明記する）。例：チュートリアルの `.tutorial-header-brand h1` は `1.25rem`。

### 影・重なり順・固定領域オフセット

- **影**: 通常面は `--shadow`、浮遊要素（メニュー・トースト・ダイアログ）は `--shadow-pop` を使う。
- **重なり順**: 画面全体に関わる重なりは必ず [tokens.css](../src/styles/tokens.css) の `--z-*`（10 刻み）に登録して使う。独立したスタッキングコンテキスト内の局所的な重なり（`1` / `2` 等）のみ直書きしてよいが、適用範囲をコメントで明記する。
- **固定領域オフセット**: ヘッダー・ドック・下部バーとの重なり回避には `--header-height` / `--dock-offset` / `--generate-bar-height` / `--latest-offset` を使う。

## 3. 再利用する共通部品

新しい UI を作るときは、専用クラスを新設する前に以下の既存クラスを優先利用する。

| 役割 | 主なクラス | 定義ファイル |
| --- | --- | --- |
| カード・折りたたみ | `.card`, `.card-head`, `.card-title`, `.accordion-list`, `.accordion`, `.accordion-summary`, `.accordion-body` | [cards.css](../src/styles/cards.css) |
| ボタン | `.btn`, `.btn-primary`, `.btn-small`, `.btn-danger`, `.btn-ghost`, `.icon-btn`, `.icon-btn.has-label` | [buttons.css](../src/styles/buttons.css) |
| 危険領域 | `.danger-zone`, `.danger-confirm` | [buttons.css](../src/styles/buttons.css) |
| フォーム | `.field`, `.inline-field`, `.form-actions`, `.form-error` | [forms.css](../src/styles/forms.css), [cards.css](../src/styles/cards.css) |
| ダイアログ | `.app-dialog`, `.app-dialog-confirm`, `.app-dialog-scroll`, `.app-dialog-title`, `.app-dialog-message`, `.app-dialog-details`, `.app-dialog-choices`, `.app-dialog-choice`, `.app-dialog-actions` | [dialog.css](../src/styles/dialog.css) |
| 通知・バナー | `.toast`, `.sw-update`, `.tab-sync`, `.error-banner` | [toast.css](../src/styles/toast.css), [sw-update.css](../src/styles/sw-update.css), [layout.css](../src/styles/layout.css) |

## 4. レスポンシブ・タッチ・アクセシビリティ

### ブレイクポイント

| 基準 | 役割 | 主な該当ファイル |
| --- | --- | --- |
| `1100px` | 2 ペイン（編集＋生成並列）⇔ 狭い画面（タブ切替＋下部固定バー） | [workbench.css](../src/styles/workbench.css), [dock.css](../src/styles/dock.css), [generate-bar.css](../src/styles/generate-bar.css), [latest.css](../src/styles/latest.css) |
| `768px` | モバイル ⇔ タブレット／デスクトップ（ヘッダー余白、フォーム列、タグ行折り返し） | [responsive.css](../src/styles/responsive.css), [layout.css](../src/styles/layout.css), [seed-lock.css](../src/styles/seed-lock.css) |
| `@container` | ペイン幅に応じたグリッド列数切替（`620px` / `980px`） | [workbench.css](../src/styles/workbench.css) |
| 局所ブレイクポイント | 特定要素の溢れ・折り返し防止（例：`389px`, `519px`, `804px`, `900px`） | 新設時は何を防ぐ値かをコメントに明記する |

### タッチ・安全領域・アクセシビリティ

- **操作領域**: 標準の `.btn`・入力欄は `min-height: 40px`、`.btn-small` は `34px`、`.icon-btn` は `36px`。タッチ端末（`@media (pointer: coarse)`）での拡大・間引きルールは [touch.css](../src/styles/touch.css) に集約し、主要操作は `44px` を目安とする。
- **ダブルタップズーム抑制**: 連打や切替を行う操作ボタンには `touch-action: manipulation` を付ける。
- **安全領域**: 画面端に接する固定要素・左右余白には `env(safe-area-inset-*)` を使う。
- **フォーカス・モーション・読み上げ**:
  - `:focus-visible` のアウトライン（[base.css](../src/styles/base.css)）を消さない。
  - アニメーションを追加するときは `@media (prefers-reduced-motion: reduce)` でも最終状態が正しく機能することを確認する。
  - 視覚的に隠すラベルには `.visually-hidden` を使う。

## 5. 改修時のチェックリスト（Do / Don't）

- **Do**: [tokens.css](../src/styles/tokens.css) の変数と既存の共通クラスを優先して使う。
- **Do**: UI を変更したときは「ライト／ダーク」と「広い画面（1100px 以上）／狭い画面（768px 未満）」の両方を確認する。
- **Do**: 機能別 CSS を追加するときは [styles.css](../src/styles.css) の読み込み順（トークン → ベース・共通部品 → 機能別 → レスポンシブ／タッチ）を意識して配置する。
- **Don't**: [tokens.css](../src/styles/tokens.css) 以外の CSS に `#hex` カラーを直書きしない。
- **Don't**: `--z-*` に登録されていない大きな `z-index`（例：`9999`）を場当たりで書かない。
- **Don't**: 入力要素の `font-size` を `16px` 未満に下げない。
