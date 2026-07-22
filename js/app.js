// app.js — the brain of the trainer: timer, bell, and combo calling.

import { randomCombo, comboToText, comboToSpeech } from "./combos.js";

// --- Grab the elements we need from the page ---
const el = {
  stage: document.getElementById("stage"),
  phase: document.getElementById("phase"),
  clock: document.getElementById("clock"),
  round: document.getElementById("round"),
  combo: document.getElementById("combo"),
  startBtn: document.getElementById("startBtn"),
  resetBtn: document.getElementById("resetBtn"),
  level: document.getElementById("level"),
  rounds: document.getElementById("rounds"),
  workSec: document.getElementById("workSec"),
  restSec: document.getElementById("restSec"),
  pace: document.getElementById("pace"),
  voiceOn: document.getElementById("voiceOn"),
};

// --- The workout's live state ---
const state = {
  running: false,
  phase: "ready",      // "ready" | "work" | "rest" | "done"
  currentRound: 0,
  secondsLeft: 0,
  tickTimer: null,     // counts the clock down every second
  comboTimer: null,    // schedules the next combo call
};

// ============ Sound: a synthesized bell (no audio files needed) ============
let audioCtx = null;
function bell(times = 1) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const t = audioCtx.currentTime + i * 0.28;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.26);
    }
  } catch (e) {
    /* audio not available — no problem, the timer still works */
  }
}

// ============ Voice: call the combo out loud ============
function say(text) {
  if (!el.voiceOn.checked) return;
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.pitch = 1;
  window.speechSynthesis.cancel(); // don't let calls pile up
  window.speechSynthesis.speak(u);
}

// ============ Helpers ============
function format(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function render() {
  el.clock.textContent = format(state.secondsLeft);
  el.stage.dataset.phase = state.phase;
  const total = Number(el.rounds.value);

  if (state.phase === "work") el.phase.textContent = "Work";
  else if (state.phase === "rest") el.phase.textContent = "Rest";
  else if (state.phase === "done") el.phase.textContent = "Done";
  else el.phase.textContent = "Ready";

  el.round.textContent = `Round ${state.currentRound} / ${total}`;
}

// ============ Combo calling loop (only runs during work) ============
function callCombo() {
  const combo = randomCombo(el.level.value);
  el.combo.textContent = comboToText(combo);
  say(comboToSpeech(combo));
}

function startComboLoop() {
  const paceMs = Number(el.pace.value);
  callCombo(); // call one right away
  state.comboTimer = setInterval(callCombo, paceMs);
}

function stopComboLoop() {
  clearInterval(state.comboTimer);
  state.comboTimer = null;
}

// ============ Phase changes ============
function enterWork() {
  state.phase = "work";
  state.secondsLeft = Number(el.workSec.value);
  bell(1);
  render();
  startComboLoop();
}

function enterRest() {
  state.phase = "rest";
  state.secondsLeft = Number(el.restSec.value);
  bell(2);
  stopComboLoop();
  el.combo.textContent = "Rest";
  window.speechSynthesis?.cancel();
  render();
}

function finish() {
  state.phase = "done";
  state.running = false;
  stopComboLoop();
  clearInterval(state.tickTimer);
  bell(3);
  el.combo.textContent = "Session complete — nice work.";
  el.startBtn.textContent = "Start";
  el.startBtn.classList.remove("is-running");
  render();
}

// ============ The one-second heartbeat ============
function tick() {
  state.secondsLeft -= 1;

  if (state.secondsLeft <= 0) {
    if (state.phase === "work") {
      // Was that the last round? If so we're done, otherwise rest.
      if (state.currentRound >= Number(el.rounds.value)) {
        finish();
        return;
      }
      enterRest();
    } else if (state.phase === "rest") {
      state.currentRound += 1;
      enterWork();
    }
  }
  render();
}

// ============ Start / pause / reset ============
function start() {
  // Some browsers need a user tap before audio/voice will play.
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();

  state.running = true;
  state.currentRound = 1;
  el.startBtn.textContent = "Pause";
  el.startBtn.classList.add("is-running");

  enterWork();
  state.tickTimer = setInterval(tick, 1000);
}

function pause() {
  state.running = false;
  clearInterval(state.tickTimer);
  stopComboLoop();
  window.speechSynthesis?.cancel();
  el.startBtn.textContent = "Resume";
  el.startBtn.classList.remove("is-running");
}

function resume() {
  state.running = true;
  el.startBtn.textContent = "Pause";
  el.startBtn.classList.add("is-running");
  if (state.phase === "work") startComboLoop();
  state.tickTimer = setInterval(tick, 1000);
}

function reset() {
  clearInterval(state.tickTimer);
  stopComboLoop();
  window.speechSynthesis?.cancel();
  state.running = false;
  state.phase = "ready";
  state.currentRound = 0;
  state.secondsLeft = 0;
  el.startBtn.textContent = "Start";
  el.startBtn.classList.remove("is-running");
  el.combo.textContent = "Press start to begin";
  render();
}

// ============ Wire up the buttons ============
el.startBtn.addEventListener("click", () => {
  if (!state.running && state.phase === "ready") start();
  else if (!state.running && (state.phase === "work" || state.phase === "rest")) resume();
  else if (!state.running && state.phase === "done") { reset(); start(); }
  else pause();
});

el.resetBtn.addEventListener("click", reset);

// Start on a clean slate
reset();

// Register the service worker so Combify works offline after the first visit.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline support is a bonus — ignore if it fails (e.g. on localhost file://) */
    });
  });
}
