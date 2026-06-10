// Cache the local app shell only; let cross-origin requests (fonts, analytics)
// hit the network. The fetch handler is what makes Chrome/Android offer "Install".
// Bump CACHE on every deploy that changes a cached file, or users get stale assets.
const CACHE = 'mobile-v2';
const ASSETS = [
  './', './index.html', './style.css', './game.js', './manifest.webmanifest',
  './favicon.svg', './favicon.ico', './favicon-32.png', './favicon-16.png',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './icon-180.png',
];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));

self.addEventListener('activate', e =>
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // CDN/POST → network
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
