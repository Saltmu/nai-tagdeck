# NovelAI 画像生成 API メモ（フェーズ2用）

調査日: 2026-10-05。対象モデル: **NovelAI Diffusion V5**（`nai-diffusion-5-full`）。

## 出典

- `https://docs.novelai.net/en/scripting/api-reference` はアプリ内スクリプト機能（テキスト生成）のリファレンス。画像生成 API は載っていない。
- 画像 API の OpenAPI 定義: `https://image.novelai.net/docs/doc.json`（Swagger UI: `https://image.novelai.net/docs/index.html`）。モデル名とサンプラー名の一覧はない。
- V5 のリクエスト例（第三者の検証記事）: <https://dev.to/ilan_kim/calling-the-novelai-v5-api-directly-nai-diffusion-5-full-request-body-paramsversion-4310-133a>
- 強調の記法（公式）: <https://docs.novelai.net/en/image/strengthening-weakening/>

## エンドポイント

`POST https://image.novelai.net/ai/generate-image`

- 認証: `Authorization: Bearer <token>`
- 既定のレスポンスは ZIP（中身は `image_0.png`）。**`Accept: application/json` を送ると JSON で返る**:
  `{ "images": [{ "image": "<base64>", "index": 0, "seed": 123 }] }`
  → JSON にすれば fflate は不要（V5 で JSON 応答が使えるかは要確認）。
- 規約: 生成リクエストは人の操作で開始すること。過大な負荷になる自動化は禁止。→ ボタン1回で1枚。自動の連続生成は作らない。
- エラー時は `utils.JsonError`。`x-correlation-id` ヘッダー（英数字6文字）を付けると、500 エラーのときに問い合わせに使える。

## V5 のリクエスト

V5 も V4 と同じ形式（`v4_prompt`）を使う。`v5_prompt` は存在しない。実装は `src/lib/novelai.ts` の `buildGenerateRequest()`。

### 公式 Web UI が実際に送っている内容（2026-10-05 取得）

- **送り方**: `multipart/form-data` の `request` パート（`filename="blob"`、`Content-Type: application/json`）に JSON を入れている。
  OpenAPI 仕様は JSON 本体なので、まず JSON 本体で送り、だめなら同じ形の multipart に切り替える。
- **品質タグと UC プリセットはクライアント側で展開済み**:
  - `qualityPresetId: "light"` → `input` の末尾に `very aesthetic, amazing quality, no text` が付いている。
  - `ucPresetId: "heavy"` → `negative_prompt` の先頭に heavy の文面（`DEFAULT_NEGATIVE`）が入り、その後ろにユーザーが追加した語が続く。
  - あわせて `tag_hint_qt: 3`、`tag_hint_uc_preset: 2` を送っている（OpenAPI の説明では、モデルにそのまま渡すヒント）。
  - このツールでは品質タグをタグ編集画面で、ネガティブを設定で持ち、展開済みの文字列を送る。プリセット ID とヒントは送らない。
- **キャラクター**: `characterPrompts[]`（`{ prompt, uc, center: {x:0, y:0}, enabled }`）と
  `v4_prompt.caption.char_captions[]` / `v4_negative_prompt.caption.char_captions[]` の両方に入れる。
  座標を使わないとき（`use_coords: false`）は中心を `{x:0, y:0}` で送る。キャラごとのネガティブの既定値は `lowres, aliasing, `。
- **その他の値**: `use_order: true`、`legacy_uc: false`、`deliberate_euler_ancestral_bug: false`、`prefer_brownian: true`、
  `straight_alpha: true`、`add_original_image: true`、`autoSmea: false`、`normalize_reference_strength_multiple: true`。
  `image_format` は公式UIでは `"webp"` だが、このツールでは生成情報が埋め込まれる `"png"` を使う。
- **上位の階層**: `use_new_shared_trial: true`（意味は未確認。公式UIに合わせて送る）。
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

## まだ確認が必要なこと（フェーズ2で実際に生成して確かめる）

- JSON 本体で受け付けるか（だめなら multipart の `request` パートで送る）
- `Accept: application/json` で base64 の JSON が返るか（返らなければ ZIP を展開する）
- `tag_hint_qt` / `tag_hint_uc_preset` を送らないと結果が変わるか（同じシードで公式UIと比べる）
- `use_new_shared_trial` の意味
