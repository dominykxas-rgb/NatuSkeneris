// Penklinė: išsaugo svetainės failus telefone ar kompiuteryje, kad antrą kartą
// nereikėtų nieko siųsti ir svetainė veiktų be interneto.
const VERSION = "__BUILD__";
const CACHE = "penkline-" + VERSION;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("penkline-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // config.json ir pradinis puslapis: pirmiausia tinklas (kad matytųsi atnaujinimai)
  const fresh = url.pathname.endsWith("/") || url.pathname.endsWith("index.html") ||
    url.pathname.endsWith("config.json");
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (fresh) {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || Response.error();
      }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.status === 200) cache.put(req, res.clone());
    return res;
  })());
});
