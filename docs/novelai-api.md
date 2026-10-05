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

- プロンプトは `input`・`parameters.prompt`・`parameters.v4_prompt.caption.base_caption` の3か所に入れる。
- `v4_prompt` と `v4_negative_prompt` は、どちらかを省くと 500 になる。ネガティブを使わない場合も空で送る。
- キャラクタープロンプトは `v4_prompt.caption.char_captions[]`（`{ char_caption, centers: [{x, y}] }`）。
  `v4_negative_prompt` 側にも同じ数だけ空の `char_caption` を並べる。座標は使わない（`use_coords: false`）。
- `params_version` は 4・3・1・0 のどれでも結果が同じだった（検証記事より）。公式クライアントに合わせて 4 を送る。

```json
{
  "input": "<prompt>", "model": "nai-diffusion-5-full", "action": "generate",
  "parameters": {
    "params_version": 4, "width": 832, "height": 1216, "scale": 5, "steps": 28,
    "sampler": "k_euler_ancestral", "noise_schedule": "karras",
    "seed": 1234567890, "extra_noise_seed": 1234567890, "n_samples": 1,
    "ucPreset": 3, "qualityToggle": false, "cfg_rescale": 0,
    "prompt": "<prompt>", "negative_prompt": "",
    "v4_prompt": { "caption": { "base_caption": "<prompt>", "char_captions": [] }, "use_coords": false, "use_order": true },
    "v4_negative_prompt": { "caption": { "base_caption": "", "char_captions": [] }, "use_coords": false, "use_order": false }
  }
}
```

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

## まだ確認が必要なこと（公式 Web UI の通信で見る）

- `use_order` の値（記事の例では `false`、V4.5 の公式UIでは `true` だった。今は `true` を送る）
- `ucPreset: 3` の意味と、ネガティブが空のときに適切な値
- サンプラー・`noise_schedule` に指定できる値
- `Accept: application/json` が V5 でも使えるか
