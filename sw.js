// Tiene in memoria il programma per usarlo anche senza internet. Non contiene dati.
const V = "scale-v2";
const FILES = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png",
  "vendor/tesseract.min.js", "vendor/worker.min.js",
  "vendor/core/tesseract-core-simd-lstm.wasm.js", "vendor/core/tesseract-core-lstm.wasm.js",
  "vendor/lang/ita.traineddata.gz"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); }
    return res;
  })));
});
