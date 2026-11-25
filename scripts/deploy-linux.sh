#!/usr/bin/env bash
# dist/ を Linux から FTPS（明示的 TLS、パスワード認証）でレンタルサーバーへアップロードする。
#
#   npm run deploy:linux            テスト・ビルドしてからアップロード
#   npm run deploy:linux -- --dry   アップロードせず、送る・消すファイルの一覧だけ表示
#   npm run deploy:linux -- --skip-build  テスト・ビルドを省略して dist/ をそのまま送る
#
# 接続先は環境変数で指定する。deploy/config.linux.local（Git 管理外、*.local で無視）に
# 書くか、実行時に環境変数で渡す。例は deploy/config.linux.example を参照。
# パスワードはリポジトリにもこのスクリプトにも持たない。ログやコマンドラインにも出さない。
#
# 転送は lftp の FTPS（ftp:// + 明示的 TLS、21番）で行う。SFTP（22番）は使わない。
# 理由: さくらのレンタルサーバ「ライトプラン」では SSH が使えず（SSH は
# スタンダードプラン以上）、SFTP の口がそもそもない。ライトでは FTP/FTPS が
# デプロイの経路になる。認証は FTPS のパスワード認証。公開鍵認証はライトでは
# 使えないため、鍵認証の経路はこのスクリプトに無い。
# TLS 証明書は検証する（ssl:verify-certificate / ssl:check-hostname）。
#
# 注意: さくらのレンタルサーバの国外IPアドレスフィルタが有効だと、FTP でも
# ログイン後のファイル一覧取得やコピーが制限される。フィルタが有効な場合は
# サーバーコントロールパネルで無効にするか、国内の IP から実行すること。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY=false
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --dry) DRY=true ;;
    --skip-build) SKIP_BUILD=true ;;
    *) echo "不明な引数: $arg（--dry / --skip-build のみ）" >&2; exit 1 ;;
  esac
done

# --- 設定の読み込み（環境変数が優先） ---
# ファイルを読み込む前に、明示された環境変数を退避しておく。ファイル側の
# 代入で上書きされないよう、読み込み後に退避した値を戻す。
declare -A _ENV_OVERRIDES=()
for _var in DEPLOY_HOST DEPLOY_PORT DEPLOY_USER DEPLOY_DIR DEPLOY_PASSWORD LFTP_PASSWORD; do
  if [[ -n "${!_var:-}" ]]; then
    _ENV_OVERRIDES["$_var"]="${!_var}"
  fi
done
CONFIG_FILE="$ROOT/deploy/config.linux.local"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$CONFIG_FILE"; set +a
fi
for _var in "${!_ENV_OVERRIDES[@]}"; do
  printf -v "$_var" '%s' "${_ENV_OVERRIDES[$_var]}"
done
unset _ENV_OVERRIDES _var

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_PORT="${DEPLOY_PORT:-21}"
DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_DIR="${DEPLOY_DIR:-}"
# パスワードは DEPLOY_PASSWORD か LFTP_PASSWORD（Actions と同じ名前）のどちらか。
DEPLOY_PASSWORD_VALUE="${DEPLOY_PASSWORD:-${LFTP_PASSWORD:-}}"

fail() { echo "エラー: $*" >&2; exit 1; }

# deploy.yml と同じ検証
[[ "$DEPLOY_HOST" =~ ^[[:alnum:]][[:alnum:].-]*$ ]] || fail "DEPLOY_HOST を設定してください（ホスト名）。"
[[ "$DEPLOY_PORT" =~ ^[0-9]{1,5}$ ]] || fail "DEPLOY_PORT は 1〜5 桁の数字にしてください。"
[[ "$DEPLOY_USER" =~ ^[[:alnum:]_][[:alnum:]_-]*$ ]] || fail "DEPLOY_USER を設定してください。"
[[ "$DEPLOY_DIR" =~ ^(/[[:alnum:]_.-]+)+/?$ ]] || fail "DEPLOY_DIR は絶対パスにしてください。"
[[ "$DEPLOY_DIR" =~ /\.\.?(/|$) ]] && fail "DEPLOY_DIR に . や .. を含めないでください。"

command -v lftp >/dev/null 2>&1 || fail "lftp が見つかりません。sudo apt install lftp で入れてください。"

# --- 認証方法の決定（FTPS パスワード認証のみ） ---
if [[ -z "$DEPLOY_PASSWORD_VALUE" ]]; then
  if [[ -t 0 ]]; then
    # 対話式ならパスワードを端末で入力してもらう（画面には表示しない）。
    printf 'FTPS パスワードを入力してください: ' >&2
    IFS= read -r -s DEPLOY_PASSWORD_VALUE
    echo >&2
    [[ -n "$DEPLOY_PASSWORD_VALUE" ]] || fail "パスワードが入力されませんでした。"
  else
    fail "パスワード認証の情報がありません。DEPLOY_PASSWORD（または LFTP_PASSWORD）を設定するか、対話式のターミナルで実行してパスワードを入力してください。sshpass は不要です（lftp が --env-password でパスワードを渡します）。"
  fi
fi
export LFTP_PASSWORD="$DEPLOY_PASSWORD_VALUE"
unset DEPLOY_PASSWORD_VALUE

OPEN_CMD="open --env-password -u \"$DEPLOY_USER\" \"ftp://$DEPLOY_HOST:$DEPLOY_PORT\""

run_lftp() {
  {
    printf '%s\n' \
      'set cmd:fail-exit yes' \
      'set xfer:use-temp-file yes' \
      'set net:timeout 20' \
      'set net:max-retries 2' \
      'set ftp:ssl-force true' \
      'set ftp:ssl-protect-data true' \
      'set ftp:ssl-auth TLS' \
      'set ssl:verify-certificate yes' \
      'set ssl:check-hostname yes' \
      'set ftp:passive-mode true' \
      "$OPEN_CMD" \
      "cd \"${DEPLOY_DIR%/}\""
    cat
    printf '%s\n' 'bye'
  } | lftp --norc -f /dev/stdin
}

# --- テスト・ビルド ---
if [[ "$SKIP_BUILD" == false ]]; then
  (cd "$ROOT" && npm test)
  (cd "$ROOT" && npm run build)
fi
[[ -f "$ROOT/dist/index.html" ]] || fail "dist/index.html がありません。ビルドに失敗していないか確認してください。"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT

echo
if [[ "$DRY" == true ]]; then
  echo "$DEPLOY_HOST:$DEPLOY_PORT → $DEPLOY_DIR [確認のみ]"
else
  echo "$DEPLOY_HOST:$DEPLOY_PORT → $DEPLOY_DIR"
fi

PREVIEW=""
if [[ "$DRY" == true ]]; then
  PREVIEW="--dry-run"
fi

# 1. ハッシュ付きアセットを先に送る（まだ削除しない）
printf '%s\n' \
  "mirror --reverse --no-perms --ignore-time --verbose $PREVIEW dist/assets assets" \
  | (cd "$ROOT" && run_lftp)
# 2. ページ類を公開する。dist/ に無いファイルは消す（assets/・.htaccess・robots.txt は除く）
printf '%s\n' \
  "mirror --reverse --delete --no-perms --transfer-all --verbose --exclude-glob .htaccess --exclude-glob robots.txt --exclude ^assets/ $PREVIEW dist ." \
  | (cd "$ROOT" && run_lftp)

if [[ "$DRY" == false ]]; then
  # 3. 配信された index.html / sw.js がビルドと一致するか確認する
  CHECK_DIR="$TMP_DIR/check"
  mkdir -p "$CHECK_DIR"
  printf '%s\n' \
    "get index.html -o \"$CHECK_DIR/index.html\"" \
    "get sw.js -o \"$CHECK_DIR/sw.js\"" \
    | (cd "$ROOT" && run_lftp)
  cmp -s "$ROOT/dist/index.html" "$CHECK_DIR/index.html" \
    || fail "配信された index.html がビルドと一致しません。古いハッシュ付きアセットは残してあります。"
  cmp -s "$ROOT/dist/sw.js" "$CHECK_DIR/sw.js" \
    || fail "配信された sw.js がビルドと一致しません。古いハッシュ付きアセットは残してあります。"
fi
# 4. 古いハッシュ付きアセットだけを削除する。--dry でも --dry-run 付きで実行し、
# プレビューに削除対象を含める（deploy.yml と同じく 3 つの mirror をすべて表示する）。
printf '%s\n' \
  "mirror --reverse --delete --no-perms --ignore-time --verbose $PREVIEW dist/assets assets" \
  | (cd "$ROOT" && run_lftp)

echo
if [[ "$DRY" == true ]]; then
  echo "確認のみで終了しました（アップロードしていません）。"
else
  echo "デプロイしました。"
fi
