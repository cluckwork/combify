// sw.js — a tiny service worker so Combify loads fast and works offline
// once it's been opened once.
// Must stay in step with VERSION in js/version.js (tests enforce it). The
// activate handler deletes every cache that isn't this name, so bumping the
// version makes old installs throw away whatever they were holding instead of
// serving a stale app. A service worker can't import ES modules, hence the
// duplicated literal.
const CACHE = "combify-v1.11.1";
const ASSETS = [
  "./",
  "./index.html",
  "./changelog.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/changelog.js",
  "./js/combos.js",
  "./js/stats.js",
  "./js/version.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/bwb-logo-white.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  // Every sound the app can make. These were missing entirely, which meant an
  // installed app opened offline had NO voice and NO bell — the timer ran in
  // total silence. Tests now fail if a file in audio/ isn't listed here.
  "./audio/1.mp3", "./audio/2.mp3", "./audio/3.mp3", "./audio/4.mp3",
  "./audio/5.mp3", "./audio/6.mp3", "./audio/7.mp3", "./audio/8.mp3",
  "./audio/slip.mp3", "./audio/roll.mp3", "./audio/block.mp3", "./audio/pivot.mp3",
  "./audio/sfx/bell.mp3", "./audio/sfx/tick.mp3", "./audio/sfx/warning.mp3",
  "./audio/sfx/blip.mp3", "./audio/sfx/land.mp3",
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
