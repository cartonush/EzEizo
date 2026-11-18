const CACHE_NAME = "ezeizo-legacy-v1.1.0";
const ROOT = self.registration.scope;
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([ROOT, new URL("index.html", ROOT).href])));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith("fault-sheet-cache-") || key.startsWith("ezeizo-legacy-")) && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || (url.href !== ROOT && url.href !== new URL("index.html", ROOT).href)) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
