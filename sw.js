// Service worker de animelist: red primero (siempre la versión más nueva) y copia guardada solo sin conexión.
// Solo toca archivos de la propia página; Supabase y AniList van directo a la red.
const CACHE = 'animelist-v2'; // al cambiar el nombre se descartan las copias viejas (íconos, etc.)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
