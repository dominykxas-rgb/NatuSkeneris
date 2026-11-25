// Penklinė: svetainės failų laikymas telefone ar kompiuteryje.
// Versija: __BUILD__ (pasikeitus šiam failui naršyklė įdiegia naują ir išvalo senus failus)
//
// - Programos failai (puslapis, kodas, stiliai, config.json) visada imami iš interneto,
//   o atmintis naudojama tik be ryšio. Taip po atnaujinimo visada gaunama nauja versija.
// - Dideli failai (modeliai, Python, bibliotekos) turi versiją pavadinime, todėl jie
//   imami iš atminties ir siunčiami tik tada, kai pasikeičia. Senų versijų failai ištrinami.
const SHELL = "penkline-shell";
const DATA = "penkline-data";
const isData = (path) => /\/(vendor|models)\//.test(path) || /\/homr-[0-9a-f]+\.zip$/.test(path);

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Ankstesnių versijų atmintis (penkline-<versija>)
    for (const key of await caches.keys()) {
      if (key.startsWith("penkline-") && key !== SHELL && key !== DATA) await caches.delete(key);
    }
    await self.clients.claim();
    await prune();
  })());
});

// Ištrina didelius failus, kurių dabartinė versija nebenaudoja
async function prune() {
  try {
    const config = await (await fetch("config.json", { cache: "no-cache" })).json();
    const base = new URL("./", self.location).pathname;
    const keep = (config.keep || []).map((k) => base + k);
    if (!keep.length) return;
    const cache = await caches.open(DATA);
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (!keep.some((k) => path.startsWith(k))) await cache.delete(req);
    }
  } catch {
    // be ryšio: išvalysim kitą kartą
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isData(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
