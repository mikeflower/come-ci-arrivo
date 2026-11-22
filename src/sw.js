/* Service worker di "Come ci arrivo": tiene nel telefono pagina e orari per usarli senza rete. */
const VERSION = '__VERSION__';
const CACHE = 'cca-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cca-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // solo i file del sito: mappe, caratteri e indirizzi passano dalla rete come sempre
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(e.request);
    } catch (err) {
      return (await cache.match('./')) || Response.error();
    }
  })());
});
