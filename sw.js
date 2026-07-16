/* Space Blocks service worker.
   Strategy: network-first for the page so a fresh index.html loads whenever the
   device is online (that's what makes the home-screen app auto-update), with a
   cached copy as an offline fallback. Bump SW_VERSION every release so the browser
   detects a new worker, clears the old cache, and takes control immediately. */
const SW_VERSION = 'space-blocks-v31';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SW_VERSION).then((cache) => cache.addAll(['./', './index.html']).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Only drop old caches once this version's page is actually stored, so a failed
    // install can never leave us with nothing to serve offline.
    caches.open(SW_VERSION)
      .then((c) => c.match('./index.html'))
      .then((primed) => primed
        ? caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SW_VERSION).map((k) => caches.delete(k))))
        : null)
      .catch(() => {})
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Only manage same-origin requests. Let Firebase, gstatic fonts, etc. go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Never cache the version file — it must always reflect the server.
  if (url.pathname.indexOf('version.json') !== -1) return;

  const isPage = req.mode === 'navigate'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('index.html');

  if (isPage) {
    // Network-first: fresh page when online, cached page when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SW_VERSION).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req)
            .then((r) => r || caches.match('./index.html'))
            // Last resort: never resolve to undefined — that renders a blank white page.
            .then((r) => r || fetch(req))
            .catch(() => new Response(
              '<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<body style="background:#0a0a0a;color:#CFE3FF;font:16px system-ui;padding:40px;text-align:center">' +
              'Space Blocks is offline and no copy is cached.<br><br>Reconnect and reload.</body>',
              { headers: { 'Content-Type': 'text/html' } }
            ))
        )
    );
    return;
  }

  // Other same-origin static files (icons, manifest): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SW_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
