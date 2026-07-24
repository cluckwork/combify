// harness.mjs — runs the REAL js/app.js inside jsdom with a virtual clock,
// so we can fast-forward entire training sessions and inject the specific
// failure modes mobile Safari produces (dropped "ended" events, blocked play()).
//
// jsdom does NO layout: it cannot tell you that text is clipped, that a button
// is off-screen, or that rotating the phone breaks the screen. Those questions
// belong to tests/layout.mjs, which drives a real browser.
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SCRATCH = path.join(HERE, ".tmp"); // generated module copies; gitignored
fs.mkdirSync(SCRATCH, { recursive: true });

// ---------- Virtual clock ----------
export class Clock {
  constructor() { this.now = 0; this.q = []; this.seq = 0; }
  setTimeout(fn, ms = 0) { const id = ++this.seq; this.q.push({ id, time: this.now + (+ms || 0), fn, every: null }); return id; }
  setInterval(fn, ms) { const id = ++this.seq; this.q.push({ id, time: this.now + (+ms || 0), fn, every: +ms || 1 }); return id; }
  clear(id) { this.q = this.q.filter((t) => t.id !== id); }
  pending() { return this.q.length; }
  async advance(ms) {
    const end = this.now + ms;
    // guard against runaway timer storms
    let fired = 0;
    for (;;) {
      let due = null;
      for (const t of this.q) if (t.time <= end && (!due || t.time < due.time || (t.time === due.time && t.id < due.id))) due = t;
      if (!due) break;
      this.now = due.time;
      if (due.every != null) due.time = this.now + due.every;
      else this.q = this.q.filter((t) => t !== due);
      try { due.fn(); } catch (e) { console.error("timer threw:", e.message); }
      if (++fired % 50 === 0) await Promise.resolve(); // let microtasks (play().then) run
      if (fired > 500000) throw new Error("timer storm: >500k callbacks");
    }
    this.now = end;
    await Promise.resolve();
    return fired;
  }
}

// ---------- Deterministic PRNG ----------
// Same seed, same session — the chaos suite's whole contract. A failing run
// is reported by seed and reproduced with `node tests/chaos.mjs --seed N`.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Fake audio ----------
// cfg.chaos arms the iOS-misbehavior model: { rng, seekLatency() → ms,
// dropP, lateP, staleP, rejectP }. Off (undefined), every behavior collapses
// to the old polite synchronous model, so the main suite is unaffected.
export function makeAudioFactory(clock, cfg) {
  const stats = { created: 0, plays: 0, byKey: {}, live: [], maxConcurrent: 0, playing: 0, voicePlaying: 0, maxVoiceConcurrent: 0, overlapEvents: [], missingPlayAttempts: [], phantoms: [], audible: [], seeks: [], seeksWhilePlaying: [], seekRaces: [], cutShort: [], rejects: 0, chaosLog: [] };
  const chaos = cfg.chaos || null;
  class FakeAudio {
    constructor(src = "") {
      this.src = src; this.preload = ""; this.muted = false; this.paused = true;
      this._ct = 0; this._seekTarget = null; this.duration = cfg.duration ?? 0.6;
      this.ended = false;
      // paused/ended follow the spec (natural end leaves paused=false — the
      // founder's real-phone log confirmed it with "ended PLAYING" entries),
      // so "is it emitting sound" needs its own flag for the stats.
      this._sounding = false;
      this._l = {}; this.onended = null; this.onerror = null;
      this._endTimer = null;
      // Faithful to the real repo: a file that isn't on disk behaves like a
      // 404 (never loads, play() rejects). This is what catches "the code
      // points at an audio file that doesn't exist".
      // cfg.missingClips lets a test knock out specific words ("7") to prove one
      // bad file doesn't take the other eleven down with it.
      this.exists = fs.existsSync(path.join(REPO, src.replace(/^\.?\//, "")))
        && !(cfg.missingClips || []).includes(this.key);
      stats.created++; stats.live.push(this);
      // deferMetadata simulates mobile Safari refusing to load anything until
      // a play attempt — so NO load events fire at all, success or failure.
      if (!cfg.deferMetadata) {
        clock.setTimeout(() => {
          if (this.exists) { this._emit("loadeddata"); this._emit("canplaythrough"); }
          else this._emit("error");
        }, 5);
      }
    }
    get key() { const m = /([^/]+)\.(?:mp3|wav)$/.exec(this.src); return m ? m[1] : "?"; }
    get isVoice() { return !this.src.includes("/sfx/"); }
    // currentTime is an accessor so chaos can model what iOS really does:
    // assignment is an ASYNC seek that completes later, while reads report
    // the pending target (per spec). Without chaos the seek is synchronous,
    // exactly like the old plain property. Every app-issued seek is recorded;
    // a seek on an audibly playing element is its own stat because for the
    // voice that's an artifact by definition (mid-word jump).
    get currentTime() { return this._seekTarget != null ? this._seekTarget : this._ct; }
    set currentTime(v) {
      // "playing" means emitting sound (_sounding) — NOT !paused, which per
      // spec stays false after a natural end (an ended element is idle).
      stats.seeks.push({ t: clock.now, key: this.key, from: this._ct, to: v, playing: this._sounding, voice: this.isVoice });
      if (this._sounding) stats.seeksWhilePlaying.push({ t: clock.now, key: this.key, voice: this.isVoice });
      if (v < this.duration) this.ended = false; // spec: seeking clears the ended flag
      const lat = chaos && chaos.seekLatency ? chaos.seekLatency() : 0;
      if (lat > 0) {
        this._seekTarget = v;
        clock.setTimeout(() => { if (this._seekTarget != null) { this._ct = this._seekTarget; this._seekTarget = null; } }, lat);
      } else { this._ct = v; }
    }
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
    removeEventListener(t, fn) { this._l[t] = (this._l[t] || []).filter((f) => f !== fn); }
    _emit(t) {
      const h = this["on" + t];
      if (typeof h === "function") h.call(this, { type: t });
      for (const fn of this._l[t] || []) fn.call(this, { type: t });
    }
    cloneNode() { const a = new FakeAudio(this.src); return a; }
    // load() aborts whatever the element was doing and resets it — the
    // app's zombie heal relies on this (a wedged play() that neither starts
    // nor rejects, as the second real-phone log showed for slip).
    load() {
      if (this._endTimer) { clock.clear(this._endTimer); this._endTimer = null; }
      if (this._sounding) { this._sounding = false; stats.playing--; if (this.isVoice) stats.voicePlaying--; }
      this.paused = true; this._ct = 0; this._seekTarget = null; this.ended = false;
      // Faithful: load() restarts resource selection — a missing file fires
      // "error" again (the clip cache-bust retry depends on this).
      if (!cfg.deferMetadata) {
        clock.setTimeout(() => {
          if (this.exists) { this._emit("loadeddata"); this._emit("canplaythrough"); }
          else this._emit("error");
        }, 5);
      }
    }
    pause() {
      if (this._sounding) {
        // A pause of an audibly playing voice element cuts a word short.
        // Legitimate at phase boundaries (the bell cuts a word, stopVoice on
        // rest/finish); anywhere else it IS the ghost-word artifact — the
        // chaos suite asserts on exactly that distinction. Muted plays are
        // priming, not words: inaudible, so pausing them cuts nothing.
        if (this.isVoice && !this.muted) stats.cutShort.push({ t: clock.now, key: this.key, at: this._ct });
        this._sounding = false; stats.playing--; if (this.isVoice) stats.voicePlaying--;
      }
      this.paused = true;
      if (this._endTimer) { clock.clear(this._endTimer); this._endTimer = null; }
    }
    play() {
      if (cfg.playRejects) return Promise.reject(new Error("NotAllowedError"));
      if (chaos && chaos.rejectP && chaos.rng() < chaos.rejectP) {
        stats.rejects++;
        return Promise.reject(new Error("NotAllowedError"));
      }
      if (!this.exists) {   // missing file: record the wasted attempt
        stats.missingPlayAttempts.push({ t: clock.now, src: this.src });
        return Promise.reject(new Error("NotSupportedError"));
      }
      // cfg.playWedged: iOS's nastiest failure, seen on a real phone — the
      // play() neither starts nor rejects. The element claims "playing",
      // sits at 0:00 forever, and no event ever fires.
      if (typeof cfg.playWedged === "function" && cfg.playWedged(this)) {
        this.paused = false;
        return Promise.resolve();
      }
      stats.plays++;
      stats.byKey[this.key] = (stats.byKey[this.key] || 0) + 1;
      // A seek still in flight when play() lands is the double-seek race the
      // v1.13.3 fix exists for — attack, jump, attack again on real iOS.
      // Recorded, then resolved so playback proceeds from the target.
      if (this._seekTarget != null) {
        stats.seekRaces.push({ t: clock.now, key: this.key, voice: this.isVoice });
        this._ct = this._seekTarget; this._seekTarget = null;
      }
      // Faithful to the spec: play() on an element that ended rewinds to the
      // start itself — the app leans on this instead of seeking manually
      // (a manual seek on top of this internal one is the double-seek race
      // heard as "p-pivot" and double bell strikes). Internal, so no stats.
      if (this.ended) { this._ct = 0; this.ended = false; }
      // phantomEnded: the element reports "ended" almost immediately without
      // ever producing audio — a decode that quietly failed. The chain thinks
      // the word was spoken, so the listener hears a gap where a punch should
      // be. Modelled separately from `plays` so tests can assert AUDIBLE words.
      const phantom = typeof cfg.phantomEnded === "function" ? cfg.phantomEnded(this) : false;
      if (phantom) {
        stats.phantoms.push({ t: clock.now, key: this.key });
        if (this._endTimer) clock.clear(this._endTimer);
        this._endTimer = clock.setTimeout(() => { this._endTimer = null; this._emit("ended"); }, 10);
        return Promise.resolve();
      }
      stats.audible.push({ t: clock.now, key: this.key, voice: this.isVoice, muted: this.muted });
      if (!this._sounding) {
        this._sounding = true; stats.playing++;
        stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.playing);
        if (this.isVoice) {
          stats.voicePlaying++;
          if (stats.voicePlaying > stats.maxVoiceConcurrent) stats.maxVoiceConcurrent = stats.voicePlaying;
          if (stats.voicePlaying > 1) stats.overlapEvents.push({ t: clock.now, key: this.key, n: stats.voicePlaying });
        }
      }
      this.paused = false;
      // "playing" fires ASYNC in real browsers — a listener attached right
      // after play() returns must still catch it. Zero virtual latency.
      clock.setTimeout(() => { if (this._sounding) this._emit("playing"); }, 0);
      if (this._endTimer) clock.clear(this._endTimer);
      const drop = typeof cfg.dropEnded === "function" ? cfg.dropEnded(this) : !!cfg.dropEnded;
      this._endTimer = clock.setTimeout(() => {
        this._endTimer = null;
        if (this._sounding) { this._sounding = false; stats.playing--; if (this.isVoice) stats.voicePlaying--; }
        // Spec: natural end does NOT set paused — only pause() does. The
        // real phone confirmed it ("ended PLAYING" log entries), and the old
        // paused=true model here masked a real bug: primeElement's
        // paused===false check skipped every previously-played element.
        // Faithful to real elements: playback that completes leaves the
        // element sitting at its END position, whether or not the "ended"
        // event is delivered. This is what makes un-parked elements visible
        // to tests — a reused element at end-position forces a rewind seek
        // at play time, which on iOS races playback (the "t-two" stutter).
        // Internal position change, not an app-issued seek — set _ct direct.
        this._ct = this.duration;
        this.ended = true; // the property reflects state even when the event is dropped
        // Chaos event delivery: state above is ALWAYS correct (that's what a
        // real element does); what iOS mangles is the EVENT — dropped, late,
        // or delivered again later ("stale") after the element has moved on
        // to its next use. Stale delivery is the v1.13.2 ghost-words
        // mechanism, so its delay range deliberately reaches far enough to
        // land inside a reused element's next word.
        if (chaos) {
          if (chaos.dropP && chaos.rng() < chaos.dropP) {
            stats.chaosLog.push({ t: clock.now, ev: "dropEnded", key: this.key });
          } else if (chaos.lateP && chaos.rng() < chaos.lateP) {
            const by = Math.round(60 + chaos.rng() * 1400);
            stats.chaosLog.push({ t: clock.now, ev: "lateEnded", key: this.key, by });
            clock.setTimeout(() => this._emit("ended"), by);
          } else {
            this._emit("ended");
          }
          if (chaos.staleP && chaos.rng() < chaos.staleP) {
            // A burst, not a single duplicate: iOS can cough up an element's
            // backlog whenever it likes, and with a pool of 2 the same
            // element replays the same word on its 1st/3rd/5th occurrences —
            // often ~3s apart. The spread is what lets a duplicate land
            // squarely inside a future replay of this very element.
            const by = Math.round(80 + chaos.rng() * 1400);
            for (const at of [by, by + 900 + Math.round(chaos.rng() * 800), by + 2300 + Math.round(chaos.rng() * 1200)]) {
              stats.chaosLog.push({ t: clock.now, ev: "staleEnded", key: this.key, by: at });
              clock.setTimeout(() => this._emit("ended"), at);
            }
          }
          return;
        }
        if (!drop) this._emit("ended");
      }, this.duration * 1000);
      return Promise.resolve();
    }
  }
  return { FakeAudio, stats };
}

// Shared across boots on purpose: a second boot() is a page reload, and the
// whole point of persistence is that it survives one.
const persistentStore = new Map();
export function clearStore() { persistentStore.clear(); }
export function peekStore() { return Object.fromEntries(persistentStore); }
function makeStorage(mode) {
  if (mode === "throws") {  // Safari private browsing
    return { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); }, removeItem() {}, clear() {} };
  }
  return {
    getItem: (k) => (persistentStore.has(k) ? persistentStore.get(k) : null),
    setItem: (k, v) => { persistentStore.set(k, String(v)); },
    removeItem: (k) => { persistentStore.delete(k); },
    clear: () => persistentStore.clear(),
  };
}

// ---------- Boot the app ----------
export async function boot(cfg = {}) {
  const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: false });
  const { window } = dom;
  const clock = new Clock();
  // Lets a test boot "the next day" so streak logic can be exercised across
  // real day boundaries rather than only within one.
  if (cfg.startTime) clock.now = cfg.startTime;
  const { FakeAudio, stats } = makeAudioFactory(clock, cfg);

  // Element.prototype bits app.js touches that jsdom lacks
  window.Element.prototype.setPointerCapture = function () {};
  window.Element.prototype.releasePointerCapture = function () {};
  window.Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 300, height: 40, right: 300, bottom: 40 }; };

  const wakeLog = [];
  const wakeLock = {
    request: async (type) => {
      if (cfg.noWakeLock) throw new Error("NotAllowedError");
      wakeLog.push("acquire");
      return { type, released: false, release: async () => { wakeLog.push("release"); }, addEventListener() {} };
    },
  };

  // Fullscreen spy: the app takes the screen for the session and gives it back
  // when the session ends. jsdom implements none of the API, so unless a test
  // opts out (cfg.noFullscreen — e.g. iPhone Safari), stub enough to observe.
  const fsLog = [];
  let fsElement = null;
  Object.defineProperty(window.document, "fullscreenElement", { get: () => fsElement, configurable: true });
  if (!cfg.noFullscreen) {
    window.document.documentElement.requestFullscreen = function () { fsLog.push("enter"); fsElement = this; return Promise.resolve(); };
    window.document.exitFullscreen = function () { fsLog.push("exit"); fsElement = null; return Promise.resolve(); };
  }

  const speechLog = [];
  const speech = {
    speaking: false,
    getVoices: () => [],
    cancel: () => { speechLog.push("cancel"); },
    speak: (u) => {
      speechLog.push("speak:" + u.text);
      if (!cfg.dropSpeechEnd) clock.setTimeout(() => u.onend && u.onend({}), 800);
    },
    onvoiceschanged: null,
  };

  // Virtual clock replaces globals BEFORE app.js loads
  const g = globalThis;
  const saved = { setTimeout: g.setTimeout, setInterval: g.setInterval, clearTimeout: g.clearTimeout, clearInterval: g.clearInterval };
  g.setTimeout = (fn, ms) => clock.setTimeout(fn, ms);
  g.setInterval = (fn, ms) => clock.setInterval(fn, ms);
  g.clearTimeout = (id) => clock.clear(id);
  g.clearInterval = (id) => clock.clear(id);
  const realNow = Date.now;
  saved.dateNow = realNow;
  Date.now = () => clock.now; // app.js uses Date.now() for the stall heartbeat
  // cfg.rngSeed makes the APP deterministic too (randomCombo, finishLine):
  // without it a chaos seed replays the same misbehavior against different
  // combos every run, and failures aren't reproducible. Opt-in, because the
  // main suite has tests that want real variation across boots.
  saved.mathRandom = Math.random;
  if (cfg.rngSeed != null) Math.random = mulberry32(cfg.rngSeed);

  // cfg.animate turns on a real requestAnimationFrame (driven by real time, not
  // the virtual clock) plus a vibrate spy, so the count-up/pop/haptic path can
  // be exercised. Off by default: everything else in the suite wants the
  // deterministic no-motion path.
  const vibrations = [];
  if (cfg.animate) {
    let rafId = 0;
    const rafs = new Map();
    g.requestAnimationFrame = (fn) => {
      const id = ++rafId;
      rafs.set(id, saved.setTimeout(() => { rafs.delete(id); fn(performance.now()); }, 16));
      return id;
    };
    g.cancelAnimationFrame = (id) => { saved.clearTimeout(rafs.get(id)); rafs.delete(id); };
  } else {
    delete g.requestAnimationFrame;
  }

  g.window = window;
  g.document = window.document;
  const storage = makeStorage(cfg.storage);
  g.localStorage = storage;
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  const nav = {                                            // no serviceWorker key: app skips SW registration
    userAgent: "test",
    wakeLock,
    vibrate: (pattern) => { vibrations.push({ t: Date.now(), pattern }); return true; },
  };
  if (cfg.noVibrate) delete nav.vibrate;                   // e.g. iOS Safari, which has no Vibration API
  if (cfg.noWakeLock === "unsupported") delete nav.wakeLock; // simulate Firefox / in-app WebView
  Object.defineProperty(g, "navigator", { value: nav, configurable: true, writable: true });
  g.Audio = FakeAudio;
  window.Audio = FakeAudio;
  g.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  window.speechSynthesis = speech;
  g.speechSynthesis = speech;
  if (cfg.noSpeech) { delete window.speechSynthesis; g.speechSynthesis = undefined; }
  // Counts oscillators actually started, so tests can tell whether the synth
  // bell/tick/warning genuinely made a sound.
  // An AudioContext that can be suspended, the way a real one is whenever the
  // phone locks, a call arrives, or another app takes audio focus. `heard`
  // counts oscillators started while the context was actually RUNNING; `lost`
  // counts those started against a suspended context, which in a real browser
  // is a sound the user never hears. That distinction is the whole point —
  // the old code happily created oscillators into a suspended context and
  // reported no error while the app sat there silent.
  const synth = { oscStarted: 0, lost: 0, resumes: 0, ctx: null };
  window.AudioContext = g.AudioContext = class {
    constructor() {
      this.state = cfg.audioSuspended ? "suspended" : "running";
      this.sampleRate = 44100; this.currentTime = 0; this.destination = {};
      synth.ctx = this;
    }
    resume() {
      synth.resumes++;
      if (cfg.audioResumeFails) return Promise.reject(new Error("NotAllowedError"));
      this.state = "running";
      return Promise.resolve();
    }
    suspend() { this.state = "suspended"; return Promise.resolve(); }
    createBuffer(ch, len, rate) { return { getChannelData: () => new Float32Array(len) }; }
    createConvolver() { return { buffer: null, connect: (n) => n }; }
    createOscillator() {
      const ctx = this;
      return {
        type: "", frequency: { setValueAtTime() {} }, connect: (n) => n,
        start() { if (ctx.state === "running") synth.oscStarted++; else synth.lost++; },
        stop() {},
      };
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n }; }
  };

  // Copy app.js + combos.js as .mjs so Node treats them as ES modules
  // APP_JS lets us point the same suite at an older revision to confirm the
  // tests actually catch the bug they were written for.
  const appFile = process.env.APP_JS || path.join(REPO, "js/app.js");
  // Copy every sibling module alongside the app copy so its relative imports
  // resolve. package.json sets "type": "module", so plain .js files here load
  // as ES modules and no import rewriting is needed.
  for (const f of fs.readdirSync(path.join(REPO, "js"))) {
    if (f.endsWith(".js") && f !== "app.js") {
      fs.copyFileSync(path.join(REPO, "js", f), path.join(SCRATCH, f));
    }
  }
  // Unique filename per boot so Node's module cache doesn't hand back the
  // already-initialised app from a previous test. audio.js needs the same
  // treatment: it is stateful and DOM-bound (element pools, the shared
  // AudioContext, document listeners), so a cached instance from an earlier
  // boot would arrive still wired to that boot's document and fake audio.
  // The other siblings (combos/stats/version) are safe to share.
  const uniq = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const audioName = `audio_t_${uniq}.mjs`;
  fs.writeFileSync(path.join(SCRATCH, audioName), fs.readFileSync(path.join(REPO, "js/audio.js")));
  const appPath = path.join(SCRATCH, `app_t_${uniq}.mjs`);
  // Point the app copy at its private audio copy. (Old revisions under APP_JS
  // predate audio.js — the replace is simply a no-op there.)
  fs.writeFileSync(appPath, fs.readFileSync(appFile, "utf8").replace('"./audio.js"', `"./${audioName}"`));
  await import("file://" + appPath);
  fs.unlinkSync(appPath);
  fs.unlinkSync(path.join(SCRATCH, audioName));

  const doc = window.document;
  const api = {
    dom, window, doc, clock, stats, wakeLog, speechLog, fsLog, cfg, synth, vibrations,
    set(id, v) { doc.getElementById(id).dataset.value = String(v); },
    setSeg(id, v) { doc.getElementById(id).dataset.value = v; },
    click(id) { doc.getElementById(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true })); },
    combo: () => doc.getElementById("combo").textContent,
    phase: () => doc.getElementById("phase").textContent,
    clockText: () => doc.getElementById("clock").textContent,
    // Waits real wall-clock time, needed when a test drives requestAnimationFrame
    // (which runs on real timers) rather than the virtual clock.
    realWait: (ms) => new Promise((r) => saved.setTimeout(r, ms)),
    restore() { g.setTimeout = saved.setTimeout; g.setInterval = saved.setInterval; g.clearTimeout = saved.clearTimeout; g.clearInterval = saved.clearInterval; Date.now = saved.dateNow; Math.random = saved.mathRandom; },
  };
  return api;
}

// Track distinct combo texts as they're called, sampling every 250ms of virtual time.
export async function runAndSample(app, totalMs, stepMs = 250) {
  const seen = [];
  let last = null;
  for (let t = 0; t < totalMs; t += stepMs) {
    await app.clock.advance(stepMs);
    const c = app.combo();
    if (c !== last) { seen.push({ t: app.clock.now, combo: c }); last = c; }
  }
  return seen;
}
