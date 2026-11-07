// Shell is precached on install. Engines cache on first use, then are served from
// cache until a build drops them (their URLs are content-hashed). Everything is same-origin.
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const ENGINE_DIRS = __ENGINE_DIRS__;
const SHELL_CACHE = `rebake-shell-${VERSION}`;
const ENGINE_CACHE = 'rebake-engines';
const NAVIGATION_TIMEOUT = 2500;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('rebake-shell-') && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    // Engine URLs are content-hashed, so what this build no longer uses is never asked for again.
    const engines = await caches.open(ENGINE_CACHE);
    const stale = (await engines.keys())
      .filter(({ url }) => !ENGINE_DIRS.some((dir) => new URL(url).pathname.startsWith(dir)));
    await Promise.all(stale.map((request) => engines.delete(request)));
    await self.clients.claim();
  })());
});

async function navigation(request) {
  // Converter pages share the shell, which reads the path itself. Text pages are their own files.
  const cached = (await caches.match(request)) ?? (await caches.match('/'));
  const network = fetch(request);
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT));
  return (await Promise.race([network.catch(() => null), timeout])) ?? cached;
}

async function engine(event) {
  const { request } = event;
  const cache = await caches.open(ENGINE_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  // Hand the stream over now so progress is live. A full disk only costs offline use.
  if (response.ok) event.waitUntil(cache.put(request.url, response.clone()).catch(() => {}));
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
  } else if (url.pathname.startsWith('/engines/')) {
    event.respondWith(engine(event));
  } else {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
  }
});
