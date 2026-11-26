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

## 精密参照とインペイントの仕様調査（2026-11-26、#172）

#130（精密参照）と #131（インペイント）の実装に先立つ調査。2026-11-26 に OpenAPI を照合し、公式 Web UI の操作と Anlas 消費をスマホで確認した。同日に Windows の Chrome DevTools で両機能のリクエスト本文と Anlas 残高を採取した。

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
- ベース画像・マスクのフィールドは `parameters.image` / `parameters.mask`（いずれも無説明の `string`）。公式 UI が送る文字列の意味と、画像データの格納先は下の実測を参照。
- `image.RequestParameters` は全 54 プロパティがすべて任意で、**default は一切定義されていない**。既定値は OpenAPI からは読み取れず、全項目が実測対象である。

### UI レベル実測（2026-11-26、公式 Web UI・Opus）

計測環境: 公式 Web UI（`https://novelai.net/image`）、スマホブラウザ、Opus Tier。モデルは NovelAI Diffusion V5 Full（`nai-diffusion-5-full` 相当）に設定変更。1024×1024、同時生成 1 枚、プロンプトガイダンス 7、生成モード「節約」、Quality Tags「標準」。設定パネルにステップ数の欄は表示されず、ステップ値は UI で確認できなかった。DevTools（Network）が開けないため、`POST /ai/generate-image` のリクエストボディは未取得。

#### 精密参照

- 利用にはキーストア用パスワードによるロック解除が必要（「パスワードを入力すると使えるようになります。」）。初回入力は `Error unlocking keystore: Incorrect password.` で失敗した。ユーザーが「パスワードを忘れた場合」からキーストアパスワードをリセットし、再入力して解除した。
- 参照タイプの選択肢は 4 つで、既定は「キャラクター&絵柄」: 「キャラクター&絵柄」「キャラクター」「絵柄」「衣装」。
- Chrome で「衣装も参照する」チェックボックスは「キャラクター&絵柄」と「キャラクター」で表示された。追加直後の「キャラクター&絵柄」は ON、切り替え直後の「キャラクター」は OFF。「絵柄」と「衣装」には表示されなかった。
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

- スライダーの HTML 属性は `min=0`、`max=200`、`step=1`。数値欄の `step` は `0.05` で `min` / `max` 属性はなかった。50 と −1 を入力してフォーカスを外すと数値欄にそのまま残り、スライダー表示はそれぞれ 200 と 0 だった。実際の生成で受理された強さは下のネットワーク実測を参照。
- 精密参照設定中は「通常」モードで生成される旨の注意が表示される: 「精密参照は『通常』モードでのみ利用できます。精密参照画像が設定されている間は『通常』モードで生成されます。削除すると『節約』モードに戻ります。」
- 参照スロットは複数持てる。各参照には有効化・無効化の切り替え（サムネイル下の ×／✓）があり、無効化した参照は料金に含まれない（参照 1 枚を無効化すると料金表示が 5 Anlas から 0 Anlas になった）。
- 料金は有効な参照 1 枚あたり 5 Anlas で、全タイプ共通。2 枚同時は 10 Anlas。

#### インペインティング

- i2i の画像編集とインペイントには異なるエディターがある。Chrome では生成画像の「…」→「画像をインペイントする」で「マスク追加」が選択された専用エディターが開いた。ペンサイズ表示は 4。Square Brush のチェック欄があり、「保存して閉じる」でマスクを適用した。画像のペンアイコンで開く通常の描画エディターではペンサイズ 20 とブラシ形状の選択が表示された。
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

### 精密参照のネットワーク実測（2026-11-26、公式 Web UI・Opus）

Windows の Chrome で V5 Full・ケモノ・通常生成、512×512、14 steps、Euler、固定 seed `860023` を使用した。精密参照で使った画像は 256×192 の試験用 PNG。参照 1 枚で各種別、最後に同じ画像を 2 スロットに指定して生成した。いずれも `POST /ai/generate-image` は HTTP 200 だった。

| UI の種別 | 衣装も参照する | `caption.base_caption` | 入力強さと送信値 |
| --- | --- | --- | --- |
| キャラクター＆絵柄 | ON | `character&style` | `1` → `1` |
| キャラクター＆絵柄 | OFF | `character&style_anyoutfit` | `0.5` → `0.5` |
| キャラクター | OFF | `character` | `2` → `2` |
| 絵柄 | 欄なし | `style` | `5` → `5` |
| 衣装 | 欄なし | `costume` | `10` → `10` |
| キャラクター ＋ キャラクター＆絵柄 | 両方 ON | `character_mainoutfit`、`character&style` | `[1.25, 1]` → `[1.25, 1]` |

- `director_reference_descriptions` の各要素は `caption.base_caption`、`caption.char_captions: []`、`legacy_uc: false`。キャラクタープロンプト用の `v4_prompt` と独立している。
- `director_reference_secondary_strength_values` は参照ごとに `0`、`director_reference_information_extracted` は `1`。各配列の順序は参照スロット順だった。
- `normalize_reference_strength_multiple` は単数でも複数でも `true`。複数時も UI の数値をそのまま送っていた。サーバー内部の正規化の有無はこの観測からは分からない。
- 初回は `director_ref_0`（`image/png`）と `request`（`application/json`）の 2 パートで送信した。JSON の `director_reference_images_cached[0].data` は `"director_ref_0"`。同じ画像の再利用時は `cache_secret_key` だけが配列の要素に残り、画像パートと `data` を省略した。`director_reference_images` はすべての採取例で省略された。
- DevTools で `POST /ai/generate-image` を一時ブロックし、別の試験用 PNG 3 枚について、送信直前に公式 UI が組み立てた `director_ref_N` パートをブラウザ内でデコードした。横長 256×192 は 1152×896（98,551 バイト）、縦長 192×256 は 896×1152（100,324 バイト）、正方形 192×192 は 1024×1024（117,771 バイト）。3 枚とも元画像の色が四辺に達し、黒い余白帯は見られなかった。今回の寸法は OpenAPI の CR 向け寸法と異なる。この試行の Anlas 消費は 0。
- 残高 API の `fixedTrainingStepsLeft` は単数 5 回で `9664 → 9659 → 9654 → 9649 → 9644 → 9639`、複数 1 回で `9639 → 9629`。`purchasedTrainingSteps` はすべて `8900`。合計は `18564 → 18529`。

初回の `request` パートの抜粋。値を伏せたキーに加え、独立した `director_ref_0` PNG パートを送信した。

```json
{
  "input": "fur dataset, solo, fox, red scarf, snowy forest, very aesthetic, amazing quality, no text",
  "model": "nai-diffusion-5-full",
  "action": "generate",
  "parameters": {
    "params_version": 4,
    "width": 512,
    "height": 512,
    "steps": 14,
    "n_samples": 1,
    "director_reference_images_cached": [
      { "cache_secret_key": "<redacted>", "data": "director_ref_0" }
    ],
    "director_reference_descriptions": [
      { "caption": { "base_caption": "character&style", "char_captions": [] }, "legacy_uc": false }
    ],
    "director_reference_strength_values": [1],
    "director_reference_secondary_strength_values": [0],
    "director_reference_information_extracted": [1],
    "normalize_reference_strength_multiple": true
  },
  "use_new_shared_trial": true
}
```

#130 では、実測した種別、強さ、キャンバス寸法を考慮する。公式 UI で観測した `director_reference_images_cached` と multipart パートの参照は OpenAPI に定義されていない。10 より大きい強さや負の強さをサーバーが受理するか、他の縦横比での寸法選択と画像の合わせ方、キャッシュの有効期間は未検証。

### インペイントのネットワーク実測（2026-11-26、公式 Web UI・Opus）

Windows の Chrome DevTools Network で、V5 Full・アニメ・通常モードの生成画像に斜めのマスクを描いて、512×512、14 steps、Euler、Guidance 5、固定 seed `860023` で 1 枚生成した。`POST https://image.novelai.net/ai/generate-image` は HTTP 200。前後の `GET https://image.novelai.net/user/subscription` で `fixedTrainingStepsLeft: 9664` と `purchasedTrainingSteps: 8900` が一致した（計 18,564 Anlas、差分 0）。同じ条件でケモノモードに切り替えた計測でも残高は一致した。

| 項目 | 観測値 |
| --- | --- |
| multipart パート | `image` と `mask` は `image/png`、`request` は `application/json`。全パートの `filename` は `blob` |
| 画像データの参照 | JSON 内の `parameters.image` は `"image"`、`parameters.mask` は `"mask"`。各文字列は対応する multipart パート名 |
| 寸法 | 画像とマスクの PNG IHDR は両方とも 512×512、8 bit RGBA（カラータイプ 6）。公式 UI のマスクプレビューは 64×64 |
| マスク画素 | 送信直前のマスク PNG をデコード。描画領域は白 `#FFFFFFFF` が 1,344 画素、維持領域は黒 `#000000FF` が 260,800 画素。左上を起点とする全 8×8 区画で画素値が区画内で一致 |
| 強度・ノイズ | `parameters.strength: 0.7`、`parameters.noise: 0`、`parameters.inpaintImg2ImgStrength: 1`。`parameters.img2img` は省略。マスク適用後の「強度」を 0.42 にすると `inpaintImg2ImgStrength` が `0.42` に変わり、`strength` は `0.7` のまま |
| シード | `parameters.seed: 860023`、`parameters.extra_noise_seed: 860022`。後者と固定 seed の差はこの 1 例で −1 |
| 元画像の扱い | `parameters.add_original_image: false`。同じセッションの通常生成では `true`。インペイントの参照欄・マスクエディター・生成の詳細設定には、送信値を直接切り替えるコントロールは見当たらなかった |
| キャラクタープロンプト | `characterPrompts` と、`v4_prompt` / `v4_negative_prompt` の `char_captions` の両方に送信。AI に位置を任せた今回の中心値は `(0.5, 0.5)` |
| ケモノモード | `input` と `v4_prompt.caption.base_caption` の両方に `fur dataset, ` を前置。個別キャラクターのプロンプトと固定シードは維持 |
| キャッシュ用フィールド | 再生成時、公式 UI はまず `image_cache_secret_key` と `mask_cache_secret_key` を付け、PNG パートと JSON の `image` / `mask` を省いた。HTTP 400 `INVALID_CACHE_KEYS` を受けると同じ入力で画像・マスクを付け直し、HTTP 200 |

`request` パートの抜粋。画像本体はそれぞれ `image` と `mask` の PNG パートに入る。

```json
{
  "input": "solo, fox, red scarf, snowy forest, very aesthetic, amazing quality, no text",
  "model": "nai-diffusion-5-full-inpainting",
  "action": "infill",
  "parameters": {
    "params_version": 4,
    "width": 512,
    "height": 512,
    "steps": 14,
    "n_samples": 1,
    "strength": 0.7,
    "noise": 0,
    "inpaintImg2ImgStrength": 1,
    "add_original_image": false,
    "seed": 860023,
    "extra_noise_seed": 860022,
    "image": "image",
    "mask": "mask",
    "image_cache_secret_key": "<redacted>",
    "mask_cache_secret_key": "<redacted>"
  },
  "use_new_shared_trial": true
}
```

マスク画素と強度 0.42 の追加計測では、DevTools で生成 POST を一時ブロックし、公式 UI が用意した `mask` と `request` のパートだけを送信直前に観測した。

#131 では専用モデルと `infill` を指定し、ベース画像とマスクを独立した PNG パートとして扱う。マスクはベース画像と同解像度にし、各 8×8 区画を白または黒で揃える。OpenAPI にある `parameters.image` / `parameters.mask` の型は今回と一致する。PNG の multipart 格納、`inpaintImg2ImgStrength`、キャッシュキーは公式 UI で確認した。サーバー側でマスクをどの程度許容するか、キャッシュキーを省略する場合の挙動、`extra_noise_seed` の一般的な決め方は未検証。
