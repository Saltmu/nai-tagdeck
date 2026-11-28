# 公開・デプロイ手順

`npm run build` で生成した `dist/` の中身を、静的サイトとして配信します。アセットは相対パスのため、サブディレクトリにも配置できます。公開環境ではサーバー側で HTTPS へのリダイレクトを設定してください。HTTPS で配信すると、Service Worker によるオフライン編集を利用できます。

[GitHub Actions（FTPS）](#github-actions-から-ftps-でアップロード) · [Windows（WinSCP）](#windows-から-winscp-でアップロード) · [Linux（FTPS）](#linux-から-ftps-でアップロード) · [配信設定と検索エンジン向けの設定](#配信設定と検索エンジン向けの設定)

## GitHub Actions から FTPS でアップロード

公開サーバーで FTPS（明示的 TLS、21番）のパスワード認証が利用できる場合に使えます。さくらのレンタルサーバ「ライトプラン」では SSH が使えず（SSH はスタンダードプラン以上）、SFTP が利用できないため、[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) では `lftp` による FTPS 転送を使用しています。TLS 証明書は `lftp` が検証します。

GitHub の **Settings → Environments** で `production` を作成し、以下の Variables と Secrets を登録します。ワークフローは `environment: production` を参照するため、リポジトリ側ではなく `production` 環境側に登録してください。

| 種別 | 名前 | 設定値 |
| --- | --- | --- |
| Variable | `DEPLOY_HOST` | FTPS 接続先ホスト名 |
| Variable | `DEPLOY_PORT` | FTPS ポート（省略時は 21） |
| Secret | `DEPLOY_USER` | FTPS ユーザー名 |
| Variable | `DEPLOY_DIR` | `/home/user/www/nai-tagdeck` のような、FTPS で見える既存の公開ディレクトリの絶対パス |
| Secret | `DEPLOY_PASSWORD` | FTPS ユーザーのパスワード |

### 実行手順

1. **Actions → Deploy nai-tagdeck → Run workflow** で `main` を選び、まず **Preview files without uploading** をオンにしたまま実行します。
2. 接続と転送予定を確認したら、チェックを外して再実行します。

ワークフローは毎回テストとビルドを実行し、以下の順で同期します。

1. ハッシュ付きアセット（`dist/assets`）を先にアップロード（サイズ同一のファイルは再送しない）
2. ページ本体を同期（`assets/`・サーバー側の `.htaccess`・`robots.txt` を除き、`dist/` に無いファイルはこの段階で削除される）
3. 配信された `index.html` と `sw.js` がビルド成果物と一致することを確認してから、`assets/` 内の古いアセットを削除

> [!NOTE]
> 公開直前に古いページを開いていたタブは、古いスクリプトが削除されると再読み込みするまで開けないことがあります。

## Windows から WinSCP でアップロード

1. [設定例](../deploy/config.example.json) を `deploy/config.local.json` にコピーし、WinSCP の保存済みセッション名と公開先ディレクトリを設定します。
2. `npm run deploy -- --dry` で、アップロードと削除の対象を確認します。
3. `npm run deploy` でテスト・ビルドを実行し、公開先を `dist/` に同期します。公開先だけにあるファイルは削除対象です。サーバーで管理する `.htaccess` などは `keep` に指定します。

## Linux から FTPS でアップロード

Windows の WinSCP 版（`npm run deploy`）は Linux では使えません。Linux では `scripts/deploy-linux.sh`（`npm run deploy:linux`）を使います。GitHub Actions 版（`deploy.yml`）とは別の経路ですが、転送の順序（アセット先行 → ページ公開 → `index.html` / `sw.js` の一致確認 → 古いアセット削除）と、サーバー側の `.htaccess` / `robots.txt` を残す点は同じです。

1. [設定例](../deploy/config.linux.example) を `deploy/config.linux.local` にコピーし、接続先と認証方法を設定します（Git 管理外のためコミットされません）。
2. `npm run deploy:linux -- --dry` で、アップロードと削除の対象を確認します。
3. `npm run deploy:linux` でテスト・ビルドを実行し、公開先を `dist/` に同期します。`--skip-build` でテスト・ビルドを省略できます。

転送は FTPS（明示的 TLS、21番）のパスワード認証（`DEPLOY_PASSWORD`、未設定なら対話入力）で、TLS 証明書を検証します。国外 IP アドレスフィルタが有効だとログイン後のファイル操作が制限される場合があるため、フィルタが有効なときはサーバーコントロールパネルで無効にするか、国内の IP から実行してください。

## 配信設定と検索エンジン向けの設定

- **CSP とキャッシュ制御**: ビルド時に `index.html` へ CSP が入り、通信先を配信元と `image.novelai.net` に制限します（画像は `blob:` のみ許可）。`frame-ancestors 'none'` は meta タグでは効かないため、[Apache の設定例](../deploy/htaccess.example) の HTTP ヘッダーに含めています。キャッシュ制御も同じ設定例を参照してください。
- **Service Worker とアイコン**: 変更後のページを取得できるよう、Service Worker はページ本体の取得をサーバーから試み、通信に失敗したときのみ `sw.js` に埋め込んだビルド時のページを使います。相対パスのアセットはサブディレクトリ配置時のページ URL から解決します。新しい版があるときは画面の案内から再読み込みします。アイコンを再生成する場合は `node scripts/make-icons.mjs` を実行します。
- **公開 URL の変更**: 公開 URL を変更する場合は、[`index.html`](../index.html) の canonical・SNS 共有用 URL と [サイトマップ](../public/sitemap.xml) をそろえます。現在の公開 URL は `www` なしの `shishio.x0.to` を使用しています。
- **検索エンジン向け設定**: 検索に掲載する場合は認証なしで公開し、`robots.txt` や `X-Robots-Tag` でクロール・インデックス登録を許可します。ビルドに含まれる `sitemap.xml` を Google Search Console に送信してください。`robots.txt` は [設定例](../deploy/robots.txt.example) を参考に、ドメイン直下の既存ルールに統合します。

---

[README に戻る](../README.md)
