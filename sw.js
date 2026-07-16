/* Service worker · offline-first per il core.
   Fase 3: import calendario da PDF (pdf.js da CDN, on-device).
   La rete resta opzionale: il core funziona offline. */
const CACHE = 'mb-cache-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './store.js',
  './energy.js',
  './app.js',
  './import-cal.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// CDN cache-first (opportunistico): font + lettore PDF.
// Precachearli in install è fragile (CORS/opaque); li cacho al primo uso.
const CDN_HOSTS = ['fonts.g', 'cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;

  // 1) CDN (font + pdf.js): cache-first, così l'import funziona offline dopo il primo uso.
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(
      caches.match(req).then(r => r || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => r))   // offline e non in cache → errore reale (mai HTML)
    );
    return;
  }

  // 2) Cross-origin non-CDN (es. futuro Worker): lascia gestire al browser.
  //    NIENTE fallback a index.html — altrimenti una chiamata JSON riceverebbe HTML.
  if (!sameOrigin) return;

  // 3) App shell (same-origin): cache-first, fallback rete.
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok && req.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
