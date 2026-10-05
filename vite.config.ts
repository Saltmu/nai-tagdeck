/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 本番ビルドだけに CSP を埋め込む（開発サーバーは HMR 用のインラインスクリプトを使うため）。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self' https://image.novelai.net",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'nai-tagdeck-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** src/sw-template.js から、ビルド結果の一覧を埋め込んだ dist/sw.js を作る。 */
function swPlugin(): Plugin {
  return {
    name: 'nai-tagdeck-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicFiles = listFiles('public').map((f) => relative('public', f).split('\\').join('/'));
      const files = ['./', ...Object.keys(bundle).filter((f) => f !== 'index.html'), ...publicFiles].map((f) =>
        f === './' ? f : `./${f}`,
      );
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync('src/sw-template.js', 'utf-8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // レンタルサーバーのサブディレクトリにも置けるよう相対パスで出力する
  base: './',
  plugins: [react(), cspPlugin(), swPlugin()],
  build: {
    sourcemap: false,
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
