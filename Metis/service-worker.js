const CACHE_NAME = "ezeizo-metis-v1.2.0";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./apple-touch-icon.png", "./styles.css", "./app.js", "../styles.css?v=1.1.0", "../sheet-data.js?v=1.1.0"];
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
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => event.request.mode === "navigate" ? caches.match("./index.html") : Response.error())));
});
