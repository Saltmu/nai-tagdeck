/// <reference types="vitest/config" />
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

export default defineConfig({
  // レンタルサーバーのサブディレクトリにも置けるよう相対パスで出力する
  base: './',
  plugins: [react(), cspPlugin()],
  build: {
    sourcemap: false,
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
