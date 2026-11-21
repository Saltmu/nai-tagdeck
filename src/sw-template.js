// Service Worker のひな形。ビルド時に vite.config.ts の swPlugin が、版とキャッシュするファイルの一覧を埋めて dist/sw.js にする。
// - 自サイトのファイルだけをキャッシュする。NovelAI への通信（別オリジン）には一切触れない。
// - ページ本体（index.html）は通信を優先し、オフラインのときだけキャッシュを使う。更新がすぐ反映されるように。
// - ハッシュ付きの js/css・アイコンはキャッシュを優先し、?v=... 付きのアイコン参照もクエリ無視で照合する。
// - インストール直後には切り替えない。ページが { type: 'skip-waiting' } を送ったときだけ新しい版を有効にする。
const CACHE = 'nai-tagdeck-__VERSION__';
const PRECACHE = __PRECACHE__;

function putInCache(request, response) {
  if (!response.ok) return Promise.resolve();
  const copy = response.clone();
  return caches
    .open(CACHE)
    .then((cache) => cache.put(request, copy))
    .catch(() => {});
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nai-tagdeck-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    const fetched = fetch(req);
    event.waitUntil(fetched.then((res) => putInCache('./', res)).catch(() => {}));
    event.respondWith(
      fetched.catch(() => caches.match('./', { cacheName: CACHE }).then((res) => res || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      const fetched = fetch(req);
      event.waitUntil(fetched.then((res) => putInCache(req, res)).catch(() => {}));
      return fetched;
    }),
  );
});
