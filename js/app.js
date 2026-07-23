// app.js — the brain of the trainer: settings controls, timer, bell, and voice.

import { randomCombo, comboToText, comboToSpeech } from "./combos.js";
import { VERSION, RELEASED } from "./version.js";

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
  step.querySelectorAll(".step__btn").forEach((b) =>
    b.addEventListener("click", () => set(get() + (+b.dataset.dir) * st))
  );

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
function render() {
  el.clock.textContent = state.phase === "countdown" ? String(state.secondsLeft) : format(state.secondsLeft);
  el.stage.dataset.phase = state.phase;
  el.phase.textContent = state.phase === "work" ? "Work" : state.phase === "rest" ? "Rest" : state.phase === "done" ? "Done" : state.phase === "countdown" ? "Get Ready" : "Ready";
  el.round.textContent = state.phase === "countdown" ? `Round 1 / ${getRounds()}` : `Round ${state.currentRound} / ${getRounds()}`;
}

// ---------- Combo calling (only during work) ----------
function nextCombo() {
  if (!state.running || state.phase !== "work") return;
  state.lastComboAt = Date.now(); // heartbeat, watched by tick() — see reviveComboLoop
  const combo = randomCombo(getLevel());
  el.combo.textContent = comboToText(combo);
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
function enterRest() { state.phase = "rest"; beginPhase(getRest()); ringBell(2); stopComboLoop(); el.combo.textContent = "Rest"; window.speechSynthesis && window.speechSynthesis.cancel(); render(); }
function finish() { state.phase = "done"; state.running = false; stopComboLoop(); clearInterval(state.tickTimer); releaseWakeLock(); ringBell(3); el.combo.textContent = "Session complete — nice work."; el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running"); render(); }

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
      if (state.currentRound >= getRounds()) { finish(); return; }
      enterRest();
    } else if (state.phase === "rest") { state.currentRound += 1; enterWork(); }
    return; // enterWork/enterRest already rendered
  }
  render();
}

// ---------- Start / pause / reset ----------
function start() {
  audioCtx = getAudioCtx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  unlockAudioForMobile(); // must run synchronously inside this tap — see note above clipPool
  state.running = true;
  acquireWakeLock();
  el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running");
  state.phase = "countdown"; beginPhase(3);
  el.combo.textContent = "Get ready...";
  playTick(); render();
  state.tickTimer = setInterval(tick, 1000);
}
function pause() { state.running = false; clearInterval(state.tickTimer); stopComboLoop(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); el.startBtn.textContent = "Resume"; el.startBtn.classList.remove("is-running"); }
function resume() { state.running = true; el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running"); state.phaseEndsAt = Date.now() + state.secondsLeft * 1000; if (state.phase === "work") startComboLoop(); state.tickTimer = setInterval(tick, 1000); acquireWakeLock(); }
function reset() { clearInterval(state.tickTimer); stopComboLoop(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); state.running = false; state.phase = "ready"; state.currentRound = 0; state.secondsLeft = 0; el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running"); el.combo.textContent = "Press start to begin"; render(); }

// ---------- Wire up the buttons ----------
el.startBtn.addEventListener("click", () => {
  if (!state.running && state.phase === "ready") start();
  else if (!state.running && (state.phase === "work" || state.phase === "rest")) resume();
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
