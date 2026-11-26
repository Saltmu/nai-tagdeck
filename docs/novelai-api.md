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

## Anlas 残高の取得（`GET /user/subscription`、#132）

2026-11-25 に公式 OpenAPI（`https://image.novelai.net/docs/doc.json`）で確認した応答の形。`trainingStepsLeft` はオブジェクトで、付与分と購入分はその中にある（トップレベルではない）。

- エンドポイント: `GET https://image.novelai.net/user/subscription`、認証は `Authorization: Bearer <token>`。旧ホスト `api.novelai.net` は 400 になるため使わない。
- `user.SubscriptionResponse`: `tier`（整数、0=Paper、1=Tablet、2=Scroll、3=Opus）、`expiresAt`（整数、購読期間の終了時刻）、`trainingStepsLeft`（`user.TrainingStepsLeft`）、`usage`（`usagelimit.Status`）。
- `user.TrainingStepsLeft`: `fixedTrainingStepsLeft`（付与分、整数）、`purchasedTrainingSteps`（購入分、整数）。合計残高は両方の和。
- `usagelimit.Status`: `percent`（整数、0〜100+）、`isNegative`（利用枠超過のとき true）、`purchasedPercent`（整数、0〜400）、`timeUntilNextPercent`（整数、秒。次の 1% 回復までの秒数。補充が上限で止まっている間は 0）。
- 実装は `src/lib/novelai.ts` の `fetchSubscription()`／`parseSubscription()`。`expiresAt` は秒・ミリ秒の両方に対応する正規化を入れてある。

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

比較したのはこのシードと設定の組み合わせ。`use_new_shared_trial` の用途の特定と無料トライアルでの追加検証は #86 の対象外とする。生成リクエストは現行どおりとする。

## 精密参照とインペイントの仕様調査（2026-11-26、#172・部分記録）

#130（精密参照）と #131（インペイント）の実装に先立つ調査。2026-11-26 時点で、OpenAPI 照合（Phase A）と公式 Web UI の UI レベル実測まで完了した。リクエストボディの採取（Phase B の DevTools Network 観測）は、実測に使ったスマホブラウザで DevTools が開けなかったため未取得で、PC ブラウザで別途計測する。このセクションは部分記録であり、未取得項目は末尾に明記する。#130・#131 の実装は未取得項目の確定後に着手する。

### OpenAPI で確定した仕様（2026-11-26 照合）

`https://image.novelai.net/docs/doc.json`（Swagger 2.0）で確認した。

**精密参照のフィールド**（`image.RequestParameters`）:

| フィールド | 型 | OpenAPI の description |
| --- | --- | --- |
| `director_reference_images` | `string[]` | `For CR: 1024x1536 or 1536x1024 or 1472x1472 with black padding to fit` |
| `director_reference_descriptions` | `image.V4ConditionInput[]` | ``For CR: set `caption` with a `base_caption` of `"character"` or `"character&style"` `` |
| `director_reference_strength_values` | `number[]` | `API external name. 0-1` |
| `director_reference_secondary_strength_values` | `number[]` | `For CR: Maps to Fidelity slider (0-1)` |
| `director_reference_information_extracted` | `number[]` | `For CR: 0-1` |

- `director_reference_images` の description が、参照画像のキャンバス寸法として 1024×1536 / 1536×1024 / 1472×1472 への黒パディングを明記している。送信形式は文字列（base64 想定）。
- `V4ConditionInput` は `{ caption: { base_caption: string, char_captions[] }, legacy_uc, use_coords, use_order }` で、通常の `v4_prompt` と同じ形。`base_caption` の例示は `"character"` と `"character&style"` の 2 つだけで、`"style"` 単独や衣装に相当する文字列は OpenAPI に現れない。
- `normalize_reference_strength_multiple` は **OpenAPI のどこにも定義されていない**（全文検索 0 件）。`use_new_shared_trial`、`autoSmea`、`characterPrompts` と同じ「公式 UI のみが送る、OpenAPI 未定義フィールド」のカテゴリである。このツールは現行実装で `normalize_reference_strength_multiple: true` を送っている（「その他の値」参照）が、OpenAPI 未定義である点は従来未注記だったため、ここに明記する。
- `model` / `action` は `string` 型のみで **enum が存在しない**。`nai-diffusion-5-full-inpainting` というモデル名も、アクション値 `"infill"` も、doc.json 全文に 1 件も現れない（モデル名の言及は別箇所の説明文中の例 `nai-diffusion-3` のみ）。#131 が前提とする文字列は OpenAPI では裏付けが取れず、実測での確定が必須である。
- `inpaintImg2ImgStrength` は **OpenAPI に存在しない**（0 件）。トップレベルには `strength`（`number`）、`noise`（`number`）、`extra_noise_seed`（`integer`）、`add_original_image`（`boolean`）がある。別候補として `img2img` プロパティ（description は `used by inpaint`）があり、中身は `image.Img2ImgParams` = `{ strength, noise, extra_noise_seed, color_correct }`。公式 UI がトップレベル系統と `img2img` オブジェクト系統のどちらを使うかは実測対象。
- ベース画像・マスクのフィールドは `parameters.image` / `parameters.mask`（いずれも無説明の `string`）で確定。raw base64 かどうかやマスクの仕様は OpenAPI からは分からない。
- `image.RequestParameters` は全 54 プロパティがすべて任意で、**default は一切定義されていない**。既定値は OpenAPI からは読み取れず、全項目が実測対象である。

### UI レベル実測（2026-11-26、公式 Web UI・Opus）

計測環境: 公式 Web UI（`https://novelai.net/image`）、スマホブラウザ、Opus Tier。モデルは NovelAI Diffusion V5 Full（`nai-diffusion-5-full` 相当）に設定変更。1024×1024、同時生成 1 枚、プロンプトガイダンス 7、生成モード「節約」、Quality Tags「標準」。設定パネルにステップ数の欄は表示されず、ステップ値は UI で確認できなかった。DevTools（Network）が開けないため、`POST /ai/generate-image` のリクエストボディは未取得。

#### 精密参照

- 利用にはキーストア用パスワードによるロック解除が必要（「パスワードを入力すると使えるようになります。」）。初回入力は `Error unlocking keystore: Incorrect password.` で失敗した。ユーザーが「パスワードを忘れた場合」からキーストアパスワードをリセットし、再入力して解除した。
- 参照タイプの選択肢は 4 つで、既定は「キャラクター&絵柄」: 「キャラクター&絵柄」「キャラクター」「絵柄」「衣装」。
- 「衣装も参照する」チェックボックスは、「キャラクター&絵柄」と「衣装」でチェックあり、「キャラクター」と「絵柄」でチェックなしだった。
- 強さコントロール: 数値欄の既定値 1、スライダー表示 100。矢印キー 1 回の刻みは数値 0.05（スライダー表示 1）。実測した数値とスライダー表示の対応は次のとおり。

| 数値欄 | スライダー表示 |
| ---: | ---: |
| 0 | 0 |
| 0.5 | 50 |
| 1 | 100 |
| 1.25 | 106 |
| 2 | 125 |
| 5 | 200 |
| 10 | 200（頭打ち） |

- 数値欄は 0〜10 の入力を受け付けた。最小値 0 は確認したが、上限は未確認である。#172 の前提（強さスライダーの上限 5.0）とは異なり、5 はスライダー表示が上限 200 に達する点であって、数値欄の上限ではなかった。また OpenAPI の `director_reference_strength_values` は範囲 "0-1" と書かれているが、UI の数値（既定 1、10 まで入力可）との換算はリクエストボディ未取得のため未確認である。
- 精密参照設定中は「通常」モードで生成される旨の注意が表示される: 「精密参照は『通常』モードでのみ利用できます。精密参照画像が設定されている間は『通常』モードで生成されます。削除すると『節約』モードに戻ります。」
- 参照スロットは複数持てる。各参照には有効化・無効化の切り替え（サムネイル下の ×／✓）があり、無効化した参照は料金に含まれない（参照 1 枚を無効化すると料金表示が 5 Anlas から 0 Anlas になった）。
- 料金は有効な参照 1 枚あたり 5 Anlas で、全タイプ共通。2 枚同時は 10 Anlas。

#### インペインティング

- i2i 欄からベース画像をアップロードするとマスク描画エディターが開く。ペンツールが既定で、ペンサイズは 20（数値欄・スライダーとも 20）。ブラシ形状は実線円・ソフト円・四角・消しゴム。レイヤー数は 1。「保存して閉じる」で確定する。
- 強度: 既定値 0.7。範囲は数値欄で 0〜1 を確認した（0 でスライダー表示 0.01、1 で 0.99 という表示ずれあり）。矢印キーの刻みは 0.01。
- ノイズ: 既定値 0。数値欄で 1 の入力を受け付けた（範囲は 0〜1 とみられる）。
- 無料枠（1024×1024、1 枚）では 0 Anlas だった。

#### Anlas 残高の推移（実測）

生成前の残高 18,594 から、計 6 回の生成で 30 Anlas を消費した。参照 1 枚あたり +5 Anlas は #172 の想定と一致し、インペイントの無料枠内 0 Anlas も想定どおりだった。

| 生成 | 内容 | 残高 | 差分 |
| --- | --- | ---: | ---: |
| 開始 | — | 18,594 | — |
| 1 | 精密参照「キャラクター」 | 18,589 | −5 |
| 2 | 精密参照「絵柄」 | 18,584 | −5 |
| 3 | 精密参照「衣装」 | 18,579 | −5 |
| 4 | 精密参照「キャラクター&絵柄」 | 18,574 | −5 |
| 5 | 精密参照 2 枚同時（両方「キャラクター&絵柄」、強さ 1） | 18,564 | −10 |
| 6 | インペインティング（強度 0.7、ノイズ 0） | 18,564 | 0（無料枠） |

### 未取得（PC ブラウザで別途計測）

以下はリクエストボディの採取が必要で、今回の UI レベル実測では確定できていない。PC ブラウザの DevTools で `POST /ai/generate-image` の `request` パート（JSON）を採取して確定させる。

- 精密参照のリクエストボディ全体。特に `director_reference_descriptions` の種別ごとの `base_caption` 実文字列、`director_reference_secondary_strength_values` の送信有無と値（OpenAPI の description は今も "Maps to Fidelity slider" で、V5 で Fidelity が廃止されたという前提と食い違う）、`director_reference_information_extracted` の値、`normalize_reference_strength_multiple` の値と影響、`director_reference_strength_values` の実値と UI 数値との換算、送信される参照画像のピクセル寸法・形式（黒パディング済みか、PNG か WebP か）。
- インペイントのリクエストボディ全体。特に `model`・`action` の実文字列、`parameters.image` / `parameters.mask` の格納形式（data URL 接頭辞なしの raw base64 か、デコード後の画像形式）、マスクのピクセル寸法（ベース画像と同解像度か 1/8 解像度か、8×8 ブロック丸めの有無、白 `#FFFFFF`／黒 `#000000` の 2 値か）、強さの格納場所（トップレベル `strength` か `img2img` オブジェクトか）、`noise` / `extra_noise_seed` の有無と値、`add_original_image` の既定値と ON/OFF 時の差分、ケモノモード（`fur dataset, ` 先頭付与）・キャラクタープロンプト・シード固定との組み合わせ。
- 生成ステップ数（今回の UI 設定パネルに表示されなかった）。
