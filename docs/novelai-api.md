# NovelAI 画像生成 API メモ（フェーズ2用）

調査日: 2026-10-05。対象モデル: **NovelAI Diffusion V5**（`nai-diffusion-5-full`）。
未確認だった応答形式とヒント系フィールドは、2026-11-23 に OpenAPI（`https://image.novelai.net/docs/doc.json`）を取り直して照合した。この再確認では実生成をしていない。

## 出典

- `https://docs.novelai.net/en/scripting/api-reference` はアプリ内スクリプト機能（テキスト生成）のリファレンス。画像生成 API は載っていない。
- 画像 API の OpenAPI 定義: `https://image.novelai.net/docs/doc.json`（Swagger UI: `https://image.novelai.net/docs/index.html`）。モデル名とサンプラー名の一覧はない。
- V5 のリクエスト例（第三者の検証記事）: <https://dev.to/ilan_kim/calling-the-novelai-v5-api-directly-nai-diffusion-5-full-request-body-paramsversion-4310-133a>
- 強調の記法（公式）: <https://docs.novelai.net/en/image/strengthening-weakening/>

## エンドポイント

`POST https://image.novelai.net/ai/generate-image`

- 認証: `Authorization: Bearer <token>`
- 既定のレスポンスは ZIP（中身は `image_0.png`）。2026-11-23 の OpenAPI は `produces` に `application/zip` と `application/json` を並べ、`Accept: application/json` のときは 201 で `image.ImageGenerationJsonResponse` を返すと書く:
  `{ "images": [{ "image": "<base64>", "index": 0, "seed": 123 }] }`
  （`image` は base64）。定義はモデル名で分かれていない。V5 でこの Accept を付けた実レスポンスは未取得。このツールは Accept を付けず、ZIP を `extractImages()` で読む。JSON で受け取れれば fflate は不要になる。
- 規約: 生成リクエストは人の操作で開始すること。過大な負荷になる自動化は禁止。→ ボタン1回で1枚。自動の連続生成は作らない。
- エラー時は `utils.JsonError`。`x-correlation-id` ヘッダー（英数字6文字）を付けると、500 エラーのときに問い合わせに使える。

## V5 のリクエスト

### アニメ／ケモノのモード（2026-10-05確認）

- [公式画像APIリファレンス](https://image.novelai.net/docs/doc.json) の `image.ImageGenerationRequest` と `image.RequestParameters` に、`mode` や `furry` の専用パラメータは定義されていない。
- [公式モデル説明](https://docs.novelai.net/en/image/models/) では、V5のFurryモードはプロンプト先頭に `fur dataset,` を付ける方式と説明されている。
- アプリ内部の保存値は `mode: "anime" | "furry"`。アニメでは入力プロンプトをそのまま送り、ケモノでは先頭に `fur dataset, ` を付ける。すでに先頭にある場合は重ねない。
- APIへ送るフィールドは `input` と `parameters.v4_prompt.caption.base_caption`（いずれも文字列）。同じ展開後のベースプロンプトを両方に入れる。モデルは `nai-diffusion-5-full` のまま、専用のモードフィールドは送らない。
- モードは生成設定とバックアップに保存し、旧データで未指定の場合はアニメにする。編集画面のタグと辞書は変更せず、画像履歴には実際に送ったプロンプトを保持する。
- リクエスト構築はテストで確認。今回のモード追加について、実際のAPIでの画像生成は未実施。

V5 も V4 と同じ形式（`v4_prompt`）を使う。`v5_prompt` は存在しない。実装は `src/lib/novelai.ts` の `buildGenerateRequest()`。

### 公式 Web UI が実際に送っている内容（2026-10-05 取得）

- **送り方**: `multipart/form-data` の `request` パート（`filename="blob"`、`Content-Type: application/json`）に JSON を入れている。
  このツールも同じく multipart で送る（`requestImages()`）。OpenAPI 仕様は JSON 本体だが、公式UIと同じ送り方を優先した。
- **品質タグと UC プリセットはクライアント側で展開済み**:
  - `qualityPresetId: "light"` → `input` の末尾に `very aesthetic, amazing quality, no text` が付いている。
  - `ucPresetId: "heavy"` → `negative_prompt` の先頭に heavy の文面（`DEFAULT_NEGATIVE`）が入り、その後ろにユーザーが追加した語が続く。
  - あわせて `tag_hint_qt: 3`、`tag_hint_uc_preset: 2` を送っている。2026-11-23 の OpenAPI ではどちらも説明のない `integer` である。説明がある近縁フィールドは `tag_hint_transparent_background` だけで、サーバは解釈せずモデルへ渡すヒントだと書かれている。
  - このツールでは品質タグとネガティブをタグ編集画面（ネガティブは専用タブ）で持ち、展開済みの文字列を送る。プリセット ID とヒントは送らない。
- **キャラクター**: `characterPrompts[]`（`{ prompt, uc, center, enabled }`）と
  `v4_prompt.caption.char_captions[]` / `v4_negative_prompt.caption.char_captions[]` の両方に入れる。
  座標を使わないとき（`use_coords: false`）は中心を `{x:0, y:0}` で送る。
  キャラクターに位置を指定したときは `use_coords: true` とし、指定した中心（左上 0,0、右下 1,1）を両方へ入れる。
  そのリクエストで位置を指定していないキャラは `{x:0.5, y:0.5}` にする。
  キャラごとのネガティブの既定値は `lowres, aliasing, `。個別のネガティブがあるキャラだけ、その文面を使う。
- **CFG リスケールとダイナミックしきい値**: 既定は実装当初の固定値と同じ `cfg_rescale: 0`、`dynamic_thresholding: false`。
  生成画面の詳細設定で変えた値を送る。
- **その他の値**: `use_order: true`、`legacy_uc: false`、`deliberate_euler_ancestral_bug: false`、`prefer_brownian: true`、
  `straight_alpha: true`、`add_original_image: true`、`autoSmea: false`、`normalize_reference_strength_multiple: true`。
  `image_format` は公式UIでは `"webp"` だが、このツールでは生成情報が埋め込まれる `"png"` を使う。
- **上位の階層**: `use_new_shared_trial: true`。2026-11-23 の `image.ImageGenerationRequest` にこのフィールドはない（`action`、`input`、`model`、`parameters`、`url`）。公式の意味は仕様にない。公式 UI に合わせて送る。
- `ucPreset` / `qualityToggle`（以前の形式）は送っていない。

## Anlas を消費しない条件（Opus）

1,048,576 ピクセル（1024×1024 相当）以下・28 steps 以下・1 枚。832×1216 と 1216×832 は条件内。→ `isFreeGeneration()`。

## プロンプトの記法（V5）

- `{tag}` / `[tag]`: 1 段ごとに ×1.05 / ÷1.05。
- `1.5::tag::`: 数値で指定（V4 以降）。`::` で閉じる。
- `-1::hat::`: マイナスの重みで要素を取り除く（V4.5 以降）。このツールの重みは -3〜3。
  括弧の記法を選んでいても、0 以下の重みはそのタグだけ数値の記法で出力する。
- V5 では 0〜1 の重みが効きすぎる不具合が 2026-08-22 に修正された。それより前の調整値は見直しが必要。
- 品質: `high complexity`（既定）/ `low complexity` / `ultra complexity` の複雑さタグがある。
  「Add Quality Tags」をオンにすると `no text` などが自動で付く（このツールでは `qualityToggle: false`）。
- キャラクタープロンプトでは人数を付けずに `girl` / `boy` / `other` と書く。
  キャラ同士の動作は `source#hug`（する側）/ `target#hug`（される側）/ `mutual#holding hands`（お互い）。

## 実機で確認済み（2026-10-05）

- このツールの `buildGenerateRequest()` + `requestImages()`（multipart、`nai-diffusion-5-full`、PNG）でブラウザから直接生成できた。CORS も問題なし。

## まだ確認が必要なこと

2026-11-23 の OpenAPI 照合で仕様上わかったことと、実生成がないため残っていることを分ける。

- 応答形式: 仕様は ZIP と、`Accept: application/json` の JSON。このツールの ZIP 経路は 2026-10-05 に V5 で生成して確認済み。JSON を V5 で受け取った実レスポンスはない。生の画像バイトは `produces` にない。`extractImages()` は ZIP・JSON・画像バイトのどれでも読む。
- `tag_hint_qt` / `tag_hint_uc_preset` を送らないと画素が変わるかは、同じシードで公式 UI と比べる実生成が必要。仕様に効果の説明はない。
- `use_new_shared_trial` の意味は公式仕様にない。オンとオフで挙動が変わるかは未確認。
