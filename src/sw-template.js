// Service Worker のひな形。ビルド時に vite.config.ts の swPlugin が、版とキャッシュするファイルの一覧を埋めて dist/sw.js にする。
// - 自サイトのファイルだけをキャッシュする。NovelAI への通信（別オリジン）には一切触れない。
// - ページ本体（index.html）は通信を優先する。オフラインのときは、この sw.js に埋め込んだビルド時のページを使う。通信で得た HTML では上書きしない。
// - ハッシュ付きの js/css・アイコンはキャッシュを優先し、?v=... 付きのアイコン参照もクエリ無視で照合する。
// - インストール直後には切り替えない。ページが { type: 'skip-waiting' } を送ったときだけ新しい版を有効にする。
// - 有効化で古いキャッシュは消す。自分よりあとに入り始めた版のキャッシュは残す。
const CACHE = 'nai-tagdeck-__VERSION__';
const PRECACHE = __PRECACHE__;
const OFFLINE_HTML = __OFFLINE_HTML__;

function putInCache(request, response) {
  if (!response.ok) return Promise.resolve();
  const copy = response.clone();
  return caches
    .open(CACHE)
    .then((cache) => cache.put(request, copy))
    .catch(() => {});
}

// アプリ本体の IndexedDB とは別。インストール順だけを残し、どの版のキャッシュを消してよいかを決める。
function updateGenerationList(mutate) {
  if (typeof indexedDB === 'undefined') {
    mutate([]);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('nai-tagdeck-sw', 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('generations')) db.createObjectStore('generations');
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('generations', 'readwrite');
      const store = tx.objectStore('generations');
      const got = store.get('order');
      got.onsuccess = () => {
        const order = Array.isArray(got.result) ? got.result.filter((name) => typeof name === 'string') : [];
        store.put(mutate(order), 'order');
      };
      got.onerror = () => reject(got.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('sw generation update aborted'));
    };
  }).catch(() => {
    mutate([]);
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    updateGenerationList((order) => (order.includes(CACHE) ? order : order.concat(CACHE))).then(() =>
      caches.open(CACHE).then((cache) =>
        cache.addAll(PRECACHE).then(() =>
          // ./ を取りに行かない。途中のキャッシュが、この版のスクリプトと違う HTML を返すことがある。
          cache.put(
            './',
            new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
          ),
        ),
      ),
    ),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE]);
  event.waitUntil(
    // 一覧を先に取る。このあとで開いたキャッシュは、世代一覧に無くても消さない。
    caches
      .keys()
      .then((keys) =>
        updateGenerationList((order) => {
          const at = order.indexOf(CACHE);
          const newer = at === -1 ? [] : order.slice(at + 1);
          for (const name of newer) keep.add(name);
          return [CACHE, ...newer];
        }).then(() => keys),
      )
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nai-tagdeck-') && !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // ページ本体は、この版のインストール時に入れたものをオフライン用に保つ。
  // 待っている新しい版の HTML で上書きすると、そのスクリプトがこのキャッシュに無く、オフラインで開けなくなる。
  if (req.mode === 'navigate') {
    const pathname = new URL(req.url).pathname;
    const isTutorial = /\/tutorial(?:\/(?:index\.html)?)?$/.test(pathname);
    const fallbackKey = isTutorial ? './tutorial/index.html' : './';
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .match(fallbackKey, { cacheName: CACHE })
          .then((res) => res || caches.match('./', { cacheName: CACHE }))
          .then((res) => res || Response.error()),
      ),
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
