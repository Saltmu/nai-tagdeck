# NovelAI 画像生成 API メモ（フェーズ2用）

調査日: 2026-10-05。対象モデル: **NovelAI Diffusion V5**（`nai-diffusion-5-full`）。
2026-11-23 に [OpenAPI](https://image.novelai.net/docs/doc.json) を再照合し、同日に実機で追加検証した。

## 出典

- `https://docs.novelai.net/en/scripting/api-reference` はアプリ内スクリプト機能（テキスト生成）のリファレンス。画像生成 API は載っていない。
- 画像 API の OpenAPI 定義: `https://image.novelai.net/docs/doc.json`（Swagger UI: `https://image.novelai.net/docs/index.html`）。モデル名とサンプラー名の一覧はない。
- V5 のリクエスト例（第三者の検証記事）: <https://dev.to/ilan_kim/calling-the-novelai-v5-api-directly-nai-diffusion-5-full-request-body-paramsversion-4310-133a>
- 強調の記法（公式）: <https://docs.novelai.net/en/image/strengthening-weakening/>

## エンドポイント

`POST https://image.novelai.net/ai/generate-image`

- 認証: `Authorization: Bearer <token>`
- 既定のレスポンス本体は ZIP。本ツールの PNG リクエストでは `image_0.png` が入る。2026-11-23 の V5 実測では PNG と WebP のいずれも `200 OK`、`Content-Type: binary/octet-stream` だった。このツールは Accept を指定せず、ZIP を `extractImages()` で読む。
- `Accept: application/json` を指定すると、同日の V5 実測では `200 OK`、`Content-Type: application/json` で `{ "images": [{ "image": "<base64>", "index": 0, "seed": 860023 }] }` が返った。base64 から PNG を復元した。OpenAPI は JSON 応答を 201 と記載している。
- 規約: 生成リクエストは人の操作で開始すること。過大な負荷になる自動化は禁止。→ ボタン1回で1枚。自動の連続生成は作らない。
- エラー時は `utils.JsonError`。`x-correlation-id` ヘッダー（英数字6文字）を付けると、500 エラーのときに問い合わせに使える。

## V5 のリクエスト

### アニメ／ケモノのモード（2026-10-05確認）

- [公式画像APIリファレンス](https://image.novelai.net/docs/doc.json) の `image.ImageGenerationRequest` と `image.RequestParameters` に、`mode` や `furry` の専用パラメータは定義されていない。
- [公式モデル説明](https://docs.novelai.net/en/image/models/) では、V5のFurryモードはプロンプト先頭に `fur dataset,` を付ける方式と説明されている。
- アプリ内部の保存値は `mode: "anime" | "furry"`。アニメでは入力プロンプトをそのまま送り、ケモノでは先頭に `fur dataset, ` を付ける。すでに先頭にある場合は重ねない。
- APIへ送るフィールドは `input` と `parameters.v4_prompt.caption.base_caption`（いずれも文字列）。同じ展開後のベースプロンプトを両方に入れる。モデルは `nai-diffusion-5-full` のまま、専用のモードフィールドは送らない。
- モードは生成設定とバックアップに保存し、旧データで未指定の場合はアニメにする。編集画面のタグと辞書は変更せず、画像履歴には実際に送ったプロンプトを保持する。
- 2026-11-23 に `input` と `v4_prompt.caption.base_caption` の両方を `fur dataset, solo, fox, …` で始めて送信し、V5 から ZIP 内の PNG を取得した。PNG のメタデータにも同じ接頭辞を確認した。

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

1,048,576 ピクセル（1024×1024 相当）以下・28 steps 以下・1 枚。832×1216 と 1216×832 は条件内。→ `isFreeGeneration()`。V5 には Opus の利用枠もあり、枠を使い切った状態で生成を続けると Anlas を使う場合がある。[NovelAI FAQ](https://docs.novelai.net/en/faq/)

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

## V5 の実機検証（2026-11-23、#86）

Chrome の nai-tagdeck 本番オリジンから、`buildGenerateRequest()` 相当の multipart リクエストを `POST /ai/generate-image` に 1 回につき 1 枚ずつ送り、利用枠に余裕のある Opus アカウントで 15 枚生成した。生成ごとに `GET /user/subscription` の付与分・購入分の Anlas 残高が前後で一致した。

共通設定は `nai-diffusion-5-full`、512×512、14 steps、Guidance 5、`karras`、seed `860023`、PNG、キャラクターなし。ベースプロンプトは `solo, fox, red scarf, snowy forest, very aesthetic, amazing quality, no text`、ネガティブは展開済みの `DEFAULT_NEGATIVE`。基準には 2026-10-05 の公式 UI リクエストで観測した `tag_hint_qt: 3`、`tag_hint_uc_preset: 2`、`use_new_shared_trial: true` を付けた。

- **応答形式とケモノモード**。標準の ZIP と `Accept: application/json` のどちらでも PNG を取得した。JSON は `images` 1 件で、`index: 0` と要求した seed を返した。ヒント両方を省略し、プロンプトに `fur dataset, ` を付けた本ツールのケモノモードと同じ形のリクエストでも生成できた。
- **ヒントと共有トライアル**。既定の `k_euler_ancestral` では全く同じ基準リクエストを繰り返しても、PNG をデコードした RGBA の SHA-256 が異なった。そこで `k_euler` に切り替え、`extra_noise_seed` も `860023` に固定して再比較した。下表はその基準画像に対する RGB の絶対差（各チャンネル 0〜255）の平均と、RGB が異なる画素数。各ケースとも HTTP 200 で PNG を取得した。[NovelAI のシード解説](https://docs.novelai.net/en/image/seed/)

| 基準からの変更 | RGB の平均絶対差 | 差のある画素（全 262,144） |
| --- | ---: | ---: |
| 変更なし（再生成 1 回目） | 0.00016 | 127 |
| 変更なし（再生成 2 回目） | 0.00021 | 166 |
| `tag_hint_qt` のみ省略 | 0.00019 | 151 |
| `tag_hint_uc_preset` のみ省略 | 0.00021 | 167 |
| 両ヒントを省略 | 0.00020 | 161 |
| `use_new_shared_trial: false` | 0.00024 | 186 |
| `use_new_shared_trial` を省略 | 0.00020 | 159 |

この固定条件では、ヒントを省略したときの差は同じリクエストを再生成したときと同程度だった。ヒントの影響として識別できる差は確認できなかった。Opus では `use_new_shared_trial` が `true`、`false`、省略のいずれでも生成でき、Anlas 残高は前後で一致した。

### 公式 Web UI からの直接生成との比較

同日、公式 Web UI の V5 Full・アニメ・通常モードで、同じプロンプト、512×512、14 steps、Guidance 5、Euler、seed `860023` を指定して 1 枚生成した。品質プリセットは Light、UC は Heavy。実際の `POST /ai/generate-image` の本文で、冒頭の検証と同じ展開済みのプロンプト、`noise_schedule: "karras"`、`tag_hint_qt: 3`、`tag_hint_uc_preset: 2`、`use_new_shared_trial: true` を確認した。このリクエストの `image_format` は `"webp"` だった。

公式 UI から取得した本文を nai-tagdeck 本番オリジンから再送した。変更なしと両ヒント省略をそれぞれ 2 回実行し、プリセット ID、展開済みプロンプト、シード、WebP 指定などは固定した。4 回とも HTTP 200 で ZIP 内の WebP を取得し、生成前後の Anlas 残高は一致した。

公式 UI の画像と再送した 4 枚を Chrome でデコードして比較した。いずれも公式画像と RGBA の SHA-256 が異なり、変更なしの再送 2 枚同士でもハッシュが異なった。16×16 区画の RGB 平均をチャンネルごとに整数へ丸めて比べると、4 枚とも公式画像との差は平均 0.00781、最大 1（0〜255）。再送した 4 枚同士では、丸めた区画平均はすべて一致した。この入力において、両ヒントの省略による画素差を再生成による差から識別できなかった。

比較したのはこのシードと設定の組み合わせ。無料トライアルでの `use_new_shared_trial` の意味と要否は、検証に使ったアカウントが Opus だったため未確認。生成リクエストは現行どおりとする。
