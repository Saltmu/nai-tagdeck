# NovelAI 画像生成 API メモ（フェーズ2用）

調査日: 2026-10-05

## 出典

- `https://docs.novelai.net/en/scripting/api-reference` はアプリ内スクリプト機能（テキスト生成）のリファレンス。画像生成 API は載っていない。
- 画像 API の OpenAPI 定義: `https://image.novelai.net/docs/doc.json`（Swagger UI: `https://image.novelai.net/docs/index.html`）

## エンドポイント

`POST https://image.novelai.net/ai/generate-image`

- 認証: `Authorization: Bearer <token>`
- 既定のレスポンスは ZIP（`application/zip`）。**`Accept: application/json` を送ると JSON で返る**:
  `{ "images": [{ "image": "<base64>", "index": 0, "seed": 123 }] }`
  → JSON にすれば fflate は不要。
- 規約: 生成リクエストは人の操作で開始すること。過大な負荷になる自動化は禁止。→ ボタン1回で1枚。自動の連続生成は作らない。
- エラー時は `utils.JsonError`。`x-correlation-id` ヘッダー（英数字6文字）を付けると、500 エラーのときに問い合わせに使える。

## リクエスト（`image.ImageGenerationRequest`）

| フィールド | 備考 |
| --- | --- |
| `input` | プロンプト |
| `model` | 文字列。仕様に一覧なし（例: `nai-diffusion-4-5-full` は推測） |
| `action` | `generate` |
| `parameters` | `image.RequestParameters` |

`parameters` のうち使う予定のもの（名前は仕様で確認済み）:

`width`, `height`, `steps`, `scale`, `cfg_rescale`, `sampler`, `noise_schedule`, `seed`, `n_samples`,
`negative_prompt`, `qualityToggle`, `ucPreset`, `params_version`, `prefer_brownian`, `skip_cfg_above_sigma`（Variety Boost）,
`v4_prompt` / `v4_negative_prompt`（`image.V4ConditionInput`: `caption.base_caption`, `caption.char_captions[]`, `use_coords`, `use_order`, `legacy_uc`）

## まだ確認が必要なこと（公式 Web UI の通信で見る）

- `model` の正確な値
- `sampler` / `noise_schedule` に指定できる値
- `params_version`、`qualityToggle`、`ucPreset` の既定値
- Opus プランで Anlas を消費しない条件（目安: 1024×1024 相当以下・28 steps 以下・1 枚）
- ネガティブプロンプトは UI に出さない方針なので、`negative_prompt` と `v4_negative_prompt` には空文字を送る（`ucPreset` の扱いも確認）
