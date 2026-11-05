// Service worker: makes the app shell load fast and work offline. It never stores API responses, uploads, or anything personal.
const VERSION = 'edulearn-v1';
const SHELL = ['/', '/css/app.css', '/js/main.js', '/icons/icon.svg', '/vendor/fonts/bricolage.woff2', '/vendor/fonts/atkinson-400.woff2', '/vendor/fonts/atkinson-700.woff2'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/(api|ws|files|scorm|metrics|healthz|readyz)/.test(url.pathname)) return;           // never cache dynamic or user data
  if (req.mode === 'navigate') {                                                              // network first, fall back to the cached shell
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  if (/^\/(vendor|icons|css|js)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {  // stale-while-revalidate for static files
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
