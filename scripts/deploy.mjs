// dist/ をレンタルサーバーへアップロードする。WinSCP に保存済みのセッションを使うので、
// パスワードはリポジトリにもこのスクリプトにも持たない。
//
//   npm run deploy            テスト・ビルドしてからアップロード
//   npm run deploy -- --dry   アップロードせず、送る・消すファイルの一覧だけ表示
//
// 接続先は deploy/config.local.json（Git 管理外）に書く。例は deploy/config.example.json。
// サーバー上の公開ディレクトリは dist/ と同じ状態に揃え、dist/ に無いファイルは消す（.htaccess は除く）。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry');
const skipBuild = process.argv.includes('--skip-build');

const configPath = join(root, 'deploy', 'config.local.json');
if (!existsSync(configPath)) {
  fail(`${configPath} がありません。deploy/config.example.json をコピーして接続先を書いてください。`);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
for (const key of ['session', 'remoteDir']) {
  if (!config[key]) fail(`deploy/config.local.json に "${key}" を書いてください。`);
}
// サーバー側で管理していて、dist/ に無くても消さないファイル
const keep = config.keep ?? ['.htaccess'];

const winscp = [
  config.winscp,
  'C:\\Program Files (x86)\\WinSCP\\WinSCP.com',
  'C:\\Program Files\\WinSCP\\WinSCP.com',
].find((p) => p && existsSync(p));
if (!winscp) fail('WinSCP.com が見つかりません。deploy/config.local.json の "winscp" にパスを書いてください。');

if (!skipBuild) {
  npm('test');
  npm('run build');
}
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) fail('dist/index.html がありません。ビルドに失敗していないか確認してください。');

// ハッシュ付きの js/css を先に送り、それを参照する index.html などを後から送る。
// 途中で古い index.html から新しいファイルを、新しい index.html から未送信のファイルを参照しないようにするため。
const exclude = keep.map((name) => `|${name}`).join('');
const preview = dryRun ? ' -preview' : '';
const script = [
  'option batch abort',
  'option confirm off',
  `open "${config.session}"`,
  `synchronize remote${preview} -criteria=either "${join(dist, 'assets')}" "${config.remoteDir}/assets"`,
  `synchronize remote${preview} -delete -criteria=either -filemask="${exclude}" "${dist}" "${config.remoteDir}"`,
  'exit',
].join('\n');

const tmp = mkdtempSync(join(tmpdir(), 'nai-tagdeck-deploy-'));
const scriptPath = join(tmp, 'deploy.txt');
writeFileSync(scriptPath, script);
console.log(`\n${dryRun ? '[確認のみ] ' : ''}${config.session} → ${config.remoteDir}`);
try {
  run(winscp, [`/script=${scriptPath}`]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(dryRun ? '\n確認のみで終了しました（アップロードしていません）。' : '\nデプロイしました。');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) fail(`${cmd} ${args.join(' ')} が失敗しました（終了コード ${result.status}）。`);
}

// Windows の npm は .cmd なのでシェル経由で起動する（引数は固定の文字列だけ）
function npm(command) {
  const result = spawnSync(`npm ${command}`, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) fail(`npm ${command} が失敗しました（終了コード ${result.status}）。`);
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}
