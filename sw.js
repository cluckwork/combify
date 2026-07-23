// sw.js — a tiny service worker so Combify loads fast and works offline
// once it's been opened once.
// Bump this on every deploy that must reach existing installs: the activate
// handler deletes every cache that isn't the current name, so an old phone
// throws away whatever it was holding instead of serving a stale app.
const CACHE = "combify-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/combos.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/bwb-logo-white.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always try to fetch the latest version while online, and
// only fall back to the cache when offline. (Previously cache-first, which
// meant a new deploy never showed up until the cache name was bumped.)
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
