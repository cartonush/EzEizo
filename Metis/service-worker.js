const CACHE_NAME = "ezeizo-metis-v1.9.32";
const ASSETS = ["./", "./index.html", "./closed.html", "./printable-fault-form.pdf", "./manifest.webmanifest", "./icon.svg", "./apple-touch-icon.png", "./styles.css?v=1.9.27", "./app.js?v=1.9.32", "./catalog-admin.js?v=1.9.23", "./catalog-data.js?v=1.9.6", "./catalog-view.js?v=1.9.23", "./attendance.js?v=1.9.18", "./duties.js?v=1.9.23", "../edit-lock.js?v=1.9.23", "./management-pages.js?v=1.9.26", "./report-pdf.js?v=1.7.6", "./form-pdf.js?v=1.9.26", "./zip.js?v=1.7.6", "./catalog.js?v=1.9.0", "./assignee-selection.js?v=1.7.6", "../styles.css?v=1.9.30", "../app.js?v=1.9.32", "../mechanic-validation.js?v=1.9.23", "../sheet-data.js?v=1.7.6", "../firebase-sync.js?v=1.9.24", "../signature-canvas.js?v=1.9.31", "../time-now.js?v=1.7.6", "../lifecycle.js?v=1.9.23", "../keys/app.js?v=1.9.32", "../keys/data.js?v=1.9.26", "../keys/styles.css?v=1.9.18"];
ASSETS.push("./fault-taxonomy.js?v=1.8.0", "./work-status.js?v=1.9.23", "./manual.html", "./manual.js?v=1.9.31", "./tool-admin.js?v=1.9.30", "./printable-tools-form.pdf", "../tool-catalog.js?v=1.9.30");
ASSETS.push("../mechanic/tool-intake-popup.js?v=1.9.31");
ASSETS.push("./filled-print.html", "./filled-print-page.js?v=1.9.30", "./filled-print.js?v=1.9.30", "./print-template-1.jpg", "./print-template-2.jpg");
ASSETS.push("../squadron-emblems.js?v=1.9.19", "../assets/emblems/101.png", "../assets/emblems/105.png", "../assets/emblems/109.png", "../assets/emblems/mant.png", "../assets/emblems/avionics-combat.jpeg");
ASSETS.push("../firebase-sync.js?v=1.9.23", "../firebase-sync.js?v=1.9.30");
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
