// app.js — the brain of the trainer: settings controls, timer, bell, and voice.

import { randomCombo, comboToText, comboToSpeech } from "./combos.js";

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
  return { get value() { return seg.dataset.value; } };
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

  return { get value() { return get(); } };
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

// Read settings through the controls
const getLevel = () => levelCtl.value;
const getPace = () => +paceCtl.value;
const getRounds = () => roundsCtl.value;
const getWork = () => workCtl.value;
const getRest = () => restCtl.value;

const state = { running: false, phase: "ready", currentRound: 0, secondsLeft: 0, tickTimer: null, comboTimer: null, comboFallback: null };

// ---------- Shared audio context (bell + voice clips both use this) ----------
let audioCtx = null;
function getAudioCtx() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// ---------- Bell: a synthesized tone (no audio files needed) ----------
function bell(times = 1) {
  try {
    audioCtx = getAudioCtx();
    for (let i = 0; i < times; i++) {
      const t = audioCtx.currentTime + i * 0.28;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = "sine"; osc.frequency.setValueAtTime(880, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.26);
    }
  } catch (e) { /* audio unavailable — timer still works */ }
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
const voice = { useClips: false, current: null };

function preloadClips() {
  CLIP_KEYS.forEach((key) => {
    const a = new Audio(CLIP_DIR + key + CLIP_EXT);
    a.preload = "auto";
    clipCache[key] = a;
  });
  // If the first clip loads, assume the set is present and use clips.
  const probe = clipCache["1"];
  probe.addEventListener("canplaythrough", () => { voice.useClips = true; }, { once: true });
  probe.addEventListener("error", () => { voice.useClips = false; }, { once: true });
}
preloadClips();

// The "Combo pace" setting previously only controlled the gap AFTER a full
// combo finishes — it had no effect on how quickly the words WITHIN a combo
// were called, so a long advanced combo took just as long to speak at "Fast"
// as at "Relaxed." Derive a small inter-word gap from the same pace value so
// one setting now governs both: faster pace = quicker cadence AND shorter
// gap between combos.
const getWordGap = () => Math.max(40, Math.min(300, getPace() * 0.09));

// Play a combo's clips one after another, then call onDone().
function playClips(keys, onDone) {
  let i = 0;
  const playNext = () => {
    voice.current = null;
    if (!state.running || state.phase !== "work" || i >= keys.length) { onDone(); return; }
    const src = clipCache[keys[i++]];
    if (!src) { playNext(); return; }
    const node = src.cloneNode();
    voice.current = node;
    node.onended = () => {
      if (!state.running || state.phase !== "work") { onDone(); return; }
      setTimeout(playNext, getWordGap());
    };
    node.onerror = playNext;
    const p = node.play();
    if (p && p.catch) p.catch(() => playNext());
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
  el.clock.textContent = format(state.secondsLeft);
  el.stage.dataset.phase = state.phase;
  el.phase.textContent = state.phase === "work" ? "Work" : state.phase === "rest" ? "Rest" : state.phase === "done" ? "Done" : "Ready";
  el.round.textContent = `Round ${state.currentRound} / ${getRounds()}`;
}

// ---------- Combo calling (only during work) ----------
function nextCombo() {
  if (!state.running || state.phase !== "work") return;
  const combo = randomCombo(getLevel());
  el.combo.textContent = comboToText(combo);
  speakCombo(combo, () => {
    if (!state.running || state.phase !== "work") return;
    state.comboTimer = setTimeout(nextCombo, getPace()); // pace read fresh each time
  });
}
function startComboLoop() { nextCombo(); }
function stopComboLoop() {
  clearTimeout(state.comboTimer);
  clearTimeout(state.comboFallback);
  state.comboTimer = null;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (voice.current) { try { voice.current.pause(); } catch (e) {} voice.current = null; }
}

// ---------- Phase changes ----------
function enterWork() { state.phase = "work"; state.secondsLeft = getWork(); bell(1); render(); startComboLoop(); }
function enterRest() { state.phase = "rest"; state.secondsLeft = getRest(); bell(2); stopComboLoop(); el.combo.textContent = "Rest"; window.speechSynthesis && window.speechSynthesis.cancel(); render(); }
function finish() { state.phase = "done"; state.running = false; stopComboLoop(); clearInterval(state.tickTimer); bell(3); el.combo.textContent = "Session complete — nice work."; el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running"); render(); }

// ---------- The one-second heartbeat ----------
function tick() {
  state.secondsLeft -= 1;
  if (state.secondsLeft <= 0) {
    if (state.phase === "work") {
      if (state.currentRound >= getRounds()) { finish(); return; }
      enterRest();
    } else if (state.phase === "rest") { state.currentRound += 1; enterWork(); }
  }
  render();
}

// ---------- Start / pause / reset ----------
function start() {
  audioCtx = getAudioCtx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  state.running = true; state.currentRound = 1;
  el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running");
  enterWork(); state.tickTimer = setInterval(tick, 1000);
}
function pause() { state.running = false; clearInterval(state.tickTimer); stopComboLoop(); window.speechSynthesis && window.speechSynthesis.cancel(); el.startBtn.textContent = "Resume"; el.startBtn.classList.remove("is-running"); }
function resume() { state.running = true; el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running"); if (state.phase === "work") startComboLoop(); state.tickTimer = setInterval(tick, 1000); }
function reset() { clearInterval(state.tickTimer); stopComboLoop(); window.speechSynthesis && window.speechSynthesis.cancel(); state.running = false; state.phase = "ready"; state.currentRound = 0; state.secondsLeft = 0; el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running"); el.combo.textContent = "Press start to begin"; render(); }

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
