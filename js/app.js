// app.js — the brain of the trainer: settings controls, timer, bell, and voice.

import { randomCombo, comboToText, comboToSpeech, comboName, MOVES } from "./combos.js";
import { VERSION, RELEASED } from "./version.js";
import { loadHistory, saveHistory, recordRound, currentStreak, trainedToday, formatDuration } from "./stats.js";

// ---------- Segmented control: tap a segment, or swipe across it ----------
function initSeg(id) {
  const seg = document.getElementById(id);
  const opts = [...seg.querySelectorAll(".seg__opt")];
  seg.style.setProperty("--count", opts.length);

  function setIndex(i) {
    i = Math.max(0, Math.min(opts.length - 1, i));
    seg.style.setProperty("--i", i);
    seg.dataset.value = opts[i].dataset.value;
    opts.forEach((o, k) => o.setAttribute("aria-selected", k === i));
    saveSettings();
  }
  const idxFromX = (x) => {
    const r = seg.getBoundingClientRect();
    return Math.floor(((x - r.left) / r.width) * opts.length);
  };

  let dragging = false;
  seg.addEventListener("pointerdown", (e) => { dragging = true; seg.setPointerCapture(e.pointerId); setIndex(idxFromX(e.clientX)); });
  seg.addEventListener("pointermove", (e) => { if (dragging) setIndex(idxFromX(e.clientX)); });
  const stop = () => { dragging = false; };
  seg.addEventListener("pointerup", stop);
  seg.addEventListener("pointercancel", stop);
  seg.addEventListener("keydown", (e) => {
    const cur = opts.findIndex((o) => o.dataset.value === seg.dataset.value);
    if (e.key === "ArrowRight") { setIndex(cur + 1); e.preventDefault(); }
    if (e.key === "ArrowLeft") { setIndex(cur - 1); e.preventDefault(); }
  });

  setIndex(Math.max(0, opts.findIndex((o) => o.dataset.value === seg.dataset.value)));
  return {
    get value() { return seg.dataset.value; },
    set(v) { const i = opts.findIndex((o) => o.dataset.value === String(v)); if (i >= 0) setIndex(i); },
  };
}

// ---------- Stepper: tap +/-, or drag the number to scrub ----------
function initStep(id) {
  const step = document.getElementById(id);
  const valEl = step.querySelector(".step__val");
  const min = +step.dataset.min, max = +step.dataset.max, st = +step.dataset.step;
  const get = () => +step.dataset.value;

  function set(v) {
    v = Math.round(v / st) * st;
    v = Math.max(min, Math.min(max, v));
    step.dataset.value = v;
    valEl.textContent = v;
    saveSettings();
  }
  // Tap to nudge, or press and hold to run. Work time steps in 5s, so going
  // from 120s to 180s was twelve separate taps — holding accelerates instead.
  step.querySelectorAll(".step__btn").forEach((b) => {
    const dir = +b.dataset.dir;
    const bump = () => set(get() + dir * st);
    let delayTimer = null, repeatTimer = null, fromPointer = false;
    const stopHold = () => {
      clearTimeout(delayTimer); clearTimeout(repeatTimer);
      delayTimer = repeatTimer = null;
    };

    b.addEventListener("pointerdown", (e) => {
      fromPointer = true; // so the click that follows doesn't double-count
      try { b.setPointerCapture(e.pointerId); } catch (err) {} // keeps the hold alive if the finger slides off
      bump();
      let gap = 260; // starts gentle, speeds up so long jumps don't take all day
      delayTimer = setTimeout(function again() {
        bump();
        gap = Math.max(55, gap * 0.8);
        repeatTimer = setTimeout(again, gap);
      }, 450); // long enough that a normal tap never repeats
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => b.addEventListener(ev, stopHold));

    // Keyboard (Enter/Space) arrives as a click with no pointerdown before it.
    b.addEventListener("click", () => {
      if (fromPointer) { fromPointer = false; return; }
      bump();
    });
  });

  let sx = 0, sv = 0, drag = false;
  valEl.addEventListener("pointerdown", (e) => { drag = true; sx = e.clientX; sv = get(); valEl.setPointerCapture(e.pointerId); });
  valEl.addEventListener("pointermove", (e) => { if (drag) set(sv + Math.round((e.clientX - sx) / 12) * st); });
  const stop = () => { drag = false; };
  valEl.addEventListener("pointerup", stop);
  valEl.addEventListener("pointercancel", stop);

  return { get value() { return get(); }, set(v) { set(+v); } };
}

// ---------- Remembering settings ----------
// The app used to open with the defaults every single time, so a member had to
// re-set level, pace and round lengths on every visit — friction on the single
// most repeated action there is. Settings now persist on the device (no account,
// no server). Wrapped in try/catch because Safari private browsing throws on
// localStorage access rather than just returning null.
const SETTINGS_KEY = "combify.settings.v1";
let settingsReady = false; // suppress saves while the controls are still initialising

function saveSettings() {
  if (!settingsReady) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      level: levelCtl.value, pace: paceCtl.value, rounds: roundsCtl.value,
      work: workCtl.value, rest: restCtl.value, voice: el.voiceOn.checked,
    }));
  } catch (e) { /* storage unavailable — settings just won't persist */ }
}
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch (e) { return {}; }
}

// ---------- Wire up controls ----------
const levelCtl = initSeg("level");
const paceCtl = initSeg("pace");
const roundsCtl = initStep("rounds");
const workCtl = initStep("workSec");
const restCtl = initStep("restSec");

const el = {
  stage: document.getElementById("stage"), phase: document.getElementById("phase"),
  clock: document.getElementById("clock"), round: document.getElementById("round"),
  combo: document.getElementById("combo"), startBtn: document.getElementById("startBtn"),
  resetBtn: document.getElementById("resetBtn"), voiceOn: document.getElementById("voiceOn"),
  stats: document.getElementById("stats"),
  comboName: document.getElementById("comboName"),
  app: document.querySelector(".app"),
  dialFill: document.getElementById("dialFill"),
};

// Restore whatever this member last used, then start persisting changes.
(function restoreSettings() {
  const s = loadSettings();
  if (s.level) levelCtl.set(s.level);
  if (s.pace) paceCtl.set(s.pace);
  if (s.rounds != null) roundsCtl.set(s.rounds);
  if (s.work != null) workCtl.set(s.work);
  if (s.rest != null) restCtl.set(s.rest);
  if (typeof s.voice === "boolean") el.voiceOn.checked = s.voice;
  settingsReady = true;
})();
el.voiceOn.addEventListener("change", saveSettings);

// ---------- Training history ----------
// Counts what the member actually did, so finishing a session shows something
// earned rather than just "nice work", and so a streak gives them a reason to
// come back tomorrow. Only COMPLETED work rounds count.
let history = loadHistory();
const session = { rounds: 0, punches: 0, seconds: 0, pendingPunches: 0, started: false };

const isPunch = (key) => /^[1-8]$/.test(key); // slips/rolls/blocks/pivots aren't punches

function resetSessionTally() {
  session.rounds = 0; session.punches = 0; session.seconds = 0;
  session.pendingPunches = 0; session.started = false;
}
// Called the moment a work round runs out — before the phase flips to rest or done.
function completeWorkRound() {
  const seconds = getWork();
  session.rounds += 1;
  session.punches += session.pendingPunches;
  session.seconds += seconds;
  history = recordRound(history, {
    punches: session.pendingPunches,
    seconds,
    firstOfSession: !session.started,
  });
  saveHistory(history);
  session.started = true;
  session.pendingPunches = 0;
}

// Stamp the build into the About section so a phone showing an old version is
// obvious — that's usually a cached copy, not a change that failed to deploy.
(function showVersion() {
  const slot = document.getElementById("appVersion");
  if (slot) slot.textContent = `${VERSION} · ${RELEASED}`;
})();

// Read settings through the controls
const getLevel = () => levelCtl.value;
const getPace = () => +paceCtl.value;
const getRounds = () => roundsCtl.value;
const getWork = () => workCtl.value;
const getRest = () => restCtl.value;

const state = { running: false, phase: "ready", currentRound: 0, secondsLeft: 0, phaseEndsAt: 0, tickTimer: null, comboTimer: null, comboFallback: null, clipWatchdog: null };

// ---------- Screen wake lock ----------
// Keeps the screen on while a session runs, so a member who sets the phone
// down mid-round doesn't have the screen (and with it, JS timers/audio) go to
// sleep partway through. The lock is auto-released by the browser whenever
// the tab is hidden (app-switch, screen off via power button, etc.), so we
// re-acquire it on visibilitychange if the session is still running.
let wakeLock = null;
async function acquireWakeLock() {
  if (!("wakeLock" in navigator) || !state.running) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (e) { wakeLock = null; } // e.g. denied, or tab not visible — non-fatal
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !state.running) return;
  acquireWakeLock();
  tick(); // catch the clock up immediately rather than showing a stale time
});

// ---------- Shared audio context (bell + voice clips both use this) ----------
let audioCtx = null;
function getAudioCtx() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// ---------- Bell: a real recorded ring bell, falling back to a synth tone ----------
// Same pattern as the voice clips: prefer a real sample (audio/sfx/bell.mp3),
// fall back to a synthesized tone if it's missing so the timer never breaks.
const SFX_DIR = "audio/sfx/";
const sfxCache = {};
// NOTE the deliberate asymmetry with the voice clips below: those default to ON
// because the files ARE in the repo and the fallback (robotic TTS) is bad. The
// bell sample is the opposite — there is no audio/sfx/bell.mp3 (the synth FM
// bell replaced it), and the fallback is the sound we actually want. So this
// stays OFF until a real sample proves it loaded. Defaulting it ON meant the
// app tried to play a missing file and rang nothing at all, because a browser
// that defers loading never fires the error event that would flip it back.
const sfx = { useSamples: false };
function preloadSfx() {
  const a = new Audio(SFX_DIR + "bell.mp3");
  a.preload = "auto";
  sfxCache.bell = a;
  const enable = () => { sfx.useSamples = true; };
  a.addEventListener("canplaythrough", enable, { once: true });
  a.addEventListener("loadeddata", enable, { once: true }); // whichever lands first
  a.addEventListener("error", () => { sfx.useSamples = false; }, { once: true });
}
preloadSfx();

// A synthetic reverb "room" — an algorithmically generated impulse response
// (exponentially decaying noise) fed through a ConvolverNode. This is what
// gives the bell an actual reverberating tail (reflections), on top of the
// tone's own long decay. Built once per AudioContext and reused.
let reverbNode = null;
function getReverb(ctx) {
  if (reverbNode) return reverbNode;
  const duration = 2.2, decayPower = 2.5;
  const length = Math.floor(ctx.sampleRate * duration);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decayPower);
    }
  }
  reverbNode = ctx.createConvolver();
  reverbNode.buffer = impulse;
  return reverbNode;
}

// Synthesized fallback tone — an FM "bell" (carrier + inharmonic modulator,
// the classic Chowning technique), not a plain sine wave. The modulation
// depth decays fast (bright clang settling into a purer ring) while the
// output decays slow (long natural ring-out), which is what makes it read
// as a struck metal bell instead of a beep. A parallel reverb send adds the
// reflected "in a room" tail on top of the tone's own decay.
function bellStrike(ctx, t) {
  const carrierFreq = 600;   // a bright, mid-pitched brass bell — not a tiny jingle-bell tinkle
  const modFreq = carrierFreq * 1.4; // inharmonic ratio is what makes it sound metallic, not musical

  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.setValueAtTime(carrierFreq, t);

  const modulator = ctx.createOscillator();
  modulator.type = "sine";
  modulator.frequency.setValueAtTime(modFreq, t);

  const modGain = ctx.createGain(); // modulation depth in Hz — starts wide (clang), narrows (settles)
  modGain.gain.setValueAtTime(carrierFreq * 3, t);
  modGain.gain.exponentialRampToValueAtTime(carrierFreq * 0.15, t + 0.8);
  modulator.connect(modGain).connect(carrier.frequency);

  const outGain = ctx.createGain(); // sharp strike, long ring-out
  outGain.gain.setValueAtTime(0.0001, t);
  outGain.gain.exponentialRampToValueAtTime(0.6, t + 0.008);
  outGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  carrier.connect(outGain);
  outGain.connect(ctx.destination); // dry signal

  const wetGain = ctx.createGain(); // reverb send level
  wetGain.gain.setValueAtTime(0.55, t);
  outGain.connect(getReverb(ctx)).connect(wetGain).connect(ctx.destination);

  modulator.start(t); carrier.start(t);
  modulator.stop(t + 2.5); carrier.stop(t + 2.5);
}
function synthBell(times = 1) {
  try {
    audioCtx = getAudioCtx();
    for (let i = 0; i < times; i++) bellStrike(audioCtx, audioCtx.currentTime + i * 0.65);
  } catch (e) { /* audio unavailable — timer still works */ }
}

// Ring the real bell sample `times` in a row (1 = round start, 3 = session over).
function ringBell(times = 1) {
  if (!sfx.useSamples) { synthBell(times); return; }
  const gap = 650; // ms between successive strikes — a natural "ding-ding" rhythm
  for (let i = 0; i < times; i++) {
    setTimeout(() => {
      const node = getPooledBell();
      // Any failure here still rings the synth: a round must never start or end
      // in silence just because a sample went missing.
      if (!node) { synthBell(1); return; }
      node.currentTime = 0;
      const p = node.play();
      if (p && p.catch) p.catch(() => { sfx.useSamples = false; synthBell(1); });
    }, i * gap);
  }
}

// Short dry tick for the pre-round "3, 2, 1" countdown — deliberately NOT
// bell-like, so it can never be mistaken for "go."
function playTick() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "square"; osc.frequency.setValueAtTime(1500, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.07);
  } catch (e) {}
}

// Two-beep "10 seconds left" cue — distinct from both the tick and the bell.
function playWarning() {
  try {
    const ctx = getAudioCtx();
    for (let i = 0; i < 2; i++) {
      const t = ctx.currentTime + i * 0.18;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "triangle"; osc.frequency.setValueAtTime(1100, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.65, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.15);
    }
  } catch (e) {}
}

// ---------- Voice ----------
// The app calls combos two ways, in order of preference:
//   1. Audio CLIPS in the /audio folder — one short file per move (audio/1.mp3,
//      audio/slip.mp3, ...). Generate these once with your ElevenLabs voice and
//      the app chains them into any combo. This is the good-sounding path.
//      See audio/README.md for the exact file list.
//   2. The browser's built-in TEXT-TO-SPEECH as a fallback, used automatically
//      when the clips aren't present (e.g. before you've added them).

// -- Clip playback (HTMLAudioElement) --
// One cached <audio> per word; each combo clones a fresh element to play so
// repeated/rapid words never fight over one element's state. This is the
// original approach that worked — its only past failure was silent source
// files, now fixed. (A reuse-with-unlock variant and a Web Audio variant were
// both tried and broke playback, so we're back to this.)
const CLIP_DIR = "audio/";
const CLIP_EXT = ".mp3"; // match whatever your voice tool exports
const CLIP_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "slip", "roll", "block", "pivot"];
const clipCache = {};
// Assume the clip set is present (it's committed to the repo) and only fall
// back to TTS on an actual load error. Waiting for "canplaythrough" (the old
// approach) left phones stuck: mobile Safari frequently never fires it for
// preloaded audio, so useClips stayed false and every combo fell through to
// browser text-to-speech — whose "onend" also frequently never fires on iOS,
// so combos only advanced via the 10s safety timeout in speakCombo(). That's
// the "silent + 10-20 seconds per combo" bug on phones.
const voice = { useClips: true, current: null };

function preloadClips() {
  CLIP_KEYS.forEach((key) => {
    const a = new Audio(CLIP_DIR + key + CLIP_EXT);
    a.preload = "auto";
    clipCache[key] = a;
    a.addEventListener("error", () => { voice.useClips = false; }, { once: true });
  });
}
preloadClips();

// -- Mobile unlock pool --
// iOS (and some Android WebViews) only allow an <audio> element to play
// programmatically if THAT SPECIFIC element already had .play() called on it
// from inside a real tap. Cloning a fresh element later (inside a setTimeout,
// as combos are called during a round) makes a brand-new element that was
// never touched by a tap, so iOS silently blocks it. Desktop has no such
// restriction, which is why this only ever showed up on phones.
// Fix: at Start-tap time, pre-create a small pool of clones per word (and for
// the bell) and "prime" each one with a play()+pause() inside the gesture.
// Playback later reuses those primed elements round-robin instead of cloning
// fresh ones — same cloned-HTMLAudioElement architecture, just created (and
// unlocked) at the right time.
// 2 per word, not 3: combo playback is strictly sequential (each word waits for
// the previous to end), so a word never needs more than one spare. Holding
// dozens of live <audio> elements makes iOS drop media events, which is what
// killed the chain mid-round.
const UNLOCK_POOL_SIZE = 2;
const clipPool = {};
const bellPool = [];
const poolIndex = {};
let audioUnlocked = false;

function primeElement(a) {
  a.muted = true;
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
  a.pause();
  try { a.currentTime = 0; } catch (e) {}
  a.muted = false;
}

function unlockAudioForMobile() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  CLIP_KEYS.forEach((key) => {
    // Reuse the already-preloaded element as the first slot rather than making
    // another one — otherwise the page holds the 12 preloaded elements PLUS a
    // fresh set per word, which is what pushed us to ~50 live elements.
    const pool = clipCache[key] ? [clipCache[key]] : [];
    while (pool.length < UNLOCK_POOL_SIZE) pool.push(new Audio(CLIP_DIR + key + CLIP_EXT));
    pool.forEach(primeElement);
    clipPool[key] = pool;
  });
  // Only worth priming if a real sample actually loaded; the synth bell needs
  // no unlocking (it goes through the AudioContext resumed in this same tap).
  if (sfx.useSamples) {
    for (let i = 0; i < UNLOCK_POOL_SIZE; i++) {
      const a = new Audio(SFX_DIR + "bell.mp3");
      primeElement(a);
      bellPool.push(a);
    }
  }
}

// Round-robin a primed element for `key`, falling back to a plain clone if
// the pool isn't ready yet (e.g. voice toggled on before Start was tapped).
function getPooledClip(key) {
  const pool = clipPool[key];
  if (!pool || !pool.length) {
    const src = clipCache[key];
    return src ? src.cloneNode() : null;
  }
  const i = (poolIndex[key] || 0) % pool.length;
  poolIndex[key] = i + 1;
  return pool[i];
}
function getPooledBell() {
  if (!bellPool.length) return sfxCache.bell ? sfxCache.bell.cloneNode() : null;
  const i = (poolIndex["__bell"] || 0) % bellPool.length;
  poolIndex["__bell"] = i + 1;
  return bellPool[i];
}

// The "Combo pace" setting previously only controlled the gap AFTER a full
// combo finishes — it had no effect on how quickly the words WITHIN a combo
// were called, so a long advanced combo took just as long to speak at "Fast"
// as at "Relaxed." Derive a small inter-word gap from the same pace value so
// one setting now governs both: faster pace = quicker cadence AND shorter
// gap between combos.
const getWordGap = () => Math.max(40, Math.min(300, getPace() * 0.09));

// Play a combo's clips one after another, then call onDone().
//
// Every step is guarded by a watchdog timer. Previously the chain advanced ONLY
// on the "ended" event, so if iOS dropped a single one (it does this on reused
// elements) playNext() was never called again, onDone() never fired, and
// nextCombo() never rescheduled — the combo loop died permanently for the rest
// of the round. That's the "sound stops after a few combos" bug. Now a missing
// event just means we advance slightly late instead of stopping forever.
function playClips(keys, onDone) {
  let i = 0;
  const playNext = () => {
    clearTimeout(state.clipWatchdog);
    voice.current = null;
    if (!state.running || state.phase !== "work" || i >= keys.length) { onDone(); return; }
    // Highlight here, not inside playWord: this runs exactly once per move,
    // whereas playWord re-enters on a retry and would re-pop the same word.
    highlightMove(i);
    playWord(keys[i++], 0);
  };

  // One word, with one retry. A clip sometimes reports "ended" almost instantly
  // without having made a sound (a decode that quietly failed on a reused
  // element). The chain treated that as spoken, so a combo shown as 1-2-3-4 was
  // heard as "1 _ 3 4" — a silent hole where a punch should be. We now notice
  // an impossibly-short playback and try the word once more on the pool's other
  // element before moving on.
  const playWord = (key, attempt) => {
    const node = getPooledClip(key); // round-robin: a retry lands on a different element
    if (!node) { playNext(); return; }
    // Never let two clips sound at once. Without this a retry (or a late
    // event) could start the next word on top of one still playing, which is
    // heard as words cutting each other off and the cadence going ragged.
    if (voice.current && voice.current !== node) {
      try { voice.current.pause(); } catch (e) {}
    }
    // Clear handlers from this element's previous use so a late event from an
    // earlier combo can't advance the current one.
    node.onended = null;
    node.onerror = null;
    node.muted = false; // priming mutes elements; never inherit that into playback
    try { node.currentTime = 0; } catch (e) {}
    voice.current = node;

    const startedAt = Date.now();
    let moved = false;
    const once = (fn) => () => {
      if (moved) return; // whichever fires first wins: ended, error, or watchdog
      moved = true;
      clearTimeout(state.clipWatchdog);
      fn();
    };
    const retryOr = (fallback) => {
      if (attempt < 1) { playWord(key, attempt + 1); return; }
      fallback();
    };
    const afterWord = () => {
      if (!state.running || state.phase !== "work") { onDone(); return; }
      setTimeout(playNext, getWordGap());
    };
    const finished = once(() => {
      // Did it actually play, or just claim to? Deliberately a small ABSOLUTE
      // threshold rather than a fraction of the clip's length: the shortest
      // clip in audio/ is ~390ms, while a clip that never reached the speaker
      // reports back in a handful of milliseconds. Judging this as a fraction
      // of duration was too eager — it retried words that had played fine,
      // so they were spoken twice and the cadence went out.
      const elapsed = Date.now() - startedAt;
      if (elapsed < 120) { try { node.pause(); } catch (e) {} retryOr(afterWord); return; }
      afterWord();
    });
    const skip = once(() => { try { node.pause(); } catch (e) {} retryOr(playNext); });

    node.onended = finished;
    node.onerror = skip;
    const p = node.play();
    if (p && p.catch) p.catch(skip);

    // Fall forward once the clip's own length has elapsed (plus slack). Falls
    // back to a fixed guess when duration isn't known yet — common on iOS,
    // where metadata often hasn't loaded at first play.
    const durMs = node.duration && isFinite(node.duration) ? node.duration * 1000 : 1200;
    state.clipWatchdog = setTimeout(finished, durMs + 800);
  };

  playNext();
}

// -- Text-to-speech fallback --
// Browsers ship a robotic default AND better "neural/natural" voices; pick the
// most natural English voice available on the device.
let chosenVoice = null;
function pickVoice() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (!voices.length) return;
  const en = voices.filter((v) => /^en/i.test(v.lang) || /english/i.test(v.name));
  const pool = en.length ? en : voices;
  const prefer = [/natural/i, /neural/i, /online/i, /google/i, /samantha/i, /aria/i, /jenny/i, /siri/i, /daniel/i, /alex/i];
  for (const rx of prefer) {
    const hit = pool.find((v) => rx.test(v.name));
    if (hit) { chosenVoice = hit; return; }
  }
  chosenVoice = pool.find((v) => v.default) || pool[0];
}
if ("speechSynthesis" in window) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice; // voices load async
}

// Speak a combo, then call onDone() when it finishes — so the NEXT combo waits
// for this one to finish and then applies the pace gap. This keeps the callout
// in sync with the pace setting instead of talking over itself.
function speakCombo(combo, onDone) {
  if (!el.voiceOn.checked) { onDone(); return; }
  if (voice.useClips) { playClips(combo, onDone); return; }
  if (!("speechSynthesis" in window)) { onDone(); return; }
  const u = new SpeechSynthesisUtterance(comboToSpeech(combo));
  if (chosenVoice) u.voice = chosenVoice;
  u.rate = 1.0;
  u.pitch = 1.0;
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(state.comboFallback); onDone(); };
  u.onend = finish;
  u.onerror = finish;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  state.comboFallback = setTimeout(finish, 10000); // safety if onend never fires
}

// ---------- Helpers ----------
const format = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
// Motion is opt-out: anyone who has asked their phone to reduce motion gets the
// final numbers immediately with no animation. Also skipped where there's no
// requestAnimationFrame at all, which keeps the finish screen deterministic
// under test.
function motionOK() {
  if (typeof requestAnimationFrame !== "function") return false;
  try {
    return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) { return true; }
}

// A short buzz, where the device supports it. Silently does nothing on iOS
// Safari, which has never implemented the Vibration API.
function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

// Tick a number up to its final value: winds up, races through the middle, then
// slows into the total and lands with a pop. The slowing half ticks a small
// haptic on each change — because the changes naturally thin out as it
// decelerates, that reads as the count "settling" rather than a buzz.
function countUp(node, to, { ms = 900, pop = false, haptics = false } = {}) {
  if (!motionOK() || to <= 0) { node.textContent = to.toLocaleString(); return; }
  const started = performance.now();
  let shown = -1;
  let lastBuzz = 0;
  const step = (now) => {
    const p = Math.min(1, (now - started) / ms);
    // ease-in-out cubic: accelerate away from 0, decelerate into the total
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const value = Math.round(to * eased);
    if (value !== shown) {
      shown = value;
      node.textContent = value.toLocaleString();
      // Only in the second half, and never faster than the skin can tell apart.
      if (haptics && p > 0.55 && now - lastBuzz > 45) { buzz(7); lastBuzz = now; }
    }
    if (p < 1) { requestAnimationFrame(step); return; }
    node.textContent = to.toLocaleString();
    if (pop) {
      node.classList.add("is-pop");
      node.addEventListener("animationend", () => node.classList.remove("is-pop"), { once: true });
    }
    if (haptics) buzz([18, 45, 30]); // the landing: two beats, firmer than the ticks
  };
  requestAnimationFrame(step);
}

// The end-of-session summary: "2 rounds · 32 punches · 6:40 · 3 days in a row",
// with the counts ticking up and a flame on a streak worth showing off.
function buildFinishSummary(streak, streakBit) {
  el.stats.textContent = "";
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // The punch total is the number worth reading from across the room, so it
  // gets its own line at display size rather than being one item in a
  // small grey list.
  const hero = make("div", "finish__hero");
  const heroNum = make("span", "stat-num", "0");
  hero.appendChild(heroNum);
  hero.appendChild(make("span", "finish__label", session.punches === 1 ? "punch" : "punches"));
  el.stats.appendChild(hero);
  countUp(heroNum, session.punches, { ms: 1200, pop: true, haptics: true });

  // Everything else is supporting detail on one quieter line.
  const meta = make("div", "finish__meta");
  meta.appendChild(make("span", null, `${session.rounds} round${session.rounds === 1 ? "" : "s"}`));
  meta.appendChild(make("span", "finish__dot", " · "));
  meta.appendChild(make("span", null, formatDuration(session.seconds)));

  if (streakBit) {
    meta.appendChild(make("span", "finish__dot", " · "));
    const wrap = make("span", "streak");
    // Any streak gets the flame. Gating it at 2+ meant a member finishing their
    // first ever session — the moment most worth rewarding — saw nothing.
    if (streak >= 1) {
      // Drawn as a real path rather than stacked CSS teardrops: at this size
      // the CSS version rendered as an orange smudge sitting on the number.
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "flame");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const outer = document.createElementNS("http://www.w3.org/2000/svg", "path");
      outer.setAttribute("class", "flame__outer");
      outer.setAttribute("d", "M13.5 1.5c.6 3.2-1.1 4.7-2.6 6.2C9.2 9.4 7.6 11 7.6 14a6.4 6.4 0 0 0 12.8 0c0-3.6-2.1-5.6-3.9-7.6-1.1-1.2-2.1-2.4-3-4.9Z");
      const inner = document.createElementNS("http://www.w3.org/2000/svg", "path");
      inner.setAttribute("class", "flame__inner");
      inner.setAttribute("d", "M14 11.2c.4 1.8-.6 2.6-1.4 3.4-.9.9-1.7 1.8-1.7 3.3a3.1 3.1 0 0 0 6.2 0c0-1.9-1.1-3-2-4-.6-.7-1-1.3-1.1-2.7Z");
      svg.appendChild(outer);
      svg.appendChild(inner);
      wrap.appendChild(svg);
    }
    wrap.appendChild(make("span", null, streakBit));
    meta.appendChild(wrap);
  }
  el.stats.appendChild(meta);
}

// The strip under the combo. Kept OUT of the way mid-round — during work and
// rest the screen should show the punches and nothing else — and used either
// side of a session to show what was earned and why to come back.
function renderStats() {
  if (!el.stats) return;
  if (state.phase === "work" || state.phase === "rest" || state.phase === "countdown") {
    el.stats.textContent = "";
    return;
  }
  const streak = currentStreak(history);
  const streakBit = streak > 0 ? `${streak} day${streak === 1 ? "" : "s"} in a row` : null;

  if (state.phase === "done") {
    // Built once per finish, not on every render, or the count-up would
    // restart every time something else redraws.
    if (el.stats.dataset.finished !== "1") {
      buildFinishSummary(streak, streakBit);
      el.stats.dataset.finished = "1";
    }
    return;
  }
  delete el.stats.dataset.finished;
  // Ready screen
  const bits = [];
  if (streakBit) bits.push(streakBit);
  if (history.totals.sessions > 0) {
    bits.push(`${history.totals.sessions} session${history.totals.sessions === 1 ? "" : "s"}`);
  }
  if (history.totals.punches > 0) bits.push(`${history.totals.punches.toLocaleString()} punches`);
  el.stats.textContent = bits.length ? bits.join(" · ") : "";
}

function render() {
  // Full-screen only while a session is actually running. Pausing drops back to
  // the normal screen so settings are reachable without leaving the session —
  // no extra button to learn, and pausing is already what you do to change
  // something. Finishing exits too, so you can adjust and go again.
  if (el.app) {
    const inSession = state.running && (state.phase === "countdown" || state.phase === "work" || state.phase === "rest");
    el.app.dataset.focus = inSession ? "1" : "0";
  }
  el.clock.textContent = state.phase === "countdown" ? String(state.secondsLeft) : format(state.secondsLeft);
  el.stage.dataset.phase = state.phase;
  el.phase.textContent = state.phase === "work" ? "Work" : state.phase === "rest" ? "Rest" : state.phase === "done" ? "Done" : state.phase === "countdown" ? "Get Ready" : "Ready";
  el.round.textContent = state.phase === "countdown" ? `Round 1 / ${getRounds()}` : `Round ${state.currentRound} / ${getRounds()}`;
  renderProgress();
  renderStats();
  startDialLoop();
}

// The ring empties as the phase runs down. r=54 in the SVG's own units, so the
// circumference is 2*pi*54; we draw that much dash and push the offset toward a
// full circle as time runs out.
const DIAL_CIRCUMFERENCE = 2 * Math.PI * 54;
// Fraction of the phase remaining, from the same real-time deadline tick()
// uses — so the ring can never disagree with the clock. While running it is
// fractional (that's what makes the sweep smooth); paused it holds on the
// frozen whole-second value, which is also where resume() restarts the clock.
//
// The COUNTDOWN is deliberately the exception: it stays on whole seconds so
// the disc jumps 3 → 2 → 1 in hard steps. Three big chunks read as "get
// ready" far better than a smooth sweep, which just looks like a short round.
function phaseFractionLeft() {
  const total = state.phase === "work" ? getWork() : state.phase === "rest" ? getRest() : state.phase === "countdown" ? 3 : 0;
  if (!(total > 0)) return 0;
  const stepped = state.phase === "countdown" || !state.running;
  const left = stepped ? state.secondsLeft / total : (state.phaseEndsAt - Date.now()) / 1000 / total;
  return Math.max(0, Math.min(1, left));
}
function renderProgress() {
  if (!el.dialFill) return;
  el.dialFill.style.strokeDasharray = String(DIAL_CIRCUMFERENCE);
  el.dialFill.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - phaseFractionLeft()));
}
// Redraw the ring every frame during work and rest, so it drains seamlessly
// instead of ticking down in one-second steps. NOT during the countdown —
// that one is meant to step (see phaseFractionLeft), and render() already
// redraws it once a second. Self-terminating: pause, reset and done all clear
// state.running, and the next frame simply doesn't reschedule. Reduced-motion
// users (and jsdom, which has no rAF) keep the per-second updates throughout.
let dialRaf = 0;
function smoothPhase() { return state.phase === "work" || state.phase === "rest"; }
function dialLoop() {
  dialRaf = 0;
  if (!state.running || !smoothPhase()) return;
  renderProgress();
  dialRaf = requestAnimationFrame(dialLoop);
}
function startDialLoop() {
  if (!dialRaf && state.running && smoothPhase() && motionOK()) dialRaf = requestAnimationFrame(dialLoop);
}

// Render a combo as separate move tokens rather than one string. Each token
// keeps its trailing separator and never breaks internally, so a wrapped combo
// can't start a line with a dangling "-" — which is what a plain string did on
// a phone. textContent is unchanged ("1 - 2 - slip"), so everything reading the
// combo off screen still sees exactly what the voice says.
function showCombo(combo) {
  el.combo.textContent = "";
  const frag = document.createDocumentFragment();
  combo.forEach((key, i) => {
    const last = i === combo.length - 1;
    const t = document.createElement("span");
    t.className = "mv";
    // "1 -" stays together; the space BETWEEN tokens is a plain text node, which
    // is the only place a line may break. Without that separate text node there
    // is no break opportunity at all and the combo runs off the screen.
    // The move itself is wrapped separately from its separator so the callout
    // highlight lands on the move alone — colouring "2 -" as one unit made the
    // marker look wider than the thing it marks. textContent is unaffected.
    const label = document.createElement("span");
    label.className = "mv__label";
    label.textContent = MOVES[key].label;
    t.appendChild(label);
    if (!last) t.appendChild(document.createTextNode(" -"));
    frag.appendChild(t);
    if (!last) frag.appendChild(document.createTextNode(" "));
  });
  el.combo.appendChild(frag);
  // Long combos get stepped down so a 12-move one doesn't fill the screen at
  // the size a 3-move one wants to be.
  const n = combo.length;
  el.combo.style.setProperty("--fit", n <= 4 ? "1" : n <= 6 ? "0.88" : n <= 9 ? "0.78" : "0.68");
}

// Mark the ONE move being called right now, so the screen tracks the voice
// instead of just displaying the whole combo at once — you can glance down
// mid-combo and see where you are. Popping the entire combo on arrival (what
// this replaced) drew the eye at exactly the moment there was nothing new to
// read. Styling is in CSS so prefers-reduced-motion can drop the movement and
// keep the colour, which is the part that actually carries the information.
function highlightMove(idx) {
  if (!el.combo) return;
  const moves = el.combo.querySelectorAll(".mv");
  for (const m of moves) m.classList.remove("is-now");
  const cur = moves[idx];
  if (!cur) return;
  void cur.offsetWidth; // restart the animation rather than inherit a finished one
  cur.classList.add("is-now");
}

// ---------- Combo calling (only during work) ----------
function nextCombo() {
  if (!state.running || state.phase !== "work") return;
  state.lastComboAt = Date.now(); // heartbeat, watched by tick() — see reviveComboLoop
  const combo = randomCombo(getLevel());
  session.pendingPunches += combo.filter(isPunch).length;
  if (el.comboName) el.comboName.textContent = comboName(combo) || "";
  showCombo(combo);
  speakCombo(combo, () => {
    if (!state.running || state.phase !== "work") return;
    state.comboTimer = setTimeout(nextCombo, getPace()); // pace read fresh each time
  });
}
function startComboLoop() { state.lastComboAt = Date.now(); nextCombo(); }

// Last line of defence: if we're in a work round but no combo has been called
// for far longer than the pace allows, something in the audio chain stalled.
// Rather than leave the member in silence for the rest of the round, kick the
// loop back into life. The 1s tick already runs, so this costs nothing.
function reviveComboLoop() {
  if (!state.running || state.phase !== "work") return;
  if (!el.voiceOn.checked) return;
  // Generous: a long advanced combo at Relaxed pace can legitimately run ~12s.
  const stalledFor = Date.now() - (state.lastComboAt || 0);
  if (stalledFor < getPace() + 20000) return;
  stopComboLoop();
  startComboLoop();
}
function stopComboLoop() {
  clearTimeout(state.comboTimer);
  clearTimeout(state.comboFallback);
  clearTimeout(state.clipWatchdog);
  state.comboTimer = null;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (voice.current) { try { voice.current.pause(); } catch (e) {} voice.current = null; }
}

// ---------- Phase changes ----------
// Every phase records the wall-clock moment it should END, not just a countdown
// number. tick() then derives the remaining seconds from the real clock, so the
// timer stays honest even when the browser stops firing our interval on time.
function beginPhase(seconds) {
  state.secondsLeft = seconds;
  state.phaseEndsAt = Date.now() + seconds * 1000;
}
function enterWork() { state.phase = "work"; beginPhase(getWork()); state.warned10 = false; ringBell(1); render(); startComboLoop(); }
function enterRest() { state.phase = "rest"; beginPhase(getRest()); ringBell(2); stopComboLoop(); el.combo.textContent = "Rest"; if (el.comboName) el.comboName.textContent = ""; window.speechSynthesis && window.speechSynthesis.cancel(); render(); }
function finish() {
  state.phase = "done"; state.running = false;
  stopComboLoop(); clearInterval(state.tickTimer); releaseWakeLock(); ringBell(3);
  // The streak lives in the summary below; repeating it here in display type
  // read as a bug rather than a flourish.
  el.combo.textContent = "Nice work.";
  el.combo.style.removeProperty("--fit");
  if (el.comboName) el.comboName.textContent = "";
  el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running");
  render();
}

// ---------- The one-second heartbeat ----------
// Reads the REAL elapsed time rather than assuming this ran exactly 1s after
// the last one. Browsers throttle timers hard in a backgrounded tab (often to
// once a minute), so counting ticks used to lose almost all of a round: a
// member who switched to their music app to skip a track came back to a timer
// that had barely moved. Deriving from Date.now() means the round keeps real
// time no matter how irregularly this fires.
function tick() {
  const prev = state.secondsLeft;
  const remaining = Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000));
  state.secondsLeft = remaining;
  const changed = remaining !== prev;
  // If the tab was asleep we may have skipped several seconds at once; only
  // fire the audio cues when we actually landed on their second, so coming
  // back doesn't dump a pile of beeps at once.
  const stepped = prev - remaining === 1;

  if (state.phase === "countdown") {
    if (remaining > 0) { if (changed) playTick(); render(); return; }
    state.currentRound = 1;
    enterWork();
    return;
  }
  if (state.phase === "work" && stepped) {
    if (!state.warned10 && remaining === 10 && getWork() > 10) {
      playWarning();
      state.warned10 = true;
    }
    // Repeat the same clapper cue for each of the final 3 seconds — a quick
    // "wrap it up" flourish leading into the bell.
    if (remaining >= 1 && remaining <= 3) playWarning();
  }
  reviveComboLoop();
  if (remaining <= 0) {
    if (state.phase === "work") {
      completeWorkRound();
      if (state.currentRound >= getRounds()) { finish(); return; }
      enterRest();
    } else if (state.phase === "rest") { state.currentRound += 1; enterWork(); }
    return; // enterWork/enterRest already rendered
  }
  render();
}

// ---------- Full-screen while training ----------
// A visible URL bar mid-session reads as "website", not "app". Where the
// platform allows it (Android Chrome, desktop browsers), take the whole
// screen for the session and give it back when the session ends. iPhone
// Safari has no fullscreen API for plain elements — there the answer is
// installing to the home screen, which manifest.json (display: standalone)
// already covers. Deliberately kept through pause: flicking in and out of
// fullscreen on a quick pause/resume is worse than the bar staying away.
// Enter must be called synchronously from a tap — it needs user activation.
function enterFullscreen() {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request || document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const p = request.call(root, { navigationUI: "hide" });
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}
// Nothing in the app gives fullscreen back. Finishing and resetting both used
// to, and both were wrong: the screen collapsing out of fullscreen mid-
// celebration yanked the layout, and hitting Reset to go again dumped you back
// to a browser chrome you then had to escape a second time. Leaving is the
// user's call — Esc on a desktop, the system gesture on a phone.

// ---------- Start / pause / reset ----------
function start() {
  audioCtx = getAudioCtx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  unlockAudioForMobile(); // must run synchronously inside this tap — see note above clipPool
  enterFullscreen();
  state.running = true;
  acquireWakeLock();
  el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running");
  state.phase = "countdown"; beginPhase(3);
  resetSessionTally();
  el.combo.textContent = "Get ready...";
  if (el.comboName) el.comboName.textContent = "";
  playTick(); render();
  state.tickTimer = setInterval(tick, 1000);
}
function pause() { state.running = false; clearInterval(state.tickTimer); stopComboLoop(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); el.startBtn.textContent = "Resume"; el.startBtn.classList.remove("is-running"); render(); }
function resume() { state.running = true; enterFullscreen(); el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running"); state.phaseEndsAt = Date.now() + state.secondsLeft * 1000; if (state.phase === "work") startComboLoop(); state.tickTimer = setInterval(tick, 1000); acquireWakeLock(); render(); }
function reset() { clearInterval(state.tickTimer); stopComboLoop(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); state.running = false; state.phase = "ready"; state.currentRound = 0; state.secondsLeft = 0; el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running"); el.combo.textContent = "Press start to begin"; if (el.comboName) el.comboName.textContent = ""; render(); }

// ---------- Wire up the buttons ----------
// "countdown" MUST be in the resume list. Without it, pausing during the 3-2-1
// left the button with no branch that matched, so every further press just
// called pause() again — a dead Resume button you could only escape with Reset.
const PAUSABLE = ["countdown", "work", "rest"];
el.startBtn.addEventListener("click", () => {
  if (!state.running && state.phase === "ready") start();
  else if (!state.running && PAUSABLE.includes(state.phase)) resume();
  else if (!state.running && state.phase === "done") { reset(); start(); }
  else pause();
});
el.resetBtn.addEventListener("click", reset);
reset();

// Register the service worker so Combify works offline after the first visit.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
