const CACHE_NAME = "ezeizo-mechanic-v1.9.45";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png", "../styles.css?v=1.9.30", "../app.js?v=1.9.43", "../edit-lock.js?v=1.9.23", "../sheet-data.js?v=1.7.6", "../firebase-sync.js?v=1.9.23", "../signature-canvas.js?v=1.9.31", "../time-now.js?v=1.7.6", "../lifecycle.js?v=1.9.23", "../mechanic-validation.js?v=1.9.39", "../icon.svg", "./keys.html", "../keys/app.js?v=1.9.45", "../keys/data.js?v=1.9.26", "../keys/styles.css?v=1.9.18", "../Metis/catalog.js?v=1.9.0", "../Metis/catalog-data.js?v=1.9.33", "../Metis/catalog-view.js?v=1.9.33", "../Metis/styles.css?v=1.9.23"];
ASSETS.push("./tool-intake-popup.js?v=1.9.42", "./key-tool-intake-popup.js?v=1.9.42");
ASSETS.push("../tool-catalog.js?v=1.9.30", "../squadron-emblems.js?v=1.9.19", "../assets/emblems/101.png", "../assets/emblems/105.png", "../assets/emblems/109.png", "../assets/emblems/mant.png", "../assets/emblems/avionics-combat.jpeg");
ASSETS.push("../firebase-sync.js?v=1.9.30");
ASSETS.push("../firebase-sync.js?v=1.9.33");
ASSETS.push("../firebase-sync.js?v=1.9.38");
ASSETS.push("../firebase-sync.js?v=1.9.41");
const ASSET_URLS = new Set(ASSETS.map((path) => new URL(path, self.location.href).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("ezeizo-mechanic-") && key !== CACHE_NAME).map((key) => caches.delete(key)))));
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
