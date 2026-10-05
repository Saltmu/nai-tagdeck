# nai-tagdeck

NovelAI の画像生成用プロンプトを、タグの ON/OFF で組み立てる個人用ツール。対象モデルは NovelAI Diffusion V5。

- タグをカテゴリ別に並べ、チェックボックスで ON/OFF（OFF のタグも残る）
- プロンプト全体／カテゴリ単位でコピー（ON のタグだけを `, ` で連結）
- 辞書からの前方一致サジェスト（英語タグ・日本語名・よみ。カタカナ/ひらがな・全角/半角を区別しない）
- 重みは数値（-3〜3）で持ち、出力時に `1.2::tag::` または `{tag}` / `[tag]` に変換。
  マイナス（`-1::hat::`、V4.5 以降）で要素を取り除ける
- キャラクタープロンプト（最大 6 人）。キャラごとに被写体・外見・衣装・着衣状態・ポーズのタグを持ち、
  ON/OFF・並べ替え・個別コピーができる。ヘッダーのコピーはベースのプロンプトだけ
- 公式UIからプロンプトを貼り付けると、カンマ区切り・重み・括弧を読み取ってタグにする
- 辞書の登録・編集・削除、JSON/CSV の一括入出力
- データ（辞書・作業中のタグ）はブラウザの IndexedDB にだけ保存する。サーバーには何も送らない
- NovelAI Diffusion V5 で直接生成（ブラウザから `image.novelai.net` へ。中継サーバーなし）
  - サイズ・ステップは Anlas を消費しない範囲（1024×1024 相当以下・28 steps 以下・1 枚）に限定
  - 生成画像は Blob URL でメモリにだけ置き、タブを閉じると消える。画像があるときは閉じる前に確認を出す
  - 拡大表示・保存（PNG）・削除・「このシードを使う」
- トークンは画面から入力し、このタブだけ（sessionStorage）かこのブラウザ（localStorage）に保存する

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm test           # ユニットテスト（vitest）
npm run build      # 型チェック + dist/ に出力
```

## 配置

`npm run build` で出来た `dist/` の中身を、レンタルサーバーの任意のディレクトリにアップロードする
（相対パスで出力しているのでサブディレクトリでも動く）。

- サイト全体を HTTPS + Basic 認証にする。設定例は [`deploy/htaccess.example`](deploy/htaccess.example)。
- 本番ビルドの `index.html` には CSP（外部スクリプト禁止、通信先は自サイトと `image.novelai.net` のみ）が入る。

## 辞書ファイルの形式

JSON（書き出し形式）:

```json
{ "app": "nai-tagdeck", "version": 1, "entries": [
  { "id": "…", "tag": "blonde hair", "category": "appearance", "alias": "金髪 きんぱつ",
    "default_weight": 1, "sort_order": 0, "updated_at": "2026-10-05T00:00:00.000Z" }
] }
```

`entries` だけの配列も読める。CSV は 1 行目が見出し（`tag` と `category` は必須、他は省略可）。
`category` はキーでも表示名でもよい。

| キー | 表示名 |
| --- | --- |
| `quality` | 品質 |
| `style` | 画風 |
| `subject` | 被写体・人数・関係性 |
| `appearance` | 外見 |
| `outfit` | 衣装 |
| `dress_state` | 着衣状態 |
| `pose` | ポーズ |
| `effect` | エフェクト |
| `composition` | 構図 |

読み込み時は「追加・上書き」（同じカテゴリ＋タグは上書き）か「すべて置き換え」を選ぶ。
端末間で辞書を共有するときは、JSON を書き出して別の端末で読み込む。

## ロードマップ

1. ✅ タグ編集UI・サジェスト・辞書 CRUD・入出力
2. ✅ NovelAI API での直接生成と画像一覧（メモリ保持・ダウンロード・閉じる前の確認）— [docs/novelai-api.md](docs/novelai-api.md)
3. プリセット、重み調整 UI、並べ替え、PWA 化
