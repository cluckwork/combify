// app.js — the brain of the trainer: settings controls, timer and phases.
// Everything that makes sound lives in js/audio.js.

import { randomCombo, comboName, MOVES } from "./combos.js";
import { VERSION, RELEASED } from "./version.js";
import { loadHistory, saveHistory, recordRound, currentStreak, trainedToday, formatDuration } from "./stats.js";
import {
  configureVoice, speakCombo, stopVoice,
  armAudio, unlockAudioForMobile, markNeedsReprime,
  ringBell, playTick, playWarning, playBlip, playLand, parkIdleSfx,
  startAudioSession, stopAudioSession, scheduleBlipRiff, stopBlipRiff,
} from "./audio.js";
import { audit, auditOn, setAudit, auditDump, auditPersist, auditReport } from "./audit.js";

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
      work: workCtl.value, rest: restCtl.value,
    }));
  } catch (e) { /* storage unavailable — settings just won't persist */ }
  // The ready screen shows the session's total time, computed from these very
  // settings — changing rounds/work/rest must update it live.
  if (state.phase === "ready") render();
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
  resetBtn: document.getElementById("resetBtn"),
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
  settingsReady = true;
})();
// The voice on/off switch is gone (v1.12.0): nobody trains with a silent
// caller on purpose, and the volume rocker already covers "quieter". An old
// stored `voice: false` is simply ignored by the restore above.

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

// ---------- Problem reports ----------
// The one member-facing piece of the flight recorder: "Report a problem" in
// the footer. A sentence from the member + the log of their last session
// travels via the phone's share sheet (Messages/Mail — no server, no
// accounts), and the developer pastes it into the debugging loop. Kept
// deliberately minimal: no forms, no screenshots, one native prompt.
const REPORT_TO = "jduterme77@gmail.com";
(function wireReport() {
  const foot = document.querySelector(".foot");
  if (!foot) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "foot__link";
  btn.textContent = "Report a problem";
  btn.addEventListener("click", async () => {
    let desc = null;
    try { desc = window.prompt("What went wrong? A sentence or two helps a lot:"); } catch (e) {}
    if (!desc) return; // cancelled or empty — no report
    const text = auditReport(String(desc).slice(0, 500),
      `Combify v${VERSION} — sent to ${REPORT_TO}\nUA: ${navigator.userAgent || "?"}`);
    if (navigator.share) {
      try { await navigator.share({ title: "Combify problem report", text }); audit("report", "shared"); return; }
      catch (e) { /* share cancelled or blocked — fall through to copy */ }
    }
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch (e) {}
    try { window.prompt(`Send this to ${REPORT_TO}${copied ? " — it's copied for you" : " — copy it from here"}:`, text); } catch (e) {}
    audit("report", "manual");
  });
  foot.appendChild(btn);
})();

// ---------- Audit mode (the on-device flight recorder, js/audit.js) ----------
// The test harness can't see what a real iPhone does to the audio pipeline,
// so the phone records its own story: five taps on the version number arm
// the recorder, a session is run normally, and "Copy audit log" puts the
// timestamped event log on the clipboard to paste back to the developer.
(function wireAudit() {
  const verSlot = document.getElementById("appVersion");
  const foot = document.querySelector(".foot");
  if (!verSlot || !foot) return;
  let copyBtn = null;
  function syncUI() {
    if (auditOn() && !copyBtn) {
      copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "foot__link foot__audit";
      copyBtn.textContent = "Copy audit log";
      copyBtn.addEventListener("click", async () => {
        const text = auditDump(`Combify v${VERSION} audit\nUA: ${navigator.userAgent || "?"}`);
        let ok = false;
        try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {}
        // No clipboard permission (or no clipboard API): a prompt still lets
        // the text be selected and copied by hand.
        if (!ok) { try { window.prompt("Copy the log:", text); ok = true; } catch (e) {} }
        copyBtn.textContent = ok ? "Copied ✓" : "Copy failed";
        setTimeout(() => { if (copyBtn) copyBtn.textContent = "Copy audit log"; }, 1600);
      });
      foot.appendChild(copyBtn);
    }
    if (!auditOn() && copyBtn) { copyBtn.remove(); copyBtn = null; }
  }
  let taps = 0, tapTimer = null;
  verSlot.parentElement.addEventListener("click", () => {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 1800);
    if (taps < 5) return;
    taps = 0;
    setAudit(!auditOn());
    audit("audit", `armed v${VERSION}`);
    syncUI();
    // A visible receipt — five taps that change nothing read as a dead spot.
    const was = verSlot.textContent;
    verSlot.textContent = auditOn() ? "audit on" : "audit off";
    setTimeout(() => { verSlot.textContent = was; }, 1200);
  });
  syncUI();
})();

// Read settings through the controls
const getLevel = () => levelCtl.value;
const getPace = () => +paceCtl.value;
const getRounds = () => roundsCtl.value;
const getWork = () => workCtl.value;
const getRest = () => restCtl.value;

const state = { running: false, phase: "ready", currentRound: 0, secondsLeft: 0, phaseEndsAt: 0, tickTimer: null, comboTimer: null, finaleTimer: null, settleTimer: null, entranceTimer: null };

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

// ---------- Audio wiring ----------
// All sound lives in js/audio.js. The voice chain needs four live facts from
// the timer to stay honest — whether the round still runs, how close the bell
// is, the pace-derived word gap, and which move to highlight as it's spoken.
configureVoice({
  stillInWork: () => state.running && state.phase === "work",
  msLeftInPhase: () => state.phaseEndsAt - Date.now(),
  wordGap: () => getWordGap(),
  onWord: (i) => highlightMove(i),
});

// Backgrounding gets an explicit clean CUT of the callout chain. Left
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
  audit("visibility", document.visibilityState);
  if (document.visibilityState === "hidden") {
    markNeedsReprime(); // iOS may revoke the media unlock while we're away
    if (state.running && state.phase === "work") stopComboLoop();
    return;
  }
  armAudio();
  if (state.running) startAudioSession(); // best-effort; a rejection just means no keeper until the next tap
  if (state.running && state.phase === "work" && !state.comboTimer) startComboLoop();
});

// The "Combo pace" setting previously only controlled the gap AFTER a full
// combo finishes — it had no effect on how quickly the words WITHIN a combo
// were called, so a long advanced combo took just as long to speak at "Fast"
// as at "Relaxed." Derive a small inter-word gap from the same pace value so
// one setting now governs both: faster pace = quicker cadence AND shorter
// gap between combos.
const getWordGap = () => Math.max(40, Math.min(300, getPace() * 0.09));

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
  // The riff is best scheduled in ONE shot on the audio clock, where no
  // main-thread stall can touch it (the second real-phone log showed even
  // timers lurching 230ms during the finale). When Web Audio isn't
  // available the per-step playBlip below covers it.
  const riffOn = sound && scheduleBlipRiff(
    times.slice(0, -1),
    values.map((_, i) => 0.7 + ((i + 1) / values.length) * 1.1).slice(0, -1));
  // Chained one-shot timers, not requestAnimationFrame. rAF ties every step
  // to the compositor, and the first real-phone audit log showed exactly
  // what that costs: dropped frames mid-finale turned the blip scale's
  // steady 50ms floor into 50-50-110-139ms lurches — founder: "the blips
  // were 100% glitching at the end". A foreground timer jitters a few ms,
  // not a frame. The chain keeps the rAF loop's stall behavior: at most one
  // step pending, each scheduled from real elapsed time, so a slow patch
  // stretches the count instead of machine-gunning the tail, and 50ms stays
  // the floor between audible steps.
  const started = Date.now();
  let next = 0;
  let lastBuzz = 0;
  const step = () => {
    const value = values[next];
    const frac = (next + 1) / values.length;
    next++;
    node.textContent = value.toLocaleString();
    // The halo brightens with the climb. Its own layer, opacity only — the
    // GPU composites this; nothing about the glyphs repaints.
    if (glow) glow.style.opacity = String(0.85 * frac);
    const now = Date.now();
    if (haptics && frac > 0.55 && now - lastBuzz > 45) { buzz(7); lastBuzz = now; }
    if (sound && !riffOn && next < values.length) playBlip(frac); // the landing replaces the final blip
    // Park the blips that just finished, from our own call stack, so every
    // step ahead starts at zero — see the note above parkIdleSfx.
    if (sound && !riffOn) parkIdleSfx();
    if (next < values.length) {
      setTimeout(step, Math.max(50, times[next] - (Date.now() - started)));
      return;
    }
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
  setTimeout(step, Math.max(0, times[0]));
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

// What the whole session will take with the current settings: every work
// round, plus the rests BETWEEN them (no rest follows the last round — the
// session ends on the bell). Shown on the ready screen, where "how long will
// this take?" is the question actually being asked; 00:00 answered nothing.
function totalSessionSeconds() {
  return getRounds() * getWork() + Math.max(0, getRounds() - 1) * getRest();
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
  setText(el.clock, state.phase === "countdown" ? String(state.secondsLeft)
    : state.phase === "ready" ? format(totalSessionSeconds())
    : format(state.secondsLeft));
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
  // Never LAUNCH a combo the bell is about to cut. The between-words guard
  // in playClips (450ms) protects every word after the first — but a whole
  // fresh combo could still start into the bell: the first real-phone audit
  // log caught one launching 120ms before the round-2 bell, its first word
  // chopped mid-syllable. Founder's spec: stop a little earlier, "not too
  // much time, but enough so no overlapping is possible" — so, room for the
  // longest first word (~870ms) plus the same bell clearance. Otherwise go
  // quiet and let the bell land in clean air.
  if (state.phaseEndsAt - Date.now() < 1300) {
    audit("combo:held", `bell in ${Math.round(state.phaseEndsAt - Date.now())}ms`);
    return;
  }
  state.lastComboAt = Date.now(); // heartbeat, watched by tick() — see reviveComboLoop
  const combo = randomCombo(getLevel());
  audit("combo", combo.join("-"));
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
  // Generous: a long advanced combo at Relaxed pace can legitimately run ~12s.
  const stalledFor = Date.now() - (state.lastComboAt || 0);
  if (stalledFor < getPace() + 20000) return;
  audit("revive", `stalled ${stalledFor}ms`);
  stopComboLoop();
  startComboLoop();
}
function stopComboLoop() {
  stopVoice(); // cuts the clip chain dead — see audio.js
  clearTimeout(state.comboTimer);
  state.comboTimer = null;
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
  audit("phase", `work r${state.currentRound}`);
  // The countdown's "Get ready..." must not survive into the round — the
  // first call is 1.6s away and the leftover text read as a hang. A no-break
  // space keeps the line box so the layout doesn't shift twice.
  el.combo.textContent = "\u00A0";
  if (el.comboName) el.comboName.textContent = "";
  ringBell(1); render(); startComboLoop(FIRST_CALL_DELAY);
}
function enterRest() { state.phase = "rest"; beginPhase(getRest()); state.warnedRest = false; audit("phase", "rest"); stopComboLoop(); ringBell(2); el.combo.textContent = "Rest"; if (el.comboName) el.comboName.textContent = ""; window.speechSynthesis && window.speechSynthesis.cancel(); render(); }
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
  stopBlipRiff(); // a restart mid-riff must not leave scheduled blips ringing into the countdown
  clearTimeout(state.finaleTimer);
  el.stage.classList.remove("is-finale", "is-finale-reveal");
  const meta = el.stage.querySelector(".stage__meta");
  if (meta) { meta.style.transform = ""; meta.style.transition = ""; }
}

function finish() {
  state.phase = "done"; state.running = false;
  audit("phase", "done");
  auditPersist(); // the session's story survives a reload for problem reports
  parkIdleSfx(); // blips and the landing hit start the finale parked at zero
  // Hand the audio session back (to Spotify etc.) once the celebration is
  // over. Guarded: a restart re-arms the keeper and must not lose it.
  setTimeout(() => { if (state.phase === "done" && !state.running) stopAudioSession(); }, 8000);
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
    if (remaining > 0) { if (changed) playTick(); parkIdleSfx(); render(); return; }
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
  // Rest used to end with zero notice — the bell just rang and the round was
  // already moving while your hands were still down. Same 10s heads-up as a
  // work round, then the last 3 seconds reuse the COUNTDOWN tick, not the
  // work-end clapper: the tick already means "get ready, round about to
  // start" from the pre-round 5-4-3-2-1, so the end of rest sounds exactly
  // like the run-in to round 1. Each sound keeps one meaning.
  if (state.phase === "rest" && stepped) {
    if (!state.warnedRest && remaining === 10 && getRest() > 10) {
      playWarning();
      state.warnedRest = true;
    }
    if (remaining >= 1 && remaining <= 3) playTick();
  }
  reviveComboLoop();
  parkIdleSfx(); // once a second, any sfx that finished goes back to zero
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

// Force-restart the pulse waves: a CSS animation only restarts on an
// attribute CHANGE, so this guarantees the five waves fire every time
// regardless of the attribute's history.
function armPulse() {
  const pulse = el.stage.querySelector(".dial__pulse");
  if (!pulse) return;
  pulse.style.animation = "none";
  void pulse.offsetWidth; // reflow — the next animation start is guaranteed fresh
  pulse.style.removeProperty("animation");
}

// ---------- The entrance crossfade ----------
// The ready screen and the fullscreen countdown are two genuinely different
// layouts: page padding, stage size, type scale, chrome. Morphing between
// them animated SOME of that (the chrome fold) while the rest snapped on the
// tap's frame — seen as the countdown "appearing 3/4 of the way down, then
// smoothly moving" (v1.13.1 feedback). A layout this different isn't
// morphable, so don't morph it: fade the settings screen out, swap the whole
// layout while the screen is dark (everything snaps, invisibly — the
// .is-entering CSS suspends the fold transition for exactly this reason),
// then fade the countdown screen in. Seamless by construction, on every
// device and orientation, because nothing that moves is ever visible.
// (v1.13.0 tried a centre-stage countdown here — pulled on feedback; v1.13.1
// tried hold-in-place over a slowed fold — the unanimated properties still
// snapped. This is attempt three, and the mechanism is finally shaped like
// the problem.)
const ENTRANCE_FADE_MS = 160;    // settings screen fades out
const ENTRANCE_SETTLE_MS = 600;  // covers the fade-in (0.3s CSS) before the clock starts
function beginEntrance() {
  if (!motionOK() || !el.app) { armCountdownStart(); return; }
  el.app.classList.add("is-entering");
  clearTimeout(state.entranceTimer);
  state.entranceTimer = setTimeout(() => {
    armCountdownStart(); // swaps to the countdown layout while the screen is dark
    state.entranceTimer = setTimeout(() => el.app.classList.remove("is-entering"), 40);
  }, ENTRANCE_FADE_MS);
}
// A pause or exit inside the entrance window must never strand the app
// invisible — the fade class and its timer go down with the session.
function clearEntrance() {
  clearTimeout(state.entranceTimer);
  if (el.app) el.app.classList.remove("is-entering");
}

// Both entrances to a session end here — start() via the crossfade above,
// restart directly (its layout doesn't change, so there's nothing to hide).
// The countdown paints, then the clock HOLDS until the entrance has settled,
// so start jank is spent inside intentional choreography instead of
// surfacing as "5 -- 4-3-2-1" or a swallowed "5". The pulse is held with it,
// so wave 1 lands on tick 1.
function armCountdownStart() {
  state.phase = "countdown"; beginPhase(COUNTDOWN_SECONDS);
  audit("phase", "countdown");
  parkIdleSfx(); // the settle tick must start from zero, not a leftover end position
  el.combo.textContent = "Get ready...";
  if (el.comboName) el.comboName.textContent = "";
  render();
  const pulse = el.stage.querySelector(".dial__pulse");
  if (pulse) pulse.style.animation = "none";
  clearTimeout(state.settleTimer);
  state.settleTimer = setTimeout(() => {
    armPulse();
    beginPhase(COUNTDOWN_SECONDS); // re-anchor: the 5 seconds start NOW, post-entrance
    playTick();
    render();
    state.tickTimer = alignedTicker();
  }, motionOK() ? ENTRANCE_SETTLE_MS : 140);
}

function start() {
  armAudio();
  unlockAudioForMobile(); // must run synchronously inside this tap — see note above clipPool
  startAudioSession(); // the silent keeper: warms the route, holds the session — see audio.js
  enterFullscreen();
  state.running = true;
  acquireWakeLock();
  el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running");
  resetSessionTally();
  beginEntrance();
}
function pause() { state.running = false; audit("phase", "paused"); stopAudioSession(); clearInterval(state.tickTimer); clearTimeout(state.settleTimer); clearEntrance(); stopComboLoop(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); el.startBtn.textContent = "Resume"; el.startBtn.classList.remove("is-running"); render(); }
// Resuming is a tap like any other, so it is also the moment to re-arm audio:
// whatever suspended the context while you were paused (a call, a lock screen,
// switching apps) is exactly the thing that used to leave the rest of the
// session silent. unlockAudioForMobile() repairs the clip pool too if the
// first attempt happened before the files had loaded.
function resume() { state.running = true; audit("phase", `resume ${state.phase}`); armAudio(); unlockAudioForMobile(); startAudioSession(); enterFullscreen(); el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running"); state.phaseEndsAt = Date.now() + state.secondsLeft * 1000; if (state.phase === "work") startComboLoop(); if (state.phase === "countdown") armPulse(); /* a pause inside the entrance can leave the waves held on "none" */ state.tickTimer = alignedTicker(); acquireWakeLock(); render(); }
function reset() { auditPersist(); clearInterval(state.tickTimer); clearTimeout(state.settleTimer); clearEntrance(); stopComboLoop(); clearFinale(); stopAudioSession(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); state.running = false; state.phase = "ready"; state.currentRound = 0; state.secondsLeft = 0; el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running"); el.combo.textContent = "Press start to begin"; if (el.comboName) el.comboName.textContent = ""; render(); }

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
  startAudioSession();
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
