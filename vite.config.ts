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

const PRECACHE_EXCLUDE = new Set(['sitemap.xml', 'robots.txt']);

export type SwBundleEntry =
  | { type: 'chunk'; code: string }
  | { type: 'asset'; source: string | Uint8Array };

export interface SwBuildInput {
  bundle: Record<string, SwBundleEntry>;
  publicFiles: Record<string, Uint8Array | string>;
  template: string;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function readPublicFiles(dir = 'public'): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  for (const filePath of listFiles(dir)) {
    const rel = relative(dir, filePath).split('\\').join('/');
    result[rel] = readFileSync(filePath);
  }
  return result;
}

/** ビルド成果物・public 配下の実ファイル・テンプレート内容から SW 版とプリキャッシュ一覧を組み立てる。 */
export function buildSwAsset({ bundle, publicFiles, template }: SwBuildInput): {
  version: string;
  precache: string[];
  source: string;
} {
  const bundleNames = Object.keys(bundle).sort();
  const precachePublicNames = Object.keys(publicFiles)
    .filter((name) => !PRECACHE_EXCLUDE.has(name))
    .sort();
  const precache = [
    './',
    ...bundleNames.filter((name) => name !== 'index.html').map((name) => `./${name}`),
    ...precachePublicNames.map((name) => `./${name}`),
  ];

  const hash = createHash('sha256');
  hash.update('template\0');
  hash.update(template);
  hash.update('\0precache\0');
  hash.update(precache.join('\n'));
  for (const name of bundleNames) {
    const entry = bundle[name];
    if (!entry) continue;
    hash.update(`\0bundle:${name}\0`);
    hash.update(entry.type === 'chunk' ? entry.code : entry.source);
  }
  for (const name of precachePublicNames) {
    const content = publicFiles[name];
    if (content === undefined) continue;
    hash.update(`\0public:${name}\0`);
    hash.update(content);
  }

  const version = hash.digest('hex').slice(0, 12);
  const source = template
    .replace('__VERSION__', version)
    .replace('__PRECACHE__', JSON.stringify(precache));

  return { version, precache, source };
}

/** src/sw-template.js から、ビルド結果の一覧を埋め込んだ dist/sw.js を作る。 */
function swPlugin(): Plugin {
  return {
    name: 'nai-tagdeck-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicFiles = readPublicFiles('public');
      const template = readFileSync('src/sw-template.js', 'utf-8');
      const { source } = buildSwAsset({ bundle, publicFiles, template });
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
