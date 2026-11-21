# 辞書未登録タグの単語ベクトル分類 評価記録

編集画面上部のタグ追加欄（#49）で直接入力・貼り付けした辞書未登録タグについて、単語の重み付きベクトルとコサイン類似度でカテゴリを推定する仕組みの設計・評価記録。

## アルゴリズムと閾値

- 単語分割と正規化は [src/lib/suggest.ts](../src/lib/suggest.ts) の辞書インデックス（`normalize` / `tagWords` / `getIndexedEntries`）を再利用する。
- 負のカテゴリ（`negative`）を除く辞書エントリを対象に、語 $w$ が現れるカテゴリ数 $c(w)$ に応じて重み $1 / c(w)$ を与える（複数カテゴリにまたがる語の重みを下げる）。辞書にない語は重み `1` でクエリベクトルに残し、一致語の割合が小さいタグの過大評価を防ぐ。
- L2 正規化したベクトル同士のコサイン類似度を求め、編集対象で使えるカテゴリ（ベースは 10 カテゴリ、キャラは 4 カテゴリ）に絞って上位 `topK = 3` 件の類似度をカテゴリごとに合算する（境界で同率の類似度が並んだ場合は均等に按分し、辞書の並び順に依存しないようにする）。
- 1 位のスコアと 2 位との差（margin）の両方で判定する。
  - `VECTOR_TOP_K = 3`
  - `VECTOR_MIN_SCORE = 0.55`
  - `VECTOR_MIN_MARGIN = 0.25`

### 閾値の選定理由

- 3 語からなる未登録タグが 1 語の辞書タグと 1 語だけ一致したときのコサイン類似度は $1/\sqrt{3} \approx 0.577$（例: `asymmetrical bomber jacket` と `jacket`）。`minScore = 0.55` により、単一の強い一致を拾いつつ、2 語同士・2 語と 3 語の弱い一致（$0.50$ や $0.408$）単独での誤判定を抑えられる。
- `topK = 3` に抑えることで、`up` / `in` / `the` などの機能語が多数の一致タグからスコアを積み上げる誤分類（例: `close up` や `arms raised in the air`）を減らせる。
- `minMargin = 0.25` により、複数カテゴリに根拠が割れるタグを「未分類」に残せる。
- ベースは 10 カテゴリ間で語が重なりやすく（例: `rain soaked alley` が `rain` / `heavy rain` に寄って「時間・天候」になる、`blue hour` が「外見」に寄る、`elaborately designed clothes` が「衣装」に寄る）、誤分類率がキャラより高いため、ベースでは「未分類」に入れたうえで候補カテゴリを行に表示し、キャラでは十分な根拠がある場合に自動で振り分ける。

## 再実行手順

```bash
npm run eval:classification
```

同梱辞書（[src/lib/sampleDictionary.ts](../src/lib/sampleDictionary.ts)）の対象タグを 1 件ずつ隠して推定する Leave-One-Out 評価を実行する。

## 同梱辞書での Leave-One-Out 評価結果

設定: `topK = 3`, `minScore = 0.55`, `minMargin = 0.25`

| 対象 | 件数 | 正解 | 誤分類 | 未分類 | 分類した分の正解率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ベース用 | 664 | 297 | 21 | 346 | 93.4% |
| キャラ用 | 458 | 225 | 5 | 228 | 97.8% |

### 未登録タグの確認

- `asymmetrical bomber jacket`: ベース = 衣装（候補表示, score=1.125, margin=1.125） / キャラ = 衣装（自動分類, score=1.125, margin=1.125）
- `rain soaked alley`: ベース = 時間・天候（候補表示, score=0.986, margin=0.577） / キャラ = 未分類
- `completely unknown xyzzy`: ベース = 未分類（候補なし） / キャラ = 未分類

### 誤分類例の傾向

- **キャラ用（5件）**: `tying hair` / `wiping tears` / `finger to mouth`（動作の対象語 `hair` / `tears` / `mouth` が「外見」に強く寄る）、`small arms muscle`（`arms` が「ポーズ」に寄る）、`sleeves rolled up`（`up` が「ポーズ」に寄る）。
- **ベース用（21件）**: 上記のキャラ用 5 件に加え、`elaborately designed clothes`（品質→衣装）、`beautiful artwork`（画風→品質）、`from behind` / `hug from behind`（構図↔ポーズ）、`snow scene` / `white day` / `day` / `snow`（背景・場所↔時間・天候）、`blue hour`（時間・天候→外見）など、複数カテゴリをまたぐ修飾語・名詞を共有するケース。
