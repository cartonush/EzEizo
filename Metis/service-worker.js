const CACHE_NAME = "ezeizo-metis-v1.6.0";
const ASSETS = ["./", "./index.html", "./closed.html", "./manifest.webmanifest", "./icon.svg", "./apple-touch-icon.png", "./styles.css?v=1.6.0", "./app.js?v=1.6.0", "./management-pages.js?v=1.6.0", "./report-pdf.js?v=1.6.0", "./form-pdf.js?v=1.6.0", "./zip.js?v=1.6.0", "./catalog.js?v=1.6.0", "./assignee-selection.js?v=1.6.0", "../styles.css?v=1.6.0", "../app.js?v=1.6.0", "../mechanic-validation.js?v=1.6.0", "../sheet-data.js?v=1.6.0", "../firebase-sync.js?v=1.6.0", "../signature-canvas.js?v=1.6.0", "../time-now.js?v=1.6.0", "../lifecycle.js?v=1.6.0", "../keys/app.js?v=1.6.0", "../keys/data.js?v=1.6.0", "../keys/styles.css?v=1.6.0"];
const ASSET_URLS = new Set(ASSETS.map((path) => new URL(path, self.location.href).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("ezeizo-metis-") && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || (!ASSET_URLS.has(url.href) && !url.href.startsWith(self.registration.scope))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (event.request.mode === "navigate") {
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch { return await cache.match(event.request) || await cache.match("./index.html") || Response.error(); }
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch { return Response.error(); }
  })());
});
