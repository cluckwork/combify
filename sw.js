// sw.js — a tiny service worker so Combify loads fast and works offline
// once it's been opened once.
// Must stay in step with VERSION in js/version.js (tests enforce it). The
// activate handler deletes every cache that isn't this name, so bumping the
// version makes old installs throw away whatever they were holding instead of
// serving a stale app. A service worker can't import ES modules, hence the
// duplicated literal.
const CACHE = "combify-v1.2.1";
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
