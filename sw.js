// Service worker: app shell sin conexión + caché de teselas del mapa
const SHELL = "incendios-shell-v7";
const TILES = "incendios-tiles-v1";
const CDN = [
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/layers.png"
];
const ARCHIVOS = ["./", "./index.html", "./config.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ARCHIVOS).then(() => Promise.all(CDN.map(u => c.add(u).catch(() => {}))))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => ![SHELL, TILES].includes(k)).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Teselas de mapa: caché primero, red de respaldo, guarda hasta ~1500
  if (/arcgisonline\.com|tile\.openstreetmap\.org|opentopomap\.org/.test(url.hostname)) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === "opaque") { c.put(req, r.clone()); }
        return r;
      } catch { return hit || Response.error(); }
    }));
    return;
  }
  if (url.hostname === "cdn.jsdelivr.net") { e.respondWith(caches.match(req).then(h => h || fetch(req))); return; }
  // Supabase y otras APIs: siempre red
  if (url.origin !== location.origin) return;
  // Shell: red primero (para recibir actualizaciones) con respaldo en caché
  e.respondWith(fetch(req).then(r => {
    const copy = r.clone();
    caches.open(SHELL).then(c => c.put(req, copy));
    return r;
  }).catch(() => caches.match(req).then(h => h || caches.match("./index.html"))));
});
