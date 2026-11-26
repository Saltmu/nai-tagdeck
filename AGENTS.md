# nai-tagdeck 開発ガイド

NovelAI Diffusion V5 向けのタグ編集・画像生成アプリ。React / TypeScript / Vite で構成し、ビルド成果物を静的配信する。使い方、ローカルでの起動、公開手順は [README.md](README.md) を参照する。

コード変更を伴う実装・修正依頼では、[issue-implementation スキル](.agents/skills/issue-implementation/SKILL.md) に従う。

## 変更箇所を探す

| 対象 | 主なファイル |
| --- | --- |
| 画面構成と状態の受け渡し | [src/App.tsx](src/App.tsx)、[src/components/](src/components/)、[src/hooks/](src/hooks/) |
| デザインガイドとスタイル | [docs/design-guidelines.md](docs/design-guidelines.md)、[src/styles.css](src/styles.css)、[src/styles/tokens.css](src/styles/tokens.css) |
| 編集状態とプロンプトの組み立て | [workspace.ts](src/lib/workspace.ts)、[prompt.ts](src/lib/prompt.ts)、[categories.ts](src/lib/categories.ts) |
| 辞書・候補・入出力 | [useDictionary.ts](src/hooks/useDictionary.ts)、[suggest.ts](src/lib/suggest.ts)、[io.ts](src/lib/io.ts)、[sampleDictionary.ts](src/lib/sampleDictionary.ts) |
| 保存・復元と移行 | [db.ts](src/lib/db.ts)、[usePersistence.ts](src/hooks/usePersistence.ts)、[backup.ts](src/lib/backup.ts)、[presets.ts](src/lib/presets.ts) |
| 画像生成と履歴 | [generation.ts](src/lib/generation.ts)、[novelai.ts](src/lib/novelai.ts)、[useGenerator.ts](src/hooks/useGenerator.ts)、[useImages.ts](src/hooks/useImages.ts) |
| 本番ビルド・PWA | [vite.config.ts](vite.config.ts)、[src/sw-template.js](src/sw-template.js)、[public/manifest.webmanifest](public/manifest.webmanifest) |

## 変更時に守る動作

- UI やスタイルを変更するときは、[デザインガイド](docs/design-guidelines.md) に従い、[tokens.css](src/styles/tokens.css) のトークンと共通部品クラスを優先する。既存スタイルの一括書き換えはせず、触る箇所から段階的に揃える。
- タグの OFF は出力・生成から外す操作。編集状態、プリセット、バックアップには ON/OFF、重み、並び順を保存する。キャラクターの保存上限と生成対象の上限は [characterLimits.ts](src/lib/characterLimits.ts) を参照する。
- 保存形式を変更する場合は、IndexedDB の既存データ、プリセット、バックアップからの読み込みも確認する。旧形式の文字列ネガティブは作業中のタグへ移行し、ネガティブを持たない旧プリセットの読み込みでは作業中の値を使う。保存時の競合を避けるため、`usePersistence` は読み込み成功後に書き込みを開始し、書き込みを直列化する。
- アプリのデータはブラウザに保存する。トークンはセッションまたはローカルストレージに保持し、バックアップの対象外とする。生成画像の一時履歴はタブのメモリに置く。
- 生成リクエストはユーザー操作で開始し、1 回に1枚をブラウザから NovelAI に直接リクエストする。設定の制限は `generation.ts` と `novelai.ts` で確認する。外部 API の仕様を調べる際は、[API メモ](docs/novelai-api.md) の調査日と現行実装を確認する。
- 配置パスに関わる変更では、サブディレクトリ配信でもアセット・マニフェスト・Service Worker を読み込めることを確認する。公開用の `dist/` はビルドで生成する。

## 確認

- 依存関係は `npm ci` でインストールする。実装の変更は `npm run lint`、`npm test`、`npm run build` で確認する。テストは [tests/](tests/) にあり、生成処理はモックで検証できる。Pull Request と `main` への push では [.github/workflows/ci.yml](.github/workflows/ci.yml) が lint、型チェック、テスト、ビルドを実行する。
- テストが間欠的に失敗したときは、再実行する前に失敗したテスト名と出力全文を記録する。実ビルドなど長時間かかるテストは、既定の 5 秒ではなく作業に見合うタイムアウトをテスト単位で指定する（`tests/sw.test.ts` の実ビルドテストが 5 秒超えで失敗した事例あり）。
- UI の変更箇所に応じて、広い画面での編集・生成の2ペイン表示と、狭い画面でのタブ切り替えを確認する。タグ入力を変更した場合は、日本語 IME、候補のキー操作、候補を閉じるときの外側クリックも確認する。辞書一覧で行を編集中に絞り込み欄を変えるときは、日本語 IME の変換中と、変換をキャンセルして検索語が変わらなかったときは、破棄確認を出さない。[既存の回帰確認記録](docs/refactor-regression-2026-10-09.md)
- `npm run preview` は本番ビルドのローカル確認に使う。`npm run deploy` は公開先のファイルを追加・削除する同期処理なので、同期対象の確認には `npm run deploy -- --dry` を使う。
