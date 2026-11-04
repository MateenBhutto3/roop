// Caches the body-tracking engine + model and the store assets, so after the first visit
// the try-on opens almost instantly (even on slow mobile data).
const CACHE = 'roop-v3';
const CACHE_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const heavy = CACHE_HOSTS.includes(url.hostname);
  const asset = url.origin === location.origin && /\/assets\//.test(url.pathname);
  if (!heavy && !asset) return; // pages/js: normal network (so updates show up)
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
    return res;
  })());
});
