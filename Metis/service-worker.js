const CACHE_NAME = "ezeizo-metis-v1.3.2";
const ASSETS = ["./", "./index.html", "./closed.html", "./manifest.webmanifest", "./icon.svg", "./apple-touch-icon.png", "./styles.css?v=1.3.2", "./app.js?v=1.3.2", "./catalog.js?v=1.3.2", "./assignee-selection.js?v=1.3.2", "../styles.css?v=1.3.2", "../app.js?v=1.3.2", "../mechanic-validation.js?v=1.3.2", "../sheet-data.js?v=1.3.2", "../firebase-sync.js?v=1.3.2", "../signature-canvas.js?v=1.3.2", "../keys/", "../keys/index.html", "../keys/app.js?v=1.3.2", "../keys/data.js?v=1.3.2", "../keys/styles.css?v=1.3.2"];
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
