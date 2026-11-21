import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { build as viteBuild, type Plugin } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { buildSwAsset, CSP_HEADER, CSP_META, type SwBuildInput } from '../vite.config';

const template = readFileSync(resolve('src/sw-template.js'), 'utf-8');

function baseInput(): SwBuildInput {
  return {
    bundle: {
      'index.html': { type: 'asset', source: '<!doctype html><title>v1</title>' },
      'assets/index-aaaa1111.js': { type: 'chunk', code: 'console.log(1);' },
      'assets/index-bbbb2222.css': { type: 'asset', source: 'body{color:#000}' },
    },
    publicFiles: {
      'manifest.webmanifest': '{"name":"nai-tagdeck"}',
      'icons/favicon-32.png': new Uint8Array([1, 2, 3, 4]),
      'icons/apple-touch-icon.png': new Uint8Array([5, 6, 7, 8]),
      'icons/icon-192.png': new Uint8Array([9, 10, 11, 12]),
      'icons/icon-512.png': new Uint8Array([13, 14, 15, 16]),
      'brand/icon.svg': '<svg/>',
      'sitemap.xml': '<urlset/>',
      'robots.txt': 'User-agent: *',
    },
    template,
  };
}

describe('buildSwAsset', () => {
  it('excludes sitemap.xml and robots.txt from precache and keeps relative ./ paths', () => {
    const { precache } = buildSwAsset(baseInput());
    expect(precache).toEqual([
      './',
      './assets/index-aaaa1111.js',
      './assets/index-bbbb2222.css',
      './brand/icon.svg',
      './icons/apple-touch-icon.png',
      './icons/favicon-32.png',
      './icons/icon-192.png',
      './icons/icon-512.png',
      './manifest.webmanifest',
    ]);
    expect(precache.some((entry) => entry.includes('sitemap.xml') || entry.includes('robots.txt'))).toBe(false);
    expect(precache.some((entry) => entry.includes('index.html'))).toBe(false);
  });

  it('produces the same version regardless of object key order', () => {
    const a = buildSwAsset(baseInput());
    const b = buildSwAsset({
      bundle: {
        'assets/index-bbbb2222.css': { type: 'asset', source: 'body{color:#000}' },
        'assets/index-aaaa1111.js': { type: 'chunk', code: 'console.log(1);' },
        'index.html': { type: 'asset', source: '<!doctype html><title>v1</title>' },
      },
      publicFiles: {
        'sitemap.xml': '<urlset/>',
        'manifest.webmanifest': '{"name":"nai-tagdeck"}',
        'brand/icon.svg': '<svg/>',
        'icons/icon-512.png': new Uint8Array([13, 14, 15, 16]),
        'icons/icon-192.png': new Uint8Array([9, 10, 11, 12]),
        'icons/apple-touch-icon.png': new Uint8Array([5, 6, 7, 8]),
        'icons/favicon-32.png': new Uint8Array([1, 2, 3, 4]),
        'robots.txt': 'User-agent: *',
      },
      template,
    });
    expect(a.version).toBe(b.version);
    expect(a.precache).toEqual(b.precache);
  });

  it('updates version when index.html, bundle assets, public files, or sw-template change without renaming', () => {
    const base = buildSwAsset(baseInput());

    const htmlChanged = baseInput();
    htmlChanged.bundle['index.html'] = { type: 'asset', source: '<!doctype html><title>v2</title>' };
    expect(buildSwAsset(htmlChanged).version).not.toBe(base.version);

    const chunkChanged = baseInput();
    chunkChanged.bundle['assets/index-aaaa1111.js'] = { type: 'chunk', code: 'console.log(2);' };
    expect(buildSwAsset(chunkChanged).version).not.toBe(base.version);

    const manifestChanged = baseInput();
    manifestChanged.publicFiles['manifest.webmanifest'] = '{"name":"nai-tagdeck-v2"}';
    expect(buildSwAsset(manifestChanged).version).not.toBe(base.version);

    const iconChanged = baseInput();
    iconChanged.publicFiles['icons/favicon-32.png'] = new Uint8Array([1, 2, 3, 99]);
    expect(buildSwAsset(iconChanged).version).not.toBe(base.version);

    const templateChanged = baseInput();
    templateChanged.template = `${template}\n// updated`;
    expect(buildSwAsset(templateChanged).version).not.toBe(base.version);

    const sitemapChanged = baseInput();
    sitemapChanged.publicFiles['sitemap.xml'] = '<urlset><url/></urlset>';
    expect(buildSwAsset(sitemapChanged).version).toBe(base.version);
  });

  it('does not keep development brand-concepts under public/', () => {
    expect(existsSync(resolve('public/brand-concepts'))).toBe(false);
    expect(existsSync(resolve('docs/brand-concepts/index.html'))).toBe(true);
  });
});

function extractBuildOutputs(result: Awaited<ReturnType<typeof viteBuild>>) {
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ('output' in r ? r.output : []));
  const byName = new Map(outputs.map((item) => [item.fileName, item]));
  const htmlAsset = byName.get('index.html');
  const swAsset = byName.get('sw.js');
  if (!htmlAsset || htmlAsset.type !== 'asset' || typeof htmlAsset.source !== 'string') {
    throw new Error('missing index.html asset in build output');
  }
  if (!swAsset || swAsset.type !== 'asset' || typeof swAsset.source !== 'string') {
    throw new Error('missing sw.js asset in build output');
  }
  const cacheMatch = swAsset.source.match(/const CACHE = '([^']+)';/);
  const precacheMatch = swAsset.source.match(/const PRECACHE = (\[.*?\]);/);
  if (!cacheMatch?.[1] || !precacheMatch?.[1]) {
    throw new Error('failed to parse CACHE or PRECACHE from sw.js');
  }
  return {
    html: htmlAsset.source,
    cacheName: cacheMatch[1],
    precache: JSON.parse(precacheMatch[1]) as string[],
    chunkNames: outputs.filter((o) => o.type === 'chunk').map((o) => o.fileName).sort(),
  };
}

describe('Vite build swPlugin integration', () => {
  it('updates SW cache name when only index.html changes in a real Vite build', async () => {
    const first = extractBuildOutputs(
      await viteBuild({
        configFile: resolve('vite.config.ts'),
        logLevel: 'silent',
        build: { write: false },
      }),
    );

    const mutateTitlePlugin: Plugin = {
      name: 'test-mutate-html-title',
      enforce: 'pre',
      transformIndexHtml(html) {
        return html.replace(/<title>.*?<\/title>/, '<title>nai-tagdeck updated title</title>');
      },
    };

    const second = extractBuildOutputs(
      await viteBuild({
        configFile: resolve('vite.config.ts'),
        logLevel: 'silent',
        plugins: [mutateTitlePlugin],
        build: { write: false },
      }),
    );

    expect(second.html).not.toBe(first.html);
    expect(second.chunkNames).toEqual(first.chunkNames);
    expect(second.precache).toEqual(first.precache);
    expect(second.cacheName).not.toBe(first.cacheName);
    expect(first.precache).not.toContain('./index.html');
    expect(first.precache).not.toContain('./sitemap.xml');
    expect(first.html).toContain(`content="${CSP_META}"`);
    expect(first.html).not.toContain('frame-ancestors');
    expect(first.html).not.toContain('data:');
  });
});

describe('security headers', () => {
  it('keeps data: out of img-src and sends frame-ancestors only on the HTTP header', () => {
    expect(CSP_META).toContain("img-src 'self' blob:");
    expect(CSP_META).not.toContain('data:');
    expect(CSP_META).not.toContain('frame-ancestors');
    const htaccess = readFileSync(resolve('deploy/htaccess.example'), 'utf8');
    expect(htaccess).toContain(`Content-Security-Policy "${CSP_HEADER}"`);
    expect(CSP_HEADER.endsWith("frame-ancestors 'none'")).toBe(true);
    const workflow = readFileSync(resolve('.github/workflows/deploy.yml'), 'utf8');
    const mirrors = workflow.split('\n').filter((line) => line.includes('mirror '));
    expect(mirrors.some((line) => line.includes('--exclude-glob .htaccess --exclude-glob robots.txt'))).toBe(true);
    expect(mirrors.some((line) => line.includes('--transfer-all') || line.includes('--delete-excluded') || line.includes('--delete-first'))).toBe(false);
  });
});

interface MockRequest {
  url: string;
  method: string;
  mode: string;
}

function createSwHarness(swSource: string, baseUrl: string, options?: { failPuts?: boolean }) {
  const listeners = new Map<string, (event: unknown) => void>();
  const store = new Map<string, Map<string, Response>>();

  const resolveKey = (input: string | MockRequest) =>
    new URL(typeof input === 'string' ? input : input.url, baseUrl).href;

  const stripSearch = (href: string) => {
    const u = new URL(href);
    u.search = '';
    return u.href;
  };

  const matchInCache = (cache: Map<string, Response>, input: string | MockRequest, ignoreSearch = false) => {
    const target = resolveKey(input);
    const exact = cache.get(target);
    if (exact) return exact.clone();
    if (!ignoreSearch) return undefined;
    const strippedTarget = stripSearch(target);
    for (const [key, res] of cache.entries()) {
      if (stripSearch(key) === strippedTarget) return res.clone();
    }
    return undefined;
  };

  const fetchMock = vi.fn(async (input: string | MockRequest) => {
    const href = resolveKey(input);
    return new Response(`body:${href}`, { status: 200 });
  });

  const cachesMock = {
    async open(name: string) {
      let bucket = store.get(name);
      if (!bucket) {
        bucket = new Map();
        store.set(name, bucket);
      }
      const cache = bucket;
      return {
        async addAll(urls: string[]) {
          for (const u of urls) {
            const href = resolveKey(u);
            const res = await fetchMock(href);
            cache.set(href, res);
          }
        },
        async put(req: string | MockRequest, res: Response) {
          if (options?.failPuts) throw new Error('cache put failed');
          cache.set(resolveKey(req), res);
        },
      };
    },
    async keys() {
      return [...store.keys()];
    },
    async delete(name: string) {
      return store.delete(name);
    },
    async match(req: string | MockRequest, options?: { cacheName?: string; ignoreSearch?: boolean }) {
      const ignoreSearch = Boolean(options?.ignoreSearch);
      if (options?.cacheName) {
        const bucket = store.get(options.cacheName);
        return bucket ? matchInCache(bucket, req, ignoreSearch) : undefined;
      }
      for (const bucket of store.values()) {
        const hit = matchInCache(bucket, req, ignoreSearch);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});

  const selfObj = {
    location: new URL(`${baseUrl}sw.js`),
    addEventListener(type: string, fn: (event: unknown) => void) {
      listeners.set(type, fn);
    },
    skipWaiting,
    clients: { claim },
  };

  const context = vm.createContext({
    self: selfObj,
    caches: cachesMock,
    fetch: fetchMock,
    URL,
    Response,
  });
  vm.runInContext(swSource, context);

  return {
    store,
    fetchMock,
    skipWaiting,
    claim,
    async dispatchLifecycle(type: 'install' | 'activate') {
      const fn = listeners.get(type);
      if (!fn) throw new Error(`missing ${type} listener`);
      const pending: Promise<unknown>[] = [];
      fn({
        waitUntil(p: Promise<unknown>) {
          pending.push(p);
        },
      });
      await Promise.all(pending);
    },
    async dispatchFetch(req: MockRequest): Promise<{ response: Response | undefined; waitUntilRejected: boolean }> {
      const fn = listeners.get('fetch');
      if (!fn) throw new Error('missing fetch listener');
      const pending: Promise<unknown>[] = [];
      let responded: Promise<Response> | undefined;
      let waitUntilRejected = false;
      fn({
        request: req,
        waitUntil(p: Promise<unknown>) {
          pending.push(Promise.resolve(p).then(
            () => undefined,
            () => {
              waitUntilRejected = true;
            },
          ));
        },
        respondWith(p: Promise<Response>) {
          responded = p;
        },
      });
      const response = responded ? await responded : undefined;
      await Promise.all(pending);
      return { response, waitUntilRejected };
    },
    dispatchMessage(data: unknown) {
      listeners.get('message')?.({ data });
    },
  };
}

describe('Service Worker runtime under subdirectory deployment', () => {
  const baseUrl = 'https://shishio.x0.to/nai-tagdeck/';

  it('precaches subdirectory assets, matches ?v=tag-check icons from cache, and serves offline navigation', async () => {
    const { source, version } = buildSwAsset(baseInput());
    const sw = createSwHarness(source, baseUrl);
    sw.store.set('nai-tagdeck-old000000000', new Map());
    sw.store.set('other-app-cache', new Map());

    await sw.dispatchLifecycle('install');
    expect(sw.skipWaiting).not.toHaveBeenCalled();
    const activeCache = sw.store.get(`nai-tagdeck-${version}`);
    expect(activeCache?.has(`${baseUrl}`)).toBe(true);
    expect(activeCache?.has(`${baseUrl}icons/favicon-32.png`)).toBe(true);

    await sw.dispatchLifecycle('activate');
    expect(sw.claim).toHaveBeenCalledTimes(1);
    expect(sw.store.has('nai-tagdeck-old000000000')).toBe(false);
    expect(sw.store.has('other-app-cache')).toBe(true);
    expect(sw.store.has(`nai-tagdeck-${version}`)).toBe(true);

    sw.fetchMock.mockClear();

    // Query-versioned icons hit precache without network fetch
    for (const iconPath of [
      'icons/favicon-32.png?v=tag-check',
      'icons/apple-touch-icon.png?v=tag-check',
      'icons/icon-192.png?v=tag-check',
      'icons/icon-512.png?v=tag-check',
    ]) {
      const { response, waitUntilRejected } = await sw.dispatchFetch({
        url: `${baseUrl}${iconPath}`,
        method: 'GET',
        mode: 'no-cors',
      });
      expect(waitUntilRejected).toBe(false);
      expect(response?.ok).toBe(true);
      expect(await response?.text()).toBe(`body:${baseUrl}${iconPath.split('?')[0]}`);
    }
    expect(sw.fetchMock).not.toHaveBeenCalled();

    // Cross-origin NovelAI request is not intercepted
    const crossOrigin = await sw.dispatchFetch({
      url: 'https://image.novelai.net/ai/generate-image',
      method: 'GET',
      mode: 'cors',
    });
    expect(crossOrigin.response).toBeUndefined();

    // Offline navigation falls back to cached subdirectory root ('./')
    sw.fetchMock.mockRejectedValueOnce(new Error('offline'));
    const offlineNav = await sw.dispatchFetch({
      url: `${baseUrl}`,
      method: 'GET',
      mode: 'navigate',
    });
    expect(offlineNav.waitUntilRejected).toBe(false);
    expect(offlineNav.response?.ok).toBe(true);
    expect(await offlineNav.response?.text()).toBe(`body:${baseUrl}`);
  });

  it('activates the new worker only after skip-waiting, and a failed cache write still returns the response', async () => {
    const { source } = buildSwAsset(baseInput());
    const sw = createSwHarness(source, baseUrl, { failPuts: true });
    await sw.dispatchLifecycle('install');
    expect(sw.skipWaiting).not.toHaveBeenCalled();

    sw.dispatchMessage({ type: 'skip-waiting' });
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);

    const asset = await sw.dispatchFetch({
      url: `${baseUrl}icons/extra.png`,
      method: 'GET',
      mode: 'cors',
    });
    expect(asset.waitUntilRejected).toBe(false);
    expect(asset.response?.ok).toBe(true);
    expect(await asset.response?.text()).toBe(`body:${baseUrl}icons/extra.png`);

    const page = await sw.dispatchFetch({
      url: `${baseUrl}`,
      method: 'GET',
      mode: 'navigate',
    });
    expect(page.waitUntilRejected).toBe(false);
    expect(page.response?.ok).toBe(true);
  });
});
