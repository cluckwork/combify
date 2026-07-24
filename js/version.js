// version.js — the single source of truth for what build this is.
//
// Shown in the About section so you can confirm at a glance that a phone has
// actually picked up the latest push (rather than a cached older copy).
//
// WHEN CHANGING THIS, three things must move together or the version lies:
//   1. VERSION here
//   2. CACHE in sw.js        → "combify-v<VERSION>"  (forces old installs to refresh)
//   3. "version" in package.json
// tests/run.mjs fails the build if they ever disagree.
export const VERSION = "1.18.0";
export const RELEASED = "2026-07-24";
