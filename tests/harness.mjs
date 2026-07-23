// harness.mjs — runs the REAL js/app.js inside jsdom with a virtual clock,
// so we can fast-forward entire training sessions and inject the specific
// failure modes mobile Safari produces (dropped "ended" events, blocked play()).
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

// ---------- Fake audio ----------
export function makeAudioFactory(clock, cfg) {
  const stats = { created: 0, plays: 0, byKey: {}, live: [], maxConcurrent: 0, playing: 0, voicePlaying: 0, maxVoiceConcurrent: 0, overlapEvents: [], missingPlayAttempts: [], phantoms: [], audible: [] };
  class FakeAudio {
    constructor(src = "") {
      this.src = src; this.preload = ""; this.muted = false; this.paused = true;
      this.currentTime = 0; this.duration = cfg.duration ?? 0.6;
      this._l = {}; this.onended = null; this.onerror = null;
      this._endTimer = null;
      // Faithful to the real repo: a file that isn't on disk behaves like a
      // 404 (never loads, play() rejects). This is what catches "the code
      // points at an audio file that doesn't exist".
      this.exists = fs.existsSync(path.join(REPO, src.replace(/^\.?\//, "")));
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
    get key() { const m = /([^/]+)\.mp3$/.exec(this.src); return m ? m[1] : "?"; }
    get isVoice() { return !this.src.includes("/sfx/"); }
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
    removeEventListener(t, fn) { this._l[t] = (this._l[t] || []).filter((f) => f !== fn); }
    _emit(t) {
      const h = this["on" + t];
      if (typeof h === "function") h.call(this, { type: t });
      for (const fn of this._l[t] || []) fn.call(this, { type: t });
    }
    cloneNode() { const a = new FakeAudio(this.src); return a; }
    pause() { if (!this.paused) { this.paused = true; stats.playing--; if (this.isVoice) stats.voicePlaying--; } if (this._endTimer) { clock.clear(this._endTimer); this._endTimer = null; } }
    play() {
      if (cfg.playRejects) return Promise.reject(new Error("NotAllowedError"));
      if (!this.exists) {   // missing file: record the wasted attempt
        stats.missingPlayAttempts.push({ t: clock.now, src: this.src });
        return Promise.reject(new Error("NotSupportedError"));
      }
      stats.plays++;
      stats.byKey[this.key] = (stats.byKey[this.key] || 0) + 1;
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
      stats.audible.push({ t: clock.now, key: this.key });
      if (this.paused) {
        this.paused = false; stats.playing++;
        stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.playing);
        if (this.isVoice) {
          stats.voicePlaying++;
          if (stats.voicePlaying > stats.maxVoiceConcurrent) stats.maxVoiceConcurrent = stats.voicePlaying;
          if (stats.voicePlaying > 1) stats.overlapEvents.push({ t: clock.now, key: this.key, n: stats.voicePlaying });
        }
      }
      if (this._endTimer) clock.clear(this._endTimer);
      const drop = typeof cfg.dropEnded === "function" ? cfg.dropEnded(this) : !!cfg.dropEnded;
      this._endTimer = clock.setTimeout(() => {
        this._endTimer = null;
        if (!this.paused) { this.paused = true; stats.playing--; if (this.isVoice) stats.voicePlaying--; }
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
  const synth = { oscStarted: 0 };
  window.AudioContext = g.AudioContext = class {
    constructor() { this.state = "running"; this.sampleRate = 44100; this.currentTime = 0; this.destination = {}; }
    resume() { this.state = "running"; return Promise.resolve(); }
    createBuffer(ch, len, rate) { return { getChannelData: () => new Float32Array(len) }; }
    createConvolver() { return { buffer: null, connect: (n) => n }; }
    createOscillator() { return { type: "", frequency: { setValueAtTime() {} }, connect: (n) => n, start() { synth.oscStarted++; }, stop() {} }; }
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
  // already-initialised app from a previous test.
  const appPath = path.join(SCRATCH, `app_t_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(appPath, fs.readFileSync(appFile));
  await import("file://" + appPath);
  fs.unlinkSync(appPath);

  const doc = window.document;
  const api = {
    dom, window, doc, clock, stats, wakeLog, speechLog, cfg, synth, vibrations,
    set(id, v) { doc.getElementById(id).dataset.value = String(v); },
    setSeg(id, v) { doc.getElementById(id).dataset.value = v; },
    click(id) { doc.getElementById(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true })); },
    combo: () => doc.getElementById("combo").textContent,
    phase: () => doc.getElementById("phase").textContent,
    clockText: () => doc.getElementById("clock").textContent,
    // Waits real wall-clock time, needed when a test drives requestAnimationFrame
    // (which runs on real timers) rather than the virtual clock.
    realWait: (ms) => new Promise((r) => saved.setTimeout(r, ms)),
    restore() { g.setTimeout = saved.setTimeout; g.setInterval = saved.setInterval; g.clearTimeout = saved.clearTimeout; g.clearInterval = saved.clearInterval; Date.now = saved.dateNow; },
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
