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
  exitBtn: document.getElementById("exitBtn"),
  stats: document.getElementById("stats"),
  comboName: document.getElementById("comboName"),
  app: document.querySelector(".app"),
  dialFill: document.getElementById("dialFill"),
  installNudge: document.getElementById("installNudge"),
  installBtn: document.getElementById("installBtn"),
  installSub: document.getElementById("installSub"),
  installDismiss: document.getElementById("installDismiss"),
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

const state = { running: false, phase: "ready", currentRound: 0, secondsLeft: 0, phaseEndsAt: 0, tickTimer: null, comboTimer: null, comboFallback: null, clipWatchdog: null, wordGapTimer: null, finaleTimer: null, settleTimer: null };

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
//
// EVERY synthesized sound goes through withAudio(). Nothing may call
// ctx.createOscillator() directly, because an AudioContext does not stay
// running by itself: the OS suspends it whenever the phone locks, a call
// arrives, another app takes audio focus, or the tab is backgrounded. It used
// to be resumed in exactly one place — inside start() — so after any of those
// interruptions the ticks, bells and warnings were silent for the REST OF THE
// SESSION with nothing to bring them back.
//
// The second half of that bug: resume() is asynchronous. start() called it and
// then immediately played the first countdown tick, which got scheduled against
// a context that was still suspended, so the tick was simply lost. That is why
// the countdown sometimes "never started firing".
let audioCtx = null;
function getAudioCtx() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = audioCtx || new Ctor();
    return audioCtx;
  } catch (e) { return null; }
}

// Nudge the context back to running. Safe to call as often as you like — from a
// tap, on visibilitychange, before any sound. Never throws.
function armAudio() {
  const ctx = getAudioCtx();
  if (!ctx || ctx.state === "running") return ctx;
  try {
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
  return ctx;
}

// Play something through the audio context, guaranteeing it is running first.
// If the context is suspended we resume and play when it actually starts, so a
// sound arrives a few milliseconds late instead of never arriving at all.
function withAudio(play) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const go = () => { try { play(ctx); } catch (e) {} };
  if (ctx.state === "running") { go(); return; }
  try {
    const p = ctx.resume();
    if (p && p.then) p.then(go, go); // play even if resume() reports failure
    else go();
  } catch (e) { go(); }
}

// Re-arm on every plausible "the user is back" signal. A suspended context can
// only be resumed from a user gesture on some browsers, so any tap anywhere
// counts — this is why it listens on the document in the capture phase rather
// than on the buttons.
//
// Backgrounding also gets an explicit clean CUT of the callout chain. Left
// half-alive, it decayed into both reported symptoms: iOS pauses the playing
// clip (its "ended" never fires) and throttles our timers, so returning
// released a burst of stale watchdogs and word-gap timers at once — words
// tumbling over each other ("the sound glitches") — or the chain simply never
// recovered ("stops playing entirely") until the 20s revive noticed. Stopping
// on hidden and restarting on visible means the return is always a fresh,
// ordinary combo call. This listener registers AFTER the wake-lock one above,
// which runs tick() first — so by the time we decide whether to restart, the
// phase has already been caught up to real time.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    needsReprime = true; // iOS may revoke the media unlock while we're away
    if (state.running && state.phase === "work") stopComboLoop();
    return;
  }
  armAudio();
  if (state.running && state.phase === "work" && !state.comboTimer) startComboLoop();
});
document.addEventListener("pointerdown", () => { armAudio(); deepPrime(); }, { capture: true, passive: true });
document.addEventListener("touchstart", armAudio, { capture: true, passive: true });

// ---------- Sound effects: real samples first, synthesis as fallback ----------
// The bell, tick and warning are all shipped as real audio files
// (audio/sfx/*.mp3, rendered from the exact synthesis below) and played
// through the same primed-HTMLAudioElement pipeline as the voice clips. This
// is not a cosmetic choice: on iPhone, Web Audio output is MUTED by the
// ring/silent switch while media elements are not — so with the switch on
// silent (most phones, most of the time) the voice clips played and every
// synthesized bell and tick was dead silence. The synthesis stays as the
// fallback so a missing or unloadable file still makes a sound.
// Samples default ON — the files are committed to the repo — and a sample only
// turns off on an actual load error. This mirrors the voice clips, and for the
// same hard-won reason (see the note above `voice` below): mobile Safari
// frequently never fires canplaythrough/loadeddata for preloaded audio, so an
// off-until-proven flag stays off forever on exactly the phones that need the
// sample most. That mistake shipped once here: the flags defaulted to false,
// iOS never delivered the "proof", every bell fell back to the synth, and the
// synth is muted by the silent switch — "bells still don't work" while the
// voice played fine. Off-until-proven was only right in the era when
// audio/sfx/ had no files at all.
const SFX_DIR = "audio/sfx/";
// tick/blip/land are WAV, not MP3: LAME padding puts ~50ms of silence at the
// front of an MP3, and at a 0.7x pitch bend that stretches longer — every blip
// landed audibly late ("the blips lag"). PCM has zero decoder delay and
// sample-exact seeks. The long sounds stay MP3; 50ms on a bell is invisible.
const SFX_FILES = { bell: "bell.mp3", tick: "tick.wav", warning: "warning.mp3", blip: "blip.wav", land: "land.wav" };
const SFX_KEYS = Object.keys(SFX_FILES);
const sfxCache = {};
const sfx = { bell: true, tick: true, warning: true, blip: true, land: true };
function preloadSfx() {
  SFX_KEYS.forEach((key) => {
    const a = new Audio(SFX_DIR + SFX_FILES[key]);
    a.preload = "auto";
    sfxCache[key] = a;
    a.addEventListener("error", () => { sfx[key] = false; }, { once: true });
  });
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
  withAudio((ctx) => {
    for (let i = 0; i < times; i++) bellStrike(ctx, ctx.currentTime + i * 0.65);
  });
}

// Play one sfx sample, or run its synth fallback. A play() rejection runs the
// fallback for THIS sound but doesn't disable the sample — a one-off rejection
// (momentary focus loss) shouldn't cost the whole session its real bell.
function playSfx(key, fallback, rate = 1) {
  if (!sfx[key]) { fallback(); return; }
  const node = getPooledSfx(key);
  if (!node) { fallback(); return; }
  try { node.currentTime = 0; } catch (e) {}
  // playbackRate with preservesPitch off is a pitch bend — one blip file
  // becomes the whole rising scale of the count-up.
  try {
    node.preservesPitch = false;
    node.webkitPreservesPitch = false;
    node.playbackRate = rate;
  } catch (e) {}
  const p = node.play();
  if (p && p.catch) p.catch(fallback);
}

// Ring the bell `times` in a row (1 = round start, 3 = session over).
function ringBell(times = 1) {
  const gap = 650; // ms between successive strikes — a natural "ding-ding" rhythm
  for (let i = 0; i < times; i++) {
    setTimeout(() => playSfx("bell", () => synthBell(1)), i * gap);
  }
}

// Short dry tick for the pre-round "3, 2, 1" countdown — deliberately NOT
// bell-like, so it can never be mistaken for "go."
function synthTick() {
  withAudio((ctx) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "square"; osc.frequency.setValueAtTime(1500, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.07);
  });
}
function playTick() { playSfx("tick", synthTick); }

// Two-beep "10 seconds left" cue — distinct from both the tick and the bell.
function synthWarning() {
  withAudio((ctx) => {
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
  });
}
function playWarning() { playSfx("warning", synthWarning); }

// Count-up sounds: rising blips while the punch total climbs, and a landing
// hit when it arrives.
function synthBlip(rate) {
  withAudio((ctx) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(1000 * rate, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.06);
  });
}
// Blips prefer Web Audio: HTMLAudio scheduling jitters 10-40ms per play,
// which at the count-up's 68ms cadence is audible as stutter no file format
// fixes. A decoded buffer starts sample-accurately. Deliberate trade, unlike
// every other sound: Web Audio is muted by the iPhone silent switch, and for
// a decorative count embellishment that's fine — the count still steps
// visually, and the landing hit stays on the media pipeline. Falls back to
// the media element wherever the buffer isn't ready.
let blipBuffer = null;
let blipBufferLoading = false;
function loadBlipBuffer() {
  if (blipBuffer || blipBufferLoading) return;
  const ctx = getAudioCtx();
  if (!ctx || typeof fetch !== "function" || !ctx.decodeAudioData) return;
  blipBufferLoading = true;
  fetch(SFX_DIR + SFX_FILES.blip)
    .then((r) => r.arrayBuffer())
    .then((b) => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
    .then((buf) => { blipBuffer = buf; })
    .catch(() => {})
    .finally(() => { blipBufferLoading = false; });
}
function playBlip(progress) {
  const rate = 0.7 + progress * 1.1; // ~0.7x → 1.8x: a clear low-to-high climb
  if (blipBuffer && audioCtx && audioCtx.state === "running") {
    try {
      const src = audioCtx.createBufferSource();
      src.buffer = blipBuffer;
      src.playbackRate.value = rate;
      const g = audioCtx.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(audioCtx.destination);
      src.start();
      return;
    } catch (e) { /* fall through to the media path */ }
  }
  playSfx("blip", () => synthBlip(rate), rate);
}
function synthLand() {
  withAudio((ctx) => {
    const t = ctx.currentTime;
    const thump = ctx.createOscillator(), tg = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(180, t);
    thump.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.7, t + 0.006);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    thump.connect(tg).connect(ctx.destination);
    thump.start(t); thump.stop(t + 0.4);
    const ping = ctx.createOscillator(), pg = ctx.createGain();
    ping.type = "sine"; ping.frequency.setValueAtTime(1568, t + 0.02);
    pg.gain.setValueAtTime(0.0001, t + 0.02);
    pg.gain.exponentialRampToValueAtTime(0.3, t + 0.025);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    ping.connect(pg).connect(ctx.destination);
    ping.start(t + 0.02); ping.stop(t + 0.5);
  });
}
function playLand() { playSfx("land", synthLand); }

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

// Clips that failed to load. ONE bad file used to switch the whole app to
// robotic text-to-speech for the rest of the session — a single flaky request
// for, say, audio/7.mp3 cost you all twelve voices. Now a failure is recorded
// per word: that word alone falls back (see playWord), and clips are only
// abandoned wholesale when enough have failed that the set is clearly not
// there at all, which is the case this fallback actually exists for.
const failedClips = new Set();
const CLIPS_GIVE_UP_AT = 4;
function preloadClips() {
  CLIP_KEYS.forEach((key) => {
    const a = new Audio(CLIP_DIR + key + CLIP_EXT);
    a.preload = "auto";
    clipCache[key] = a;
    a.addEventListener("error", () => {
      failedClips.add(key);
      if (failedClips.size >= CLIPS_GIVE_UP_AT) voice.useClips = false;
    }, { once: true });
    // A file that later loads fine clears its own black mark, so one bad
    // moment on a phone's connection isn't permanent.
    a.addEventListener("canplaythrough", () => failedClips.delete(key), { once: true });
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
// The bell is the exception: the session-end "ding-ding-ding" is three strikes
// 650ms apart on a sample that rings for ~2.5s, so three are genuinely sounding
// at once. With two elements the third strike stole the first one's element and
// cut its ring dead.
// blip gets 3: the count-up fires them ~60ms apart while each rings ~70ms.
const SFX_POOL_SIZE = { bell: 3, tick: 2, warning: 2, blip: 3, land: 1 };
const clipPool = {};
const sfxPool = {};
const poolIndex = {};
let audioUnlocked = false;
// Set when the app is backgrounded: the only event after which iOS may have
// revoked the element unlock. Anything else makes re-priming pure waste.
let needsReprime = false;

function primeElement(a) {
  if (!a || a.paused === false) return; // never pause something mid-sound
  a.muted = true;
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
  a.pause();
  // Park at 0 — but only when displaced. An element left mid-word (a paused
  // round, a cut) MUST be rewound: currentTime assignment is an async seek on
  // iOS, and seeking lazily at play time raced playback — the start of the
  // word from the old position, an audible jump, the word again: "t-two".
  // Rewinding here (and at every pause site) lets seeks land during idle
  // time. Skipping already-parked elements keeps the tap cheap.
  try { if (a.currentTime > 0.05) a.currentTime = 0; } catch (e) {}
  a.muted = false;
}

// Anti-lag priming. Playing ~35 muted elements synchronously inside the Start
// tap froze the screen for a beat — and the timer's real-time catch-up then
// FAST-FORWARDED the countdown to make up the lost time. So priming is now
// tiered:
//   - the tap that needs it primes ONE element per sound (enough to unlock
//     the pipeline on iOS — 17 quick plays, half the old burst),
//   - the spare pool slots are topped up on the NEXT tap anywhere (any tap is
//     a gesture; the capture-phase listener below picks it up), and until
//     then a blocked spare is absorbed by the playback layer's retry, which
//     round-robins back onto the primed element.
//   - starts that need nothing (already unlocked, never backgrounded) are a
//     free no-op, and backgrounding only costs the 17-play repair once.
let deepPrimePending = false;
function eachPool(fn) {
  CLIP_KEYS.forEach((key) => {
    const pool = clipPool[key] && clipPool[key].length
      ? clipPool[key]
      : (clipCache[key] ? [clipCache[key]] : []);
    while (pool.length < UNLOCK_POOL_SIZE) pool.push(new Audio(CLIP_DIR + key + CLIP_EXT));
    clipPool[key] = pool;
    fn(pool);
  });
  SFX_KEYS.forEach((key) => {
    if (!sfx[key]) return;
    const pool = sfxPool[key] && sfxPool[key].length
      ? sfxPool[key]
      : (sfxCache[key] ? [sfxCache[key]] : []);
    while (pool.length < SFX_POOL_SIZE[key]) pool.push(new Audio(SFX_DIR + SFX_FILES[key]));
    sfxPool[key] = pool;
    fn(pool);
  });
}
function unlockAudioForMobile() {
  if (audioUnlocked && !needsReprime) return;
  try {
    eachPool((pool) => primeElement(pool[0]));
    deepPrimePending = true;
    audioUnlocked = true;
    needsReprime = false;
    setTimeout(loadBlipBuffer, 300); // off the tap; ready long before any finale
  } catch (e) { /* retry on the next tap */ }
}
// Top up the spare slots inside a later gesture, spreading the cost away from
// the Start tap. One shot per pending request.
function deepPrime() {
  if (!deepPrimePending) return;
  deepPrimePending = false;
  try {
    eachPool((pool) => { for (let i = 1; i < pool.length; i++) primeElement(pool[i]); });
  } catch (e) { deepPrimePending = true; }
}

// Round-robin a primed element for `key`, falling back to a plain clone if
// the pool isn't ready yet (e.g. voice toggled on before Start was tapped).
function getPooledClip(key) {
  // A word whose file is known bad has a pool like any other — the elements
  // exist, they just have nothing to play. Returning null here is what routes
  // it to the spoken fallback instead of burning a retry on silence.
  if (failedClips.has(key)) return null;
  const pool = clipPool[key];
  if (!pool || !pool.length) {
    const src = clipCache[key];
    return src ? src.cloneNode() : null;
  }
  const i = (poolIndex[key] || 0) % pool.length;
  poolIndex[key] = i + 1;
  return pool[i];
}
function getPooledSfx(key) {
  const pool = sfxPool[key];
  if (!pool || !pool.length) return sfxCache[key] ? sfxCache[key].cloneNode() : null;
  const i = (poolIndex["__sfx_" + key] || 0) % pool.length;
  poolIndex["__sfx_" + key] = i + 1;
  return pool[i];
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
// Every live playback chain carries a generation token. stopComboLoop bumps
// it, which instantly deadens EVERY pending callback of the old chain — gap
// timers, watchdogs, late "ended" events. Before this, the between-words
// setTimeout was anonymous and unowned: a chain cut landing inside a word gap
// (backgrounding, the visibility restart, a revive) left a zombie timer that
// revived the OLD combo next to the new one — two chains interleaving through
// the same pools, heard as the voice stuttering. The gap windows are 3-6x
// wider at Steady/Relaxed pace, which is why it showed there.
let voiceChain = 0;
function playClips(keys, onDone) {
  let i = 0;
  const chain = ++voiceChain;
  const chainAlive = () => chain === voiceChain;
  const playNext = () => {
    if (!chainAlive()) return; // a newer chain owns the pools now
    clearTimeout(state.clipWatchdog);
    voice.current = null;
    if (!state.running || state.phase !== "work" || i >= keys.length) { onDone(); return; }
    // Round's nearly over: starting one more word now means it gets cut by the
    // bell mid-syllable — the reported end-bell "glitch". Go quiet instead;
    // the bell's first strike lands in clean air.
    if (i > 0 && state.phaseEndsAt - Date.now() < 450) { onDone(); return; }
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
    // No element for this word — its file is missing or failed. Say it with
    // text-to-speech rather than leaving a silent hole where a punch should
    // be. The chain continues either way; a missing clip must never stop it.
    if (!node) { sayOneWord(key, playNext); return; }
    // Never let two clips sound at once. Without this a retry (or a late
    // event) could start the next word on top of one still playing, which is
    // heard as words cutting each other off and the cadence going ragged.
    if (voice.current && voice.current !== node) {
      try { voice.current.pause(); voice.current.currentTime = 0; } catch (e) {}
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
      if (moved || !chainAlive()) return; // ended/error/watchdog — first one wins, dead chains never
      moved = true;
      clearTimeout(state.clipWatchdog);
      fn();
    };
    const retryOr = (fallback) => {
      if (attempt < 1) { playWord(key, attempt + 1); return; }
      fallback();
    };
    const afterWord = () => {
      if (!chainAlive()) return;
      if (!state.running || state.phase !== "work") { onDone(); return; }
      // Owned by state so stopComboLoop can cancel it — an anonymous timer
      // here was the zombie that interleaved two chains.
      state.wordGapTimer = setTimeout(playNext, getWordGap());
    };
    const finished = once(() => {
      // Did it actually play, or just claim to? Deliberately a small ABSOLUTE
      // threshold rather than a fraction of the clip's length: the shortest
      // clip in audio/ is ~390ms, while a clip that never reached the speaker
      // reports back in a handful of milliseconds. Judging this as a fraction
      // of duration was too eager — it retried words that had played fine,
      // so they were spoken twice and the cadence went out.
      const elapsed = Date.now() - startedAt;
      if (elapsed < 120) { try { node.pause(); node.currentTime = 0; } catch (e) {} retryOr(afterWord); return; }
      afterWord();
    });
    const skip = once(() => { try { node.pause(); node.currentTime = 0; } catch (e) {} retryOr(playNext); });

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

// Speak a SINGLE move, used only when that word's clip is unavailable. Always
// calls back exactly once — on end, on error, or on a watchdog — because the
// combo chain is waiting on it and must never be left hanging.
function sayOneWord(key, done) {
  let finished = false;
  const finish = () => { if (finished) return; finished = true; done(); };
  const move = MOVES[key];
  if (!move || !window.speechSynthesis || !el.voiceOn.checked) { finish(); return; }
  try {
    const u = new SpeechSynthesisUtterance(move.say);
    if (chosenVoice) u.voice = chosenVoice;
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
    setTimeout(finish, 1600); // iOS drops onend often enough to need this
  } catch (e) { finish(); }
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
function countUp(node, to, { ms = 900, pop = false, haptics = false, sound = false, glow = null } = {}) {
  if (!motionOK() || to <= 0) { node.textContent = to.toLocaleString(); return; }
  // A precomputed SCHEDULE, not time-sampling. Sampling an easing curve per
  // frame meant a dropped frame skipped numbers ("the numbers skip a few
  // because of lag"). Here every shown value is decided up front — small
  // totals count every single number, big ones use uniform strides — and a
  // late frame fires the next step LATE rather than skipping it. At most one
  // step fires per frame, so a stall stretches the count instead of
  // machine-gunning the tail. Each step is one number + one blip, always.
  const MAX_STEPS = 18;
  const values = [];
  if (to <= MAX_STEPS) {
    for (let v = 1; v <= to; v++) values.push(v);
  } else {
    for (let i = 1; i <= MAX_STEPS; i++) values.push(Math.round((to * i) / MAX_STEPS));
  }
  values[values.length - 1] = to;
  // Step times follow the ease-in-out feel: solve eased(t)=i/n by bisection.
  const easedAt = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const timeFor = (frac) => {
    let lo = 0, hi = 1;
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      if (easedAt(mid) < frac) lo = mid; else hi = mid;
    }
    return ((lo + hi) / 2) * ms;
  };
  const times = values.map((_, i) => timeFor((i + 1) / values.length));
  const started = performance.now();
  let next = 0;
  let lastFire = 0;
  let lastBuzz = 0;
  const step = (now) => {
    if (next < values.length && now - started >= times[next] && now - lastFire >= 50) {
      const value = values[next];
      const frac = (next + 1) / values.length;
      next++;
      lastFire = now;
      node.textContent = value.toLocaleString();
      // The halo brightens with the climb. Its own layer, opacity only — the
      // GPU composites this; nothing about the glyphs repaints.
      if (glow) glow.style.opacity = String(0.85 * frac);
      if (haptics && frac > 0.55 && now - lastBuzz > 45) { buzz(7); lastBuzz = now; }
      if (sound && next < values.length) playBlip(frac); // the landing replaces the final blip
    }
    if (next < values.length) { requestAnimationFrame(step); return; }
    node.textContent = to.toLocaleString();
    if (glow) glow.style.opacity = "1"; // crest exactly at the landing
    if (pop) {
      node.classList.add("is-pop");
      node.addEventListener("animationend", () => {
        node.classList.remove("is-pop");
        // The arc completes: ramp with the climb, crest at the pop, then a
        // slow graceful fade — one opacity transition, compositor-composited.
        if (glow) {
          glow.style.transition = "opacity 1.4s ease-out";
          glow.style.opacity = "0";
        }
      }, { once: true });
    }
    if (sound) playLand(); // the satisfying arrival
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
  // Butter rules for the count-up, the app's single dopamine moment:
  //   1. Reserve the FINAL number's width now (tabular digits + min-width in
  //      ch), so no count step ever reflows the line — reflow per step was
  //      visible jank on a phone.
  //   2. Build this DOM exactly once. It used to be rebuilt at the reveal
  //      frame, competing with the glide transition for the same frames.
  //   3. During the finale, don't run the count here at all — startFinale
  //      calls __runCountUp AFTER the glide has landed, so the animation,
  //      the count and the blips each get the stage to themselves.
  // The halo is a SIBLING of the digits inside the hero span — countUp writes
  // textContent into the digits child, which would otherwise wipe the halo.
  const digits = make("span", "stat-digits", "0");
  const halo = make("span", "stat-halo");
  heroNum.textContent = "";
  heroNum.appendChild(halo);
  heroNum.appendChild(digits);
  heroNum.style.fontVariantNumeric = "tabular-nums";
  heroNum.style.display = "inline-block";
  heroNum.style.minWidth = String(session.punches.toLocaleString().length) + "ch";
  heroNum.style.textAlign = "center";
  const staged = el.stage.classList.contains("is-finale") && !el.stage.classList.contains("is-finale-reveal");
  el.stats.__runCountUp = () => countUp(digits, session.punches, { ms: 1200, pop: true, haptics: true, sound: true, glow: halo });
  if (!staged) el.stats.__runCountUp();

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
  setText(el.stats, bits.length ? bits.join(" · ") : "");
}

// Write-if-changed helpers. render() runs every second (and around phase
// changes); rewriting identical text nodes and attributes still costs style
// and layout work in the browser. Skipping no-op writes makes the steady
// state genuinely idle between ticks.
function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}
function setData(node, key, value) {
  if (node && node.dataset[key] !== value) node.dataset[key] = value;
}

function render() {
  // Full-screen for the WHOLE session experience — countdown, work, rest,
  // paused, and the finish screen. Pausing and restarting stay inside it;
  // the only door back to the settings screen is the exit button. (Earlier
  // versions dropped out on pause and on finishing; the founder wanted the
  // session to be one continuous fullscreen thing you explicitly leave.)
  if (el.app) {
    setData(el.app, "focus", state.phase !== "ready" ? "1" : "0");
    setData(el.app, "phase", state.phase); // lets CSS pick the right icon per state
  }
  setText(el.clock, state.phase === "countdown" ? String(state.secondsLeft) : format(state.secondsLeft));
  setData(el.stage, "phase", state.phase);
  setText(el.phase, state.phase === "work" ? "Work" : state.phase === "rest" ? "Rest" : state.phase === "done" ? "Done" : state.phase === "countdown" ? "Get Ready" : "Ready");
  setText(el.round, state.phase === "countdown" ? `Round 1 / ${getRounds()}` : `Round ${state.currentRound} / ${getRounds()}`);
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
  const total = state.phase === "work" ? getWork() : state.phase === "rest" ? getRest() : state.phase === "countdown" ? COUNTDOWN_SECONDS : 0;
  if (!(total > 0)) return 0;
  const stepped = state.phase === "countdown" || !state.running;
  const left = stepped ? state.secondsLeft / total : (state.phaseEndsAt - Date.now()) / 1000 / total;
  return Math.max(0, Math.min(1, left));
}
let dialArraySet = false;
function renderProgress() {
  if (!el.dialFill) return;
  if (!dialArraySet) { el.dialFill.style.strokeDasharray = String(DIAL_CIRCUMFERENCE); dialArraySet = true; }
  const offset = String(DIAL_CIRCUMFERENCE * (1 - phaseFractionLeft()));
  // Written every frame by dialLoop; skip the no-op frames (paused, ready).
  if (el.dialFill.style.strokeDashoffset !== offset) el.dialFill.style.strokeDashoffset = offset;
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
// The first combo never starts on top of the bell. Two reasons, two delays:
// calling the first word at the same instant as the bell attack collided two
// full-volume samples (heard as the bell "glitching"), and a round that starts
// shouting the moment the clock starts gives nobody time to get their hands
// up. A fresh ROUND gets a proper runway (bell → breathe → first call);
// resume and the return-from-background restart use a shorter beat, because
// the member was already mid-flow.
const FIRST_CALL_DELAY = 1600;
const RESUME_CALL_DELAY = 650;
function startComboLoop(delay = RESUME_CALL_DELAY) {
  state.lastComboAt = Date.now();
  state.comboTimer = setTimeout(nextCombo, delay);
}

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
  voiceChain++; // deadens every pending callback of the current chain
  clearTimeout(state.comboTimer);
  clearTimeout(state.comboFallback);
  clearTimeout(state.clipWatchdog);
  clearTimeout(state.wordGapTimer);
  state.comboTimer = null;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (voice.current) {
    try { voice.current.pause(); voice.current.currentTime = 0; } catch (e) {}
    voice.current = null;
  }
}

// ---------- Phase changes ----------
// Every phase records the wall-clock moment it should END, not just a countdown
// number. tick() then derives the remaining seconds from the real clock, so the
// timer stays honest even when the browser stops firing our interval on time.
function beginPhase(seconds) {
  state.secondsLeft = seconds;
  state.phaseEndsAt = Date.now() + seconds * 1000;
}
function enterWork() {
  state.phase = "work"; beginPhase(getWork()); state.warned10 = false;
  // The countdown's "Get ready..." must not survive into the round — the
  // first call is 1.6s away and the leftover text read as a hang. A no-break
  // space keeps the line box so the layout doesn't shift twice.
  el.combo.textContent = "\u00A0";
  if (el.comboName) el.comboName.textContent = "";
  ringBell(1); render(); startComboLoop(FIRST_CALL_DELAY);
}
function enterRest() { state.phase = "rest"; beginPhase(getRest()); stopComboLoop(); ringBell(2); el.combo.textContent = "Rest"; if (el.comboName) el.comboName.textContent = ""; window.speechSynthesis && window.speechSynthesis.cancel(); render(); }
// The headline when a session ends — one of these, never the same twice in a
// row. Coach's voice: short, earned, no exclamation points. All of them fit on
// one or two lines at display size (each is shorter than "Press start to
// begin", which already renders everywhere).
const FINISH_LINES = [
  "Nice work.",
  "Strong finish.",
  "That's a wrap.",
  "Well earned.",
  "Sharp today.",
  "In the bank.",
  "Round's yours.",
  "Solid rounds.",
  "Keep showing up.",
  "That's the way.",
];
let lastFinishLine = "";
function finishLine() {
  let pick;
  do {
    pick = FINISH_LINES[Math.floor(Math.random() * FINISH_LINES.length)];
  } while (pick === lastFinishLine);
  lastFinishLine = pick;
  return pick;
}

// ---------- The finish finale ----------
// Everything at once was overloading: bell + ripple + headline + count-up all
// landing together. So the finish is staged. Act 1: the dial alone, moved to
// the DEAD CENTRE of the screen, ripple blooming out of it while the end bell
// rings. Act 2: the dial glides back to its resting spot (up in portrait,
// left in landscape — the same glide because it's a measured transform, not a
// layout guess). Act 3: the headline and the counting numbers arrive.
// Skipped wholesale under reduced motion (and in jsdom): everything appears
// at once, which for those users is the point.
const FINALE_HOLD_MS = 1700;   // one ripple bloom before the glide
const FINALE_GLIDE_MS = 650;
function startFinale() {
  if (!motionOK() || !el.app || el.app.dataset.focus !== "1") { clearFinale(); return; }
  const meta = el.stage.querySelector(".stage__meta");
  if (!meta) { clearFinale(); return; }
  el.stage.classList.add("is-finale");
  // FLIP: the layout already holds the dial at its final resting place (the
  // stats are built, just invisible). Measure the gap to the screen centre and
  // transform there — exact in any orientation, no per-layout coordinates.
  const r = meta.getBoundingClientRect();
  const dx = window.innerWidth / 2 - (r.left + r.width / 2);
  const dy = window.innerHeight / 2 - (r.top + r.height / 2);
  meta.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
  state.finaleTimer = setTimeout(() => {
    meta.style.transition = `transform ${FINALE_GLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
    meta.style.transform = "";
    el.stage.classList.add("is-finale-reveal");
    // One thing at a time: let the glide finish, then start the count-up on
    // the ALREADY-BUILT summary. No DOM churn at the reveal frame, no count
    // steps fighting the transform transition for frames.
    state.finaleTimer = setTimeout(() => {
      meta.style.transition = "";
      if (el.stats.__runCountUp) el.stats.__runCountUp();
    }, FINALE_GLIDE_MS + 80);
  }, FINALE_HOLD_MS);
}
function clearFinale() {
  clearTimeout(state.finaleTimer);
  el.stage.classList.remove("is-finale", "is-finale-reveal");
  const meta = el.stage.querySelector(".stage__meta");
  if (meta) { meta.style.transform = ""; meta.style.transition = ""; }
}

function finish() {
  state.phase = "done"; state.running = false;
  // Three bell strikes: the traditional end of the fight. A composed victory
  // jingle was tried here (v1.9.1) and rejected by the founder — the boxing
  // bell IS the sound of finishing.
  stopComboLoop(); clearInterval(state.tickTimer); releaseWakeLock(); ringBell(3);
  // The streak lives in the summary below; repeating it here in display type
  // read as a bug rather than a flourish.
  el.combo.textContent = finishLine();
  el.combo.style.removeProperty("--fit");
  if (el.comboName) el.comboName.textContent = "";
  el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running");
  // The finale flag goes up BEFORE render: renderStats builds the summary
  // during render, and it must know it is building a hidden one.
  if (motionOK()) el.stage.classList.add("is-finale");
  render(); // builds the summary (hidden during the finale) so layout is final
  startFinale();
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

// The one-second heartbeat, phase-aligned. A plain setInterval started inside
// a busy Start tap inherits that frame's delay as a permanent phase offset —
// the first second visibly hung ("5 -- 4-3-2-1") and the catch-up rushed the
// rest. A one-shot scheduled against the real phase deadline fires the first
// tick on the actual second boundary, then hands over to the interval.
// clearInterval clears either kind of id, so every existing teardown works.
function alignedTicker() {
  const untilBoundary = Math.max(50, ((state.phaseEndsAt - Date.now()) % 1000) || 1000);
  return setTimeout(() => {
    tick();
    state.tickTimer = setInterval(tick, 1000);
  }, untilBoundary);
}

// ---------- Start / pause / reset ----------
const COUNTDOWN_SECONDS = 5;

// Entering browser fullscreen plays an OS transition (~300ms of resize and
// repaint) right as the countdown begins. If that lands after the settle
// beat, the first countdown second is visually eaten. Re-anchor the clock
// when the transition fires within the countdown's first moments: "5" holds
// through the animation, then ticks cleanly.
["fullscreenchange", "webkitfullscreenchange"].forEach((ev) =>
  document.addEventListener(ev, () => {
    if (!state.running || state.phase !== "countdown") return;
    const elapsed = COUNTDOWN_SECONDS * 1000 - (state.phaseEndsAt - Date.now());
    if (elapsed < 1200) { beginPhase(COUNTDOWN_SECONDS); render(); }
  }));

// Both entrances to a session end here. The countdown state paints on THIS
// frame; the clock starts one settle beat later, so any residual layout or
// device jank from the transition is absorbed inside an intentional pause
// instead of surfacing as "5 -- 4-3-2-1". The countdown itself is the loading
// screen — this just makes sure it starts on a clean frame. The pulse element
// is re-armed by force: a CSS animation only restarts on an attribute CHANGE,
// so this guarantees the five waves fire every time regardless of the
// attribute's history.
function armCountdownStart() {
  state.phase = "countdown"; beginPhase(COUNTDOWN_SECONDS);
  el.combo.textContent = "Get ready...";
  if (el.comboName) el.comboName.textContent = "";
  render();
  const pulse = el.stage.querySelector(".dial__pulse");
  if (pulse) {
    pulse.style.animation = "none";
    void pulse.offsetWidth; // reflow — the next animation start is guaranteed fresh
    pulse.style.removeProperty("animation");
  }
  clearTimeout(state.settleTimer);
  state.settleTimer = setTimeout(() => {
    beginPhase(COUNTDOWN_SECONDS); // re-anchor: the 5 seconds start NOW, post-settle
    playTick();
    render();
    state.tickTimer = alignedTicker();
  }, 140);
}

function start() {
  armAudio();
  unlockAudioForMobile(); // must run synchronously inside this tap — see note above clipPool
  enterFullscreen();
  state.running = true;
  acquireWakeLock();
  el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running");
  resetSessionTally();
  armCountdownStart();
}
function pause() { state.running = false; clearInterval(state.tickTimer); clearTimeout(state.settleTimer); stopComboLoop(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); el.startBtn.textContent = "Resume"; el.startBtn.classList.remove("is-running"); render(); }
// Resuming is a tap like any other, so it is also the moment to re-arm audio:
// whatever suspended the context while you were paused (a call, a lock screen,
// switching apps) is exactly the thing that used to leave the rest of the
// session silent. unlockAudioForMobile() repairs the clip pool too if the
// first attempt happened before the files had loaded.
function resume() { state.running = true; armAudio(); unlockAudioForMobile(); enterFullscreen(); el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running"); state.phaseEndsAt = Date.now() + state.secondsLeft * 1000; if (state.phase === "work") startComboLoop(); state.tickTimer = alignedTicker(); acquireWakeLock(); render(); }
function reset() { clearInterval(state.tickTimer); clearTimeout(state.settleTimer); stopComboLoop(); clearFinale(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); state.running = false; state.phase = "ready"; state.currentRound = 0; state.secondsLeft = 0; el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running"); el.combo.textContent = "Press start to begin"; if (el.comboName) el.comboName.textContent = ""; render(); }

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
// Mid-session (or on the finish screen) the restart icon means "run it back".
// Purpose-built: it must NOT pass through reset()'s ready state — that dropped
// focus mode for one frame, so the entire settings chrome unfolded and
// refolded (two full layouts with transitions) before the countdown even
// began. THAT was the "massive lag spike on restart". This never leaves the
// session screen: same fullscreen, same wake lock, fresh session.
function restartSession() {
  clearInterval(state.tickTimer);
  clearTimeout(state.settleTimer);
  stopComboLoop();
  clearFinale();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  armAudio();
  unlockAudioForMobile(); // free unless a background revoked the unlock
  enterFullscreen();
  resetSessionTally();
  delete el.stats.dataset.finished; // next finish must rebuild its summary
  state.running = true;
  state.currentRound = 0;
  el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running");
  armCountdownStart();
}
el.resetBtn.addEventListener("click", () => {
  if (state.phase === "ready") { reset(); return; }
  restartSession();
});
// The one door out of the fullscreen session — back to settings. Also releases
// browser fullscreen, which pause/restart deliberately hold on to.
function leaveFullscreenSession() {
  reset();
  try {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
      const p = exit.call(document);
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) {}
}
if (el.exitBtn) el.exitBtn.addEventListener("click", leaveFullscreenSession);
reset();

// Register the service worker so Combify works offline after the first visit.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ---------- Install nudge ----------
// Installing is the upgrade path, not the front door: the link keeps working
// for everyone forever, but installed Combify opens fullscreen with no browser
// chrome (the ONLY way to lose the bar on iPhone) and is the prerequisite for
// push later. Most people have never noticed "Add to Home Screen" exists, so
// the app offers it once — quietly, dismissible, never while installed.
const INSTALL_DISMISSED_KEY = "combify.installDismissed";
function isStandalone() {
  try {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || window.navigator.standalone === true; // old-iOS spelling
  } catch (e) { return false; }
}
function installDismissed() {
  try { return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1"; } catch (e) { return false; }
}
let deferredInstall = null;
function showInstallNudge(mode) {
  if (!el.installNudge || isStandalone() || installDismissed()) return;
  if (mode === "prompt") {
    el.installBtn.hidden = false;
    el.installSub.textContent = "Opens fullscreen like a real app, works offline.";
  } else {
    // iOS has no install prompt API; the honest path is telling people where
    // Apple hid it.
    el.installBtn.hidden = true;
    el.installSub.textContent = "Tap Share, then “Add to Home Screen”. Opens fullscreen, works offline.";
  }
  el.installNudge.hidden = false;
}
function hideInstallNudge() { if (el.installNudge) el.installNudge.hidden = true; }

// Chrome/Edge/Android fire this when the app qualifies for install. Stash the
// event; calling prompt() later must happen inside our button's tap.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  showInstallNudge("prompt");
});
if (el.installBtn) {
  el.installBtn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    const ev = deferredInstall;
    deferredInstall = null;
    try {
      ev.prompt();
      const choice = await ev.userChoice;
      if (choice && choice.outcome === "accepted") hideInstallNudge();
    } catch (e) {}
  });
}
if (el.installDismiss) {
  el.installDismiss.addEventListener("click", () => {
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, "1"); } catch (e) {}
    hideInstallNudge();
  });
}
window.addEventListener("appinstalled", () => { hideInstallNudge(); });
// iOS never fires beforeinstallprompt, so detect it directly. iPadOS 13+
// reports itself as "Macintosh" but has touch — hence the maxTouchPoints test.
(function iosInstallHint() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isIOS) showInstallNudge("hint");
})();
