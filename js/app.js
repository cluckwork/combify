// app.js — the brain of the trainer: settings controls, timer and phases.
// Everything that makes sound lives in js/audio.js.

import { randomCombo, comboName, MOVES } from "./combos.js";
import { VERSION, RELEASED } from "./version.js";
import { loadHistory, saveHistory, recordRound, currentStreak, trainedToday, formatDuration, dayKey } from "./stats.js";
import {
  configureVoice, speakCombo, stopVoice,
  armAudio, unlockAudioForMobile, markNeedsReprime,
  ringBell, playTick, playWarning, playBlip, playLand, parkIdleSfx, parkAllIdle,
  startAudioSession, stopAudioSession, ensureAudioSession, scheduleBlipRiff, stopBlipRiff,
} from "./audio.js";
import { audit, auditOn, setAudit, auditDump, auditPersist, auditReport } from "./audit.js";
import { deviceOS, deviceClass, canInstall, isStandalone, installGuide, platformTag, devForcesPrompt } from "./platform.js";
import { startTour, tourSeen, resetTour } from "./tour.js";
import { initDev, devOn, readDevFromUrl } from "./dev.js";

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
  installSteps: document.getElementById("installSteps"),
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

// The dev panel's finish preview waits a beat before finishing; held here so a
// second press cancels the first rather than running two finales at once.
let replayTimer = null;

// Set when a new build takes over mid-session (see the service worker block).
// Declared up here rather than beside that code because reset() runs during
// boot, long before it — a `let` further down would be in its temporal dead
// zone and the whole app would fail to start.
let pendingReload = false;

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
// The machine-readable copy of every report: a Google Form that feeds the
// team's response Sheet. The Sheet's published CSV is what the scheduled
// triage routine reads — this is the automated half of the report pipeline.
const REPORT_SHEET_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSfQKqR0pFmlELTxbUR80_dBaMBwfWj4QeCp_H39xq2zLYdfHg/formResponse";
const REPORT_SHEET_FIELDS = { description: "entry.1825277287", log: "entry.227585221" };

// ---------- Anonymous usage pings ----------
// One tiny row into the same sheet when a session starts and finishes, so
// the daily email can say "3 members trained today, 9 sessions, 412
// punches". Anonymous by construction: a random per-device id, the app
// version, and the session's own numbers — no names, no personal data, and
// never the user-agent string (close enough to a fingerprint to be worth not
// collecting; `p` carries the shape of the device instead).
// Fire-and-forget; an offline session just goes uncounted.
function usageId() {
  try {
    let id = localStorage.getItem("combify.uid");
    if (!id) { id = Math.random().toString(16).slice(2, 10); localStorage.setItem("combify.uid", id); }
    return id;
  } catch (e) { return "anon"; }
}

// The developer flag. Without it the founder's own testing is indistinguishable
// from a member's training, and every early number in the daily digest is a
// lie — at five testers, two of your own sessions is a third of the day. Set by
// visiting the app once with ?dev=1 (and cleared with ?dev=0); it sticks per
// device from then on, so it costs one tap on the phones used for testing.
// The flag itself, the five-tap gesture that sets it on a device with no
// address bar, and the panel it unlocks all live in js/dev.js.
readDevFromUrl();
const isDevDevice = devOn;

// The day this device first ran Combify. With it, the digest can tell a brand
// new member from one who came back — which is the roadmap's own success
// metric and was previously impossible to compute from the ping alone.
function firstSeenDay() {
  try {
    let d = localStorage.getItem("combify.firstSeen");
    if (!d) { d = dayKey(); localStorage.setItem("combify.firstSeen", d); }
    return d;
  } catch (e) { return ""; }
}

// Never report from a machine that is building the app.
//
// This is written in blood: the layout suite drives a REAL browser with REAL
// network access and runs real sessions to completion, so every test run was
// filing genuine-looking rows into the production sheet. One afternoon of
// development produced 94 "unique members" — each Playwright context starts
// with empty localStorage and therefore mints a fresh anonymous id — and
// buried a handful of actual members inside it.
//
// The guard belongs HERE rather than only in the tests, because the tests are
// not the only thing that runs Combify locally: `python3 -m http.server` while
// working on it does too, and every session played through during development
// was being counted as a member training.
function isLocalHost() {
  try {
    const h = location.hostname || "";
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1"
      || h === "" || h.endsWith(".local") || location.protocol === "file:";
  } catch (e) { return false; }
}

function pingUsage(kind, extra) {
  if (isLocalHost()) return;
  try {
    const row = new URLSearchParams();
    row.set(REPORT_SHEET_FIELDS.description, "SESSION_PING");
    // Lifetime context travels with every ping so the digest can classify the
    // device without keeping its own history: `s` (sessions ever) separates
    // new from returning, `days` (distinct days trained) separates a curious
    // second try from genuine retention, and `st` (streak) says whether the
    // retention loop is actually holding anyone.
    const base = {
      u: usageId(),
      v: VERSION,
      k: kind,
      p: platformTag(),                       // e.g. "ios-phone-app", "android-phone"
      f: firstSeenDay(),
      s: (history && history.totals && history.totals.sessions) | 0,
      days: history && history.days ? Object.keys(history.days).length : 0,
      st: currentStreak(history),
    };
    if (isDevDevice()) base.dev = 1;          // omitted entirely on real members' devices
    row.set(REPORT_SHEET_FIELDS.log, JSON.stringify(Object.assign(base, extra || {})));
    fetch(REPORT_SHEET_FORM, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: row.toString(),
    }).catch(() => {});
  } catch (e) {}
}
(function wireReport() {
  const foot = document.querySelector(".foot");
  const modal = document.getElementById("reportModal");
  if (!foot || !modal) return;
  const textEl = document.getElementById("reportText");
  const subEl = document.getElementById("reportSub");
  const actionsEl = document.getElementById("reportActions");
  const sendBtn = document.getElementById("reportSend");
  const thanksEl = document.getElementById("reportThanks");
  let closeTimer = null;

  function openModal() {
    clearTimeout(closeTimer);
    textEl.value = "";
    textEl.hidden = false; subEl.hidden = false; actionsEl.hidden = false;
    thanksEl.hidden = true;
    sendBtn.disabled = false; sendBtn.textContent = "Send";
    modal.hidden = false;
    try { textEl.focus(); } catch (e) {}
  }
  function closeModal() { clearTimeout(closeTimer); modal.hidden = true; }

  async function send() {
    const desc = String(textEl.value || "").trim();
    if (!desc) { try { textEl.focus(); } catch (e) {} return; }
    sendBtn.disabled = true; sendBtn.textContent = "Sending…";
    const text = auditReport(desc.slice(0, 500),
      `Combify v${VERSION} — sent to ${REPORT_TO}\nUA: ${navigator.userAgent || "?"}`);
    // Fire-and-forget copy into the Sheet (no-cors: the response is opaque,
    // so delivery can't be confirmed — the email below is the confirmed
    // channel and the fallback trigger).
    try {
      const row = new URLSearchParams();
      row.set(REPORT_SHEET_FIELDS.description, desc.slice(0, 500));
      row.set(REPORT_SHEET_FIELDS.log, text);
      fetch(REPORT_SHEET_FORM, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: row.toString(),
      }).catch(() => {});
    } catch (e) {}
    // Preferred path: straight to the developer's inbox via formsubmit.co (a
    // free relay — this app has no server of its own). The member just gets
    // thanked. NOTE: the relay's FIRST submission triggers a one-time
    // activation email to REPORT_TO; reports flow only once it's clicked.
    let delivered = false;
    try {
      const res = await fetch("https://formsubmit.co/ajax/" + REPORT_TO, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ _subject: "Combify problem report", message: text }),
      });
      delivered = !!(res && res.ok);
    } catch (e) {}
    if (delivered) {
      audit("report", "sent");
      textEl.hidden = true; subEl.hidden = true; actionsEl.hidden = true;
      thanksEl.hidden = false;
      closeTimer = setTimeout(closeModal, 1800);
      return;
    }
    // Delivery failed (offline, relay down): the report must never be lost.
    // Close the card and fall back to the share sheet, then clipboard.
    closeModal();
    if (navigator.share) {
      try { await navigator.share({ title: "Combify problem report", text }); audit("report", "shared"); return; }
      catch (e) { /* share cancelled or blocked — fall through to copy */ }
    }
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch (e) {}
    try { window.prompt(`No connection — send this to ${REPORT_TO}${copied ? " (it's copied for you)" : ""}:`, text); } catch (e) {}
    audit("report", "manual");
  }

  sendBtn.addEventListener("click", send);
  document.getElementById("reportCancel").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "foot__link";
  btn.textContent = "Report a problem";
  btn.addEventListener("click", openModal);
  // Actions live on their own centred footer line — see .foot__actions.
  const row = document.createElement("div");
  row.className = "foot__actions";
  row.appendChild(btn);
  foot.appendChild(row);
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
      (foot.querySelector(".foot__actions") || foot).appendChild(copyBtn);
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

const state = { running: false, phase: "ready", currentRound: 0, secondsLeft: 0, phaseEndsAt: 0, msLeft: 0, tickTimer: null, comboTimer: null, finaleTimer: null, settleTimer: null, entranceTimer: null };

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
  // iOS paused every sounding element when it took the app away, leaving them
  // mid-file. Rewind them NOW, while nothing is playing, so the async seeks
  // land during this idle moment instead of racing the next word's play() —
  // that race is what turns "pivot" into "vot" after a lock screen.
  parkAllIdle("visible");
  if (state.running) startAudioSession(); // best-effort; a rejection just means no keeper until the next tap
  if (state.running && state.phase === "work" && !state.comboTimer) startComboLoop();
});

// The "Combo pace" setting previously only controlled the gap AFTER a full
// combo finishes — it had no effect on how quickly the words WITHIN a combo
// were called, so a long advanced combo took just as long to speak at "Fast"
// as at "Relaxed." Derive a small inter-word gap from the same pace value so
// one setting now governs both: faster pace = quicker cadence AND shorter
// gap between combos.
// NOTE the 40ms floor is doing real work at the fast end. Fast (500) already
// derives 45ms, so Blitz (150) lands ON the floor rather than below it: past
// this point the app cannot speak faster, because a spoken word is a recording
// of fixed length — "six" takes 815ms whatever the setting. What Blitz
// shortens is the silence BETWEEN combos, 500ms down to 150. The floor is what
// keeps consecutive words from being scheduled on top of one another when the
// chain is already running back-to-back.
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
function countUp(node, to, { ms = 0, pop = false, haptics = false, sound = false, glow = null } = {}) {
  if (!motionOK() || to <= 0) { node.textContent = to.toLocaleString(); node.style.transform = ""; return; }
  // The riff scales with what was earned: one blip per punch up to two
  // dozen, uniform strides above that, and the whole climb lasts longer the
  // bigger the total — a 6-punch warm-down is a quick run up the scale, a
  // 100-punch session a proper drumroll. Bounds keep it snappy: 0.5s floor
  // so tiny counts still read as a run-up, ~2.2s ceiling so big ones never
  // drag. Callers can still pass ms to override.
  const MAX_STEPS = Math.min(to, 24);
  if (!ms) ms = Math.max(500, Math.min(2200, 55 * MAX_STEPS + 6 * Math.min(to, 100)));
  // A precomputed SCHEDULE, not time-sampling. Sampling an easing curve per
  // frame meant a dropped frame skipped numbers ("the numbers skip a few
  // because of lag"). Here every shown value is decided up front — small
  // totals count every single number, big ones use uniform strides — and a
  // late frame fires the next step LATE rather than skipping it. At most one
  // step fires per frame, so a stall stretches the count instead of
  // machine-gunning the tail. Each step is one number + one blip, always.
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
  // Reserve the width the FINAL number will need, so no step can resize the
  // box. Paired with tabular-nums (see .stat-digits), this makes every one of
  // the steps below a pure text swap: no reflow of the hero, the halo, or the
  // row beneath it. `ch` is exactly one digit wide once the digits are
  // tabular, and the separators are counted too.
  try {
    node.style.minWidth = `${to.toLocaleString().length}ch`;
  } catch (e) {}

  const started = Date.now();
  let next = 0;
  let lastBuzz = 0;
  const applyStep = () => {
    const value = values[next];
    const frac = (next + 1) / values.length;
    next++;
    node.textContent = value.toLocaleString();
    // The number GROWS as it climbs, so the size is telling the same story as
    // the digits and the rising blips — it arrives at full scale exactly as it
    // arrives at the total, and the pop then overshoots from there. A transform
    // is composited, so this costs nothing and, unlike a font-size ramp, cannot
    // relayout the hero on any step.
    node.style.transform = `scale(${(0.86 + 0.14 * frac).toFixed(3)})`;
    // The halo brightens with the climb. Its own layer, opacity only — the
    // GPU composites this; nothing about the glyphs repaints.
    if (glow) glow.style.opacity = String(0.85 * frac);
    const now = Date.now();
    if (haptics && frac > 0.55 && now - lastBuzz > 45) { buzz(7); lastBuzz = now; }
    if (sound && !riffOn && next < values.length) playBlip(frac); // the landing replaces the final blip
    // Park the blips that just finished, from our own call stack, so every
    // step ahead starts at zero — see the note above parkIdleSfx.
    if (sound && !riffOn) parkIdleSfx();
  };
  const land = () => {
    node.textContent = to.toLocaleString();
    node.style.transform = "scale(1)";   // the pop overshoots from full size
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
  if (riffOn) {
    // The riff is on the audio clock and CANNOT lag — so the screen chases
    // the sound, not the other way round. Every frame shows whichever step
    // the riff has reached RIGHT NOW; a dropped frame skips the missed
    // numbers at the next frame instead of running late (the founder heard
    // exactly that drift: "the animations lag behind the coherence of the
    // sounds"). Skipping displayed numbers is safe here because the AUDIO
    // carries the count — the reverse of the old rAF glitch, where a late
    // frame dragged the blips down with it.
    const frame = () => {
      const elapsed = Date.now() - started;
      while (next < values.length && elapsed >= times[next]) applyStep();
      if (next < values.length) { requestAnimationFrame(frame); return; }
      land();
    };
    requestAnimationFrame(frame);
  } else {
    // Media-fallback path: the sound is per-step, so keep the chained
    // one-shot timers — at most one step pending, each scheduled from real
    // elapsed time, 50ms floor. Here stretching beats skipping: a skipped
    // step would be a skipped BLIP.
    const step = () => {
      applyStep();
      if (next < values.length) {
        setTimeout(step, Math.max(50, times[next] - (Date.now() - started)));
        return;
      }
      land();
    };
    setTimeout(step, Math.max(0, times[0]));
  }
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
  // No fixed ms: countUp sizes the climb to the punch total itself.
  el.stats.__runCountUp = () => countUp(digits, session.punches, { pop: true, haptics: true, sound: true, glow: halo });
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
  // Blank during the countdown: "Get ready..." is already on screen in display
  // type below the dial, and saying it twice — small at the top of the ring,
  // large underneath — read as a layout mistake rather than emphasis. The slam
  // is what carries the moment now; the label was competing with it.
  setText(el.phase, state.phase === "work" ? "Work" : state.phase === "rest" ? "Rest" : state.phase === "done" ? "Done" : state.phase === "countdown" ? "" : "Ready");
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
// Write the ring's position with NO transition, then hand the transition back.
//
// The countdown is the one phase whose fill is eased (its value only changes
// once a second, so without easing it teleports between fifths). That easing
// also caught the very first write: arriving from the ready screen the ring is
// empty, the countdown's first value is FULL, and the transition dutifully
// animated the whole way round — the ring winding itself up before it had
// anything to count down. It should simply start full.
// Takes the work as a callback because the easing has to be off BEFORE the
// phase attribute lands: render() applies data-phase and writes the new offset
// in the same call, so switching the transition off afterwards is too late —
// the browser is already animating and renderProgress's no-op guard then sees
// the value it wanted and does nothing.
function withoutRingEasing(fn) {
  if (!el.dialFill) { fn(); return; }
  el.dialFill.style.transition = "none";
  fn();
  // Force a style flush so the jump is COMMITTED before easing comes back.
  // Reading offsetWidth is the usual trick, but that is an HTMLElement
  // property and this is an SVG <circle> — it reads undefined, forces nothing,
  // and the whole sequence collapses into one recalculation in which the
  // browser sees only "transition on, value changed" and dutifully animates
  // the ring in from empty. Reading the computed property itself does flush.
  try { void getComputedStyle(el.dialFill).strokeDashoffset; } catch (e) {}
  el.dialFill.style.removeProperty("transition");
}

function renderProgress() {
  if (!el.dialFill) return;
  if (!dialArraySet) { el.dialFill.style.strokeDasharray = String(DIAL_CIRCUMFERENCE); dialArraySet = true; }
  // Quantised to a quarter unit before stringifying. The raw value is a long
  // float that changes every single frame, so the no-op guard below never
  // fired and the browser re-rasterised the arc 60 times a second. On a
  // two-minute round the ring only travels ~0.05 units per frame — far below
  // anything an eye can see — so rounding lets most frames skip the write
  // entirely while long strings stop being built and discarded. A quarter of
  // an SVG unit is well under a device pixel along this arc, so the sweep
  // looks identical; short phases move faster per frame and simply keep
  // updating every frame, which is exactly when the smoothness is needed.
  const raw = DIAL_CIRCUMFERENCE * (1 - phaseFractionLeft());
  const offset = String(Math.round(raw * 4) / 4);
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
  state.msLeft = 0;   // a fresh phase carries no leftover from a pause
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
  // BOTH DEFERRED, and this is the single worst-placed stall in the app.
  // auditPersist stringifies up to 4000 ring-buffer entries and builds the
  // uniformity report; pingUsage walks the history for a streak, builds JSON
  // and opens a request. Running them here put ALL of that on the main thread
  // in the same frame the finale starts — the exact moment the count-up needs
  // every frame it can get. The session's story and the ping are both just as
  // true a tick later.
  deferIdle(auditPersist);
  deferIdle(() => pingUsage("finish", { rounds: session.rounds, punches: session.punches, secs: session.seconds }));
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
    if (remaining > 0) { if (changed) { playTick(); } parkIdleSfx(); render(); if (changed) slamBeat(); return; }
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
  // The silent-switch keeper gets the same treatment as the combo loop: iOS
  // pauses it on any interruption and never tells us, and a dead keeper costs
  // every remaining bell and warning its protection. Only acts when it is
  // genuinely down.
  if (state.running) ensureAudioSession();
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
// One countdown beat: the number lands, a ring shockwaves out from the dial.
// Driven per second from the clock rather than left as a fixed 5-iteration CSS
// animation, so pausing, re-anchoring after the fullscreen transition, or a
// late frame can never leave the beats out of step with the digits.
// Restarting a CSS animation needs the class off, a reflow, then on again.
function slamBeat() {
  if (!motionOK()) return;
  const pulse = el.stage.querySelector(".dial__pulse");
  if (pulse) {
    pulse.classList.remove("is-shock");
    void pulse.offsetWidth;
    pulse.classList.add("is-shock");
  }
  if (el.clock) {
    el.clock.classList.remove("is-slam");
    void el.clock.offsetWidth;
    el.clock.classList.add("is-slam");
  }
}
// Kept under its old name for the call in resume(): leaving a countdown paused
// mid-beat must not strand the animation classes on.
function armPulse() {
  const pulse = el.stage.querySelector(".dial__pulse");
  if (pulse) {
    pulse.classList.remove("is-shock");
    pulse.style.removeProperty("animation"); // clear any legacy inline hold
  }
  if (el.clock) el.clock.classList.remove("is-slam");
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
  // The settle tick must start from zero. parkIdleSfx only rewinds elements
  // that ENDED — one left paused mid-file (iOS does this whenever it takes the
  // app away) is skipped, and tick.wav is 90ms long, so playing it from its
  // middle is silence. Nothing is sounding at this point in the entrance, so
  // the whole pool gets parked, not just the tidy half of it.
  parkAllIdle("countdown");
  el.combo.textContent = "Get ready...";
  if (el.comboName) el.comboName.textContent = "";
  withoutRingEasing(render);   // start full, rather than winding up to full
  // The old filling wave was a fixed 5-iteration CSS animation held off with
  // an inline `animation: none` until the entrance settled. The slam is class
  // driven instead, and that leftover inline style silently outranked it — the
  // shockwave could never run. Clear it rather than set it.
  armPulse();
  clearTimeout(state.settleTimer);
  state.settleTimer = setTimeout(() => {
    armPulse();
    beginPhase(COUNTDOWN_SECONDS); // re-anchor: the 5 seconds start NOW, post-entrance
    playTick();
    withoutRingEasing(render);   // the re-anchor is a jump too, not a sweep
    slamBeat();   // "5" lands with the first tick
    state.tickTimer = alignedTicker();
  }, motionOK() ? ENTRANCE_SETTLE_MS : 140);
}

// Work that has no business being inside a tap. Anything gesture-bound (the
// audio unlock, fullscreen) MUST stay synchronous or iOS refuses it — but
// everything else can wait a beat, and while it runs the button has not
// visibly responded yet. A handler only ends when its last statement does.
function deferIdle(fn) {
  try { setTimeout(fn, 0); } catch (e) { try { fn(); } catch (e2) {} }
}

function start() {
  armAudio();
  unlockAudioForMobile(); // must run synchronously inside this tap — see note above clipPool
  startAudioSession(); // the silent keeper: warms the route, holds the session — see audio.js
  deferIdle(() => pingUsage("start"));
  enterFullscreen();
  state.running = true;
  acquireWakeLock();
  el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running");
  resetSessionTally();
  beginEntrance();
}
// Pausing captures the exact milliseconds left, and resume restores them.
//
// It used to rebuild the deadline from state.secondsLeft, which is what the
// CLOCK SHOWS — and that is Math.ceil of the real remainder. Pausing with 2.3s
// left therefore resumed with 3.0s: the round quietly grew by up to a second
// every single pause. Worse for the feel, the restored deadline then sat exactly
// on a second boundary, so alignedTicker's `% 1000` came out 0 and its `|| 1000`
// fallback waited a WHOLE second before the first tick. Tap resume, watch the
// number sit there. That is the "one extra whole second" — arithmetic, not a
// slow phone, which is why no amount of optimising made it go away.
function pause() { state.running = false; audit("phase", "paused"); state.msLeft = Math.max(0, state.phaseEndsAt - Date.now()); stopAudioSession(); clearInterval(state.tickTimer); clearTimeout(state.settleTimer); clearEntrance(); stopComboLoop(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); el.startBtn.textContent = "Resume"; el.startBtn.classList.remove("is-running"); render(); }
// Resuming is a tap like any other, so it is also the moment to re-arm audio:
// whatever suspended the context while you were paused (a call, a lock screen,
// switching apps) is exactly the thing that used to leave the rest of the
// session silent. unlockAudioForMobile() repairs the clip pool too if the
// first attempt happened before the files had loaded.
function resume() { state.running = true; audit("phase", `resume ${state.phase}`); armAudio(); unlockAudioForMobile(); startAudioSession(); enterFullscreen(); el.startBtn.textContent = "Pause"; el.startBtn.classList.add("is-running"); state.phaseEndsAt = Date.now() + (state.msLeft > 0 ? state.msLeft : state.secondsLeft * 1000); state.msLeft = 0; if (state.phase === "work") startComboLoop(); if (state.phase === "countdown") armPulse(); /* a pause inside the entrance can leave the waves held on "none" */ state.tickTimer = alignedTicker(); acquireWakeLock(); render(); }
function reset() { deferIdle(auditPersist); parkAllIdle("reset"); clearInterval(state.tickTimer); clearTimeout(state.settleTimer); clearEntrance(); stopComboLoop(); clearFinale(); stopAudioSession(); window.speechSynthesis && window.speechSynthesis.cancel(); releaseWakeLock(); state.running = false; state.phase = "ready"; state.currentRound = 0; state.secondsLeft = 0; state.msLeft = 0; el.startBtn.textContent = "Start"; el.startBtn.classList.remove("is-running"); el.combo.textContent = "Press start to begin"; if (el.comboName) el.comboName.textContent = ""; render(); applyPendingReload(); }

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
  deferIdle(() => pingUsage("start")); // a restart is a fresh session for the daily numbers
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
  // The one moment worth asking: they just trained, and this is the screen
  // they land on. Both calls re-check every condition themselves.
  refreshInstallNudge();
  maybeAskToInstall();
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
//
// AND KEEP IT CURRENT. Registering once and never checking again is how a
// phone ends up insisting a version is "not live" hours after it shipped: the
// fetch handler is network-first, so page ASSETS refresh, but the browser only
// re-fetches sw.js itself when it feels like it — and an installed home-screen
// app on iOS can sit on an old worker for a very long time. GitHub Pages
// serving `cache-control: max-age=600` on top of that means a member can be
// ten minutes or ten hours behind with no way to tell and nothing to tap.
if ("serviceWorker" in navigator) {
  // Was this page already under a worker's control when it loaded? On a FIRST
  // visit clients.claim() fires controllerchange too, and reloading there
  // would restart a page the member has only just opened.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      if (!reg) return;
      const check = () => { try { reg.update(); } catch (e) {} };
      check();
      // Returning to the app is the right moment to look: it costs one
      // conditional request, it is never mid-round, and it is exactly when
      // someone who has just been told "there's a new version" comes back.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    }).catch(() => {});
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    // Never yank the page out from under a running round. The reload waits
    // for the ready screen instead — a member mid-session losing their round
    // to a silent update would be a far worse bug than being a build behind.
    if (state.running) { pendingReload = true; return; }
    reloading = true;
    location.reload();
  });
}

// Called from reset(), which is where every session ends up.
function applyPendingReload() {
  if (!pendingReload || state.running) return;
  pendingReload = false;
  auditPersist();   // deferred writes do not survive a reload; take this one now
  location.reload();
}

// ---------- Install nudge ----------
// Installing is the upgrade path, not the front door: the link keeps working
// for everyone forever, but installed Combify opens fullscreen with no browser
// chrome (the ONLY way to lose the bar on iPhone) and is the prerequisite for
// push later.
//
// TIMING IS THE WHOLE FEATURE. This used to fire the moment the page loaded,
// which asked a stranger to install an app they had not yet used a single
// time — and because dismissing wrote a permanent tombstone, one reflex tap on
// the x silenced it forever, including for the members who went on to train
// every day. The ask is now EARNED: it waits for a finished session and
// appears on the ready screen the member comes back to, when they have just
// trained and the reason is obvious. Dismissing snoozes for a week; only a
// second dismissal means never.
const INSTALL_KEY = "combify.install.v2";
const INSTALL_LEGACY_KEY = "combify.installDismissed";
const INSTALL_SNOOZE_MS = 7 * 86400000;
const INSTALL_MAX_DECLINES = 2;
// isStandalone now lives in js/platform.js alongside the rest of the
// device questions, so the modal, the strip and the usage ping all read one
// answer instead of three copies drifting apart.

function saveInstallState(s) {
  try { localStorage.setItem(INSTALL_KEY, JSON.stringify(s)); } catch (e) {}
}
function loadInstallState() {
  try {
    const raw = JSON.parse(localStorage.getItem(INSTALL_KEY));
    if (raw && typeof raw === "object") {
      return { declines: raw.declines | 0, snoozeUntil: Number(raw.snoozeUntil) || 0 };
    }
  } catch (e) { /* unreadable or storage blocked */ }
  // Migrate the old permanent tombstone. Those dismissals answered a question
  // asked at the wrong moment — before the member had trained at all — so they
  // are honoured as ONE decline plus a snooze rather than a life sentence.
  try {
    if (localStorage.getItem(INSTALL_LEGACY_KEY) === "1") {
      const migrated = { declines: 1, snoozeUntil: Date.now() + INSTALL_SNOOZE_MS };
      saveInstallState(migrated);
      localStorage.removeItem(INSTALL_LEGACY_KEY);
      return migrated;
    }
  } catch (e) {}
  return { declines: 0, snoozeUntil: 0 };
}
// Asking is only worth spending on someone who has felt what the app does.
function installEarned() {
  return !!(history && history.totals && history.totals.sessions > 0);
}
// Being in a browser that cannot install at all is not the same question as
// "would you like to install this?", and it does not wait for a finished
// session. The member is in Chrome on an iPhone, where Combify can never lose
// the address bar and can never work offline — and the cost of moving to
// Safari only goes UP the longer they stay, because settings and training
// history live per-browser. Telling them on arrival is the helpful moment;
// telling them after three sessions means those sessions are in the wrong
// place. Every other platform keeps the earned rule from v1.20.0.
// The one thing that still overrides "you must finish a session first": the
// member followed a link that exists to install the app — the QR code at the
// gym, say. They asked; making them train first would be obtuse.
function installBlocked() {
  return arrivedForInstall();
}

function installSilenced() {
  const s = loadInstallState();
  if (s.declines >= INSTALL_MAX_DECLINES) return true;   // asked twice, told no twice
  return !!(s.snoozeUntil && Date.now() < s.snoozeUntil); // still snoozed
}

let deferredInstall = null;
let installMode = null; // "prompt" = browser offers real install | "hint" = iOS | null = nothing to offer

// The ONE place that decides whether the card is on screen. Safe to call from
// anywhere: it re-checks every condition rather than trusting a flag set
// earlier, so a stale caller can never force it open.
function refreshInstallNudge() {
  if (!el.installNudge) return;
  // Computers get none of this, even when Chrome offers a real one-tap
  // install. There is no home screen to add anything to, the browser tab is
  // already a perfectly good way to use Combify, and a laptop does not need a
  // second copy of it in the dock. The dialog has always skipped desktop; the
  // quiet strip was still appearing there because Chrome fires
  // beforeinstallprompt on a Mac and that alone used to be enough.
  if (!canInstall()) { hideInstallNudge(); return; }
  if (!installMode || isStandalone() || installSilenced() || !(installEarned() || installBlocked())) {
    hideInstallNudge();
    return;
  }
  // Both the strip and the dialog render from the same guide, so the steps a
  // member is given can never disagree between the two places we show them.
  const guide = installGuide(installMode === "prompt");
  if (guide.action === "prompt") {
    el.installBtn.hidden = false;
    if (el.installSteps) { el.installSteps.hidden = true; el.installSteps.innerHTML = ""; }
    el.installSub.textContent = "Opens fullscreen, works offline.";
  } else {
    // No install API to call here — on iOS Apple exposes none at all. The only
    // honest help is showing people exactly where the option is hidden, and in
    // a browser where it genuinely isn't, saying so instead of pretending.
    el.installBtn.hidden = true;
    el.installSub.textContent = "One time. Then it opens fullscreen and works offline.";
    if (el.installSteps) {
      renderInstallSteps(el.installSteps, guide.steps);
      el.installSteps.hidden = guide.steps.length === 0;
    }
  }
  el.installNudge.hidden = false;
}

// The icons a member is actually hunting for, drawn rather than named.
//
// Naming an icon is the instruction people fail to follow: almost nobody has
// consciously looked at the Share glyph, and "Add to Home Screen" is a line of
// text in a long scrolling sheet where the picture beside it is what the eye
// finds first. Every glyph here is a real one from the platform — the iOS
// share arrow, the rounded square with a plus that iOS puts next to Add to
// Home Screen, and Android's three-dot overflow — so they match what is on
// screen rather than being decoration.
const GLYPH = (body, fill) =>
  `<span class="ins__glyph"><svg viewBox="0 0 24 24" width="15" height="15" fill="${fill || "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg></span>`;

const GLYPHS = {
  // iOS share: a box with an arrow leaving the top of it.
  share: GLYPH('<path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/>'),
  // The icon iOS shows beside "Add to Home Screen" in the share sheet: a
  // rounded square with a plus in it.
  addhome: GLYPH('<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8.5v7"/><path d="M8.5 12h7"/>'),
  // Android's overflow menu.
  menu: GLYPH('<circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/>', "currentColor"),
  // The chevron that expands a collapsed list — iOS's share sheet shows a
  // short list first and hides the rest behind it (or behind "More").
  chevron: GLYPH('<path d="M6 9.5 12 15.5l6-6"/>'),
  // Samsung Internet: three stacked lines, in its bottom bar.
  menulines: GLYPH('<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>'),
  // Edge on Android: three horizontal dots, centred along the bottom.
  menudots: GLYPH('<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>', "currentColor"),
  // Chrome for Android's "Install app" item: a handset taking something in.
  install: GLYPH('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 8v5.5"/><path d="M9.7 11.2 12 13.5l2.3-2.3"/>'),
};

// Steps come from js/platform.js as trusted, hard-coded strings — no user
// input reaches this — so {token} placeholders can be swapped for real markup.
function renderInstallSteps(ol, steps) {
  ol.innerHTML = "";
  for (const s of steps) {
    const li = document.createElement("li");
    // The text goes in its own span, never straight into the li. In the dialog
    // the li is a grid (number | text) and bare inline children — every text
    // node and every <strong> — would each be laid out as a separate grid
    // item, which shattered "Tap Copy link below" across three rows.
    const span = document.createElement("span");
    span.innerHTML = s.replace(/\{(\w+)\}/g, (m, k) => GLYPHS[k] || "");
    li.appendChild(span);
    ol.appendChild(li);
  }
}
function hideInstallNudge() { if (el.installNudge) el.installNudge.hidden = true; }

// Chrome/Edge/Android fire this when the app qualifies for install. Stash the
// event; calling prompt() later must happen inside our button's tap. Note it
// does NOT show the card — the browser's idea of "installable" is not the same
// as the member having earned the ask.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  installMode = "prompt";
  refreshInstallNudge();
});
if (el.installBtn) {
  el.installBtn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    const ev = deferredInstall;
    deferredInstall = null;
    try {
      ev.prompt();
      const choice = await ev.userChoice;
      if (choice && choice.outcome === "accepted") { installMode = null; hideInstallNudge(); }
    } catch (e) {}
  });
}
if (el.installDismiss) {
  el.installDismiss.addEventListener("click", () => {
    const s = loadInstallState();
    s.declines += 1;
    s.snoozeUntil = Date.now() + INSTALL_SNOOZE_MS;
    saveInstallState(s);
    hideInstallNudge();
  });
}
window.addEventListener("appinstalled", () => { installMode = null; hideInstallNudge(); });
// iOS never fires beforeinstallprompt, so there is nothing to wait for: if
// we're on iOS at all, the manual route is the only route. (js/platform.js
// already untangles iPadOS pretending to be a Mac, and Chrome-on-iPhone
// pretending to be Safari.)
if (deviceOS() === "ios") installMode = "hint";
// Android browsers that never fire the event — Firefox, and Chrome before it
// decides the app qualifies — still have the menu item, so they get steps too
// rather than nothing at all.
if (deviceOS() === "android" && !installMode) installMode = "hint";
// A member who trained yesterday and opens the app today has already earned
// the ask — they should see it on the ready screen without having to finish
// another session first.
refreshInstallNudge();

// ---------- The add-to-home-screen dialog ----------
// The strip above is quiet by design, which is also its weakness: on a phone
// it is a small line of text below the fold that people skim past. This is the
// ask that actually gets seen — shown ONCE per snooze cycle, on the ready
// screen, right after a session the member chose to finish.
//
// It is never shown on a computer. There is no home screen to add anything to
// there, the browser tab is already a fine way to use Combify, and interrupting
// a laptop user with phone instructions is how an app teaches people that its
// dialogs are worth dismissing unread.
// Opening the dialog is NOT the same as the member answering it. The first
// version marked it seen the moment it appeared, so closing the tab — which is
// what happens when someone taps "Open in Safari", gets sent away, and never
// comes back to that tab — counted as a decision. Reopening the link then only
// ever got the quiet strip, buried below the settings, and the actual
// instructions were effectively gone.
//
// So: count the times it has OPENED, and separately record whether they
// actually answered. Skip, the scrim, or the action button are answers. A tab
// that just disappears is not, and gets asked again — up to a cap, because
// something that returns forever is a nag no matter how good the reason.
// An install LINK — the QR code at the gym points at ?ath=1 — shows the card
// immediately instead of waiting for a finished session. Someone who scanned a
// code labelled "put this on your phone" has already asked; making them train
// first would be obtuse. The parameter is lifted straight back out of the
// address bar so a link the member later shares does not carry it.
const ATH_KEY = "combify.install.arrived";
const ATH_PARAM = "ath";

(function readArrival() {
  try {
    if (new URLSearchParams(location.search).get(ATH_PARAM) !== "1") return;
    localStorage.setItem(ATH_KEY, "1");
    // NOTE window.history, spelled out: this module has its own module-level
    // `history` (the member's training log), which shadows the global. Written
    // as bare `history.replaceState` the check is silently undefined and the
    // parameter just stays in the address bar.
    if (window.history && window.history.replaceState) {
      const u = new URL(location.href);
      u.searchParams.delete(ATH_PARAM);
      window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch (e) {}
})();
function arrivedForInstall() {
  try { return localStorage.getItem(ATH_KEY) === "1"; } catch (e) { return false; }
}
function clearArrival() {
  try { localStorage.removeItem(ATH_KEY); } catch (e) {}
}

// ASKING AGAIN, ON PURPOSE.
//
// Getting Combify onto a home screen is the single highest-value thing a
// member can do, so one refusal is not a final answer — someone who declines
// on day one and is still training three weeks later has changed their mind
// about the app even if they have not thought about the icon. But "ask again"
// has to mean something specific or it becomes a nag.
//
// The clock is SESSIONS, not days. Time-based re-asking treats a member who
// trains daily and one who trains monthly identically, which is backwards:
// the person who keeps coming back is exactly the person worth asking twice.
// And the gap widens each time — 3 sessions, then 6, then 12 — so the app
// gets quieter the longer someone declines, rather than louder.
//
// The way out is explicit, not inferred. "Don't ask again" ends it for good.
const INS_ASKS_KEY = "combify.install.asks.v1";
const INS_AT_KEY = "combify.install.atSessions.v1";
const INS_NEVER_KEY = "combify.install.never.v1";
const INS_GAPS = [3, 6, 12];   // sessions between asks; the last one repeats

function insAsks() {
  try { return parseInt(localStorage.getItem(INS_ASKS_KEY), 10) || 0; } catch (e) { return 0; }
}
function insAtSessions() {
  try { return parseInt(localStorage.getItem(INS_AT_KEY), 10) || 0; } catch (e) { return 0; }
}
function insNever() {
  try { return localStorage.getItem(INS_NEVER_KEY) === "1"; } catch (e) { return false; }
}
function sessionCount() {
  return (history && history.totals && history.totals.sessions) | 0;
}
// Recorded when the card is actually shown, so the next ask is counted from
// there rather than from whenever the member last happened to answer.
function noteInsShown() {
  try {
    localStorage.setItem(INS_ASKS_KEY, String(insAsks() + 1));
    localStorage.setItem(INS_AT_KEY, String(sessionCount()));
  } catch (e) {}
}
function insDueAgain() {
  const asks = insAsks();
  if (asks === 0) return true;
  const gap = INS_GAPS[Math.min(asks - 1, INS_GAPS.length - 1)];
  return sessionCount() >= insAtSessions() + gap;
}
function noteInsNever() {
  try {
    localStorage.setItem(INS_NEVER_KEY, "1");
    // Silence the quiet strip too. Someone who says "don't ask again" means
    // the whole subject, not just this card — leaving the strip up would read
    // as the app ignoring them.
    saveInstallState({ declines: INSTALL_MAX_DECLINES, snoozeUntil: 0 });
  } catch (e) {}
}

// Used by the dev panel to replay a first run without wiping everything else.
function clearInsAsk() {
  try {
    localStorage.removeItem(INS_ASKS_KEY);
    localStorage.removeItem(INS_AT_KEY);
    localStorage.removeItem(INS_NEVER_KEY);
    localStorage.removeItem(INSTALL_KEY);
  } catch (e) {}
}

function openInstallDialog(force) {
  const modal = document.getElementById("insModal");
  // `force` is the dev panel bypassing the "is this device even installable"
  // gate, so a computer can review the iPhone card. Nothing else passes it.
  if (!modal || (!force && (!canInstall() || isStandalone()))) return false;
  const guide = installGuide((installMode === "prompt" && !!deferredInstall) || devForcesPrompt());
  if (guide.mode === "none") return false;

  const sub = document.getElementById("insSub");
  const steps = document.getElementById("insSteps");
  const go = document.getElementById("insGo");
  const title = document.getElementById("insTitle");

  if (title) {
    title.textContent = deviceClass() === "tablet"
      ? "Keep Combify on your iPad"
      : "Keep Combify on your phone";
  }
  if (sub) {
    sub.textContent = guide.sub || "";
    sub.hidden = !guide.sub;
  }
  if (steps) renderInstallSteps(steps, guide.steps);
  renderAim(guide);
  if (go) {
    go.hidden = !guide.action;
    if (guide.actionLabel) {
      // innerHTML, not textContent: the label carries the same add-to-home
      // glyph the step lists use, so the one-tap path is not the only one
      // without a picture. Both halves are our own constants.
      go.innerHTML = `${GLYPHS.addhome}<span>${guide.actionLabel}</span>`;
    }
  }
  if (!force) noteInsShown();
  modal.hidden = false;
  audit("install", `dialog ${guide.mode}`);
  return true;
}
// The pointer that reaches past our own page.
//
// A web page cannot see the browser's furniture, let alone draw on it — the
// Share button lives in a bar we have no access to and no coordinates for. So
// this does the one honest thing available: sits against the screen edge
// NEAREST that button, carries the same icon the step names, and points out of
// the page toward it. The member's eye finishes the journey.
//
// It asserts nothing the sentence beside it doesn't already assert. Both are
// wrong together if someone has moved their address bar (iOS 15+ allows it,
// and Chrome on iOS since 2024), which is why the pointer is a nudge at the
// edge rather than a confident "it is exactly here" callout.
function renderAim(guide) {
  const aim = document.getElementById("insAim");
  if (!aim) return;
  const modalEl = document.getElementById("insModal");
  const neverEl = document.getElementById("insNever");
  if (!guide || !guide.aim) {
    aim.hidden = true;
    if (modalEl) delete modalEl.dataset.aim;   // nothing to point at: stay centred
    if (neverEl) neverEl.dataset.edge = "bottom";
    return;
  }
  const { edge, side } = guide.aim;
  // The icon at the arrow is whatever STEP ONE tells you to tap — read out of
  // the step itself rather than picked separately, so the two can never drift
  // apart. They drifted once: Safari's first step became "tap the bar, then
  // •••" while the arrow still showed the Share icon, pointing at a button
  // that is not the one you press first.
  const firstToken = /\{(\w+)\}/.exec(guide.steps[0] || "");
  const glyph = (firstToken && GLYPHS[firstToken[1]]) || GLYPHS.share;
  const chevron = edge === "top"
    ? '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V4.5"/><path d="M5 11.5 12 4.5l7 7"/></svg>'
    : '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v16.5"/><path d="M5 12.5 12 19.5l7-7"/></svg>';
  // Arrow nearest the edge, icon behind it — so the eye is led outward.
  aim.innerHTML = edge === "top" ? chevron + glyph : glyph + chevron;
  aim.dataset.edge = edge;
  aim.dataset.side = side;
  // How far in from the edge the real button sits. Pinning the pointer to the
  // edge itself lands it beside an omnibox icon rather than under it.
  if (guide.aim.inset) aim.style.setProperty("--aim-inset", `${guide.aim.inset}px`);
  else aim.style.removeProperty("--aim-inset");
  aim.hidden = false;

  // Pull the card to the same end of the screen as the pointer, so the two
  // read as one instruction instead of a dialog and an unrelated arrow at the
  // far edge. The clearance below is a hard floor, not a preference — the card
  // sliding up under Chrome's address bar is exactly the bug this dialog was
  // centred to fix in the first place.
  const modal = document.getElementById("insModal");
  if (modal) modal.dataset.aim = edge;
  // Park the opt-out at the opposite end from the pointer, so the two never
  // compete for the same corner and "Don't ask again" stays as far from the
  // rest of the card as the screen allows.
  const never = document.getElementById("insNever");
  if (never) never.dataset.edge = edge === "top" ? "bottom" : "top";
}

function closeInstallDialog() {
  const modal = document.getElementById("insModal");
  if (modal) modal.hidden = true;
  clearArrival();
  // Whatever the member does next, the quiet strip is what remains — so the
  // route back in is always there without this dialog ever reopening itself.
  refreshInstallNudge();
}

(function wireInstallDialog() {
  const modal = document.getElementById("insModal");
  if (!modal) return;
  const go = document.getElementById("insGo");
  const skip = document.getElementById("insSkip");

  if (go) {
    go.addEventListener("click", async () => {
      const guide = installGuide((installMode === "prompt" && !!deferredInstall) || devForcesPrompt());
      if (guide.action === "prompt" && deferredInstall) {
        const ev = deferredInstall;
        deferredInstall = null;
        try {
          ev.prompt();
          const choice = await ev.userChoice;
          if (choice && choice.outcome === "accepted") { installMode = null; hideInstallNudge(); }
        } catch (e) {}
        closeInstallDialog();
        return;
      }
      closeInstallDialog();
    });
  }
  if (skip) skip.addEventListener("click", closeInstallDialog);
  const never = document.getElementById("insNever");
  if (never) {
    never.addEventListener("click", () => {
      noteInsNever();
      closeInstallDialog();
      hideInstallNudge();
      audit("install", "never ask again");
    });
  }
  // NO scrim-to-dismiss, deliberately. Tapping outside a card is a reflex
  // rather than a decision, and this is the one moment the app asks for
  // something it genuinely wants: a stray tap should not answer it. "Not now"
  // is the only way out, so declining is a thing someone chose to do.
  //
  // The obligation that comes with that: the exit must always be reachable.
  // The scrim scrolls (overflow-y: auto) and the layout suite asserts "Not
  // now" sits inside the viewport on every phone it tests — a card that grew
  // past the bottom of a small screen would turn this from firm into trapped.

  // A way back in for anyone who said "not now" — the same footer idiom as
  // "Report a problem". Hidden on computers and once installed, where it would
  // only ever be a dead end.
  if (canInstall() && !isStandalone()) {
    const foot = document.querySelector(".foot__actions") || document.querySelector(".foot");
    if (foot) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "foot__link";
      link.textContent = "Add to home screen";
      link.addEventListener("click", () => {
        const modalEl = document.getElementById("insModal");
        if (modalEl && !openInstallDialog()) modalEl.hidden = true;
      });
      foot.appendChild(link);
    }
  }
})();

// The one automatic showing: earned exactly like the strip is (a finished
// session), never while snoozed or declined, and only the first time.
function maybeAskToInstall() {
  if (!canInstall() || isStandalone()) return;
  if (insNever() || !insDueAgain()) return;
  if (!installEarned() && !installBlocked()) return;
  openInstallDialog();
}
// Both of the deferred boot steps below run at module top level, where
// requestAnimationFrame is not guaranteed to exist — a headless DOM without a
// layout engine has no frames to wait for. Fall back to a timeout so the app
// still finishes booting rather than dying on the missing global.
const nextFrame = (fn) => {
  try {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
    else setTimeout(fn, 0);
  } catch (e) {}
};

// Someone who trained yesterday and is opening the app again today has already
// earned the ask — they shouldn't have to finish another session to see it.
// Deferred a frame so the dialog's own buttons are wired first.
nextFrame(() => { try { maybeAskToInstall(); } catch (e) {} });

// Closing or swiping the app away is the one exit that never runs reset(), so
// the keeper would be left attached and its lock-screen card could outlive the
// page. Only when nothing is running: a locked screen mid-round is exactly
// when the keeper is doing its job and must stay.
window.addEventListener("pagehide", () => {
  if (!state.running) { try { stopAudioSession(); } catch (e) {} }
});

// ---------- The developer's workbench (js/dev.js) ----------
// Wired unconditionally: the five-tap gesture has to be listening before dev
// mode is on, or there would be no way to turn it on inside an installed app.
// Every action below drives the REAL code path rather than a mock — a shortcut
// that fakes the finish screen would prove nothing about the finish screen.
initDev({
  // The id this device puts in every ping. Surfaced on the badge because
  // nothing else can tie a sheet row back to a physical phone.
  deviceId: usageId(),
  // The finale is normally three rounds away. Seed a plausible session and run
  // the genuine finish(), bell and all.
  // The finale preview has now misrepresented the real thing three separate
  // ways, so it is worth stating the rule: a real finish happens minutes into
  // a session, in focus mode, with a warm audio route and a settled layout.
  // Anything the preview skips, it lies about.
  //
  //   1. AUDIO ROUTE. It never called startAudioSession, so silenceOk stayed
  //      false, every Web Audio path was refused, and all 23 count-up blips
  //      fell back to individual element plays — stuttery and uneven.
  //   2. THAT CALL IS ASYNCHRONOUS. Adding it was not enough: silenceOk is set
  //      when the keeper's play() PROMISE resolves, and finish() ran in the
  //      same tick, so the riff was scheduled before the route existed and
  //      fell back anyway. Only a later press felt right, because by then the
  //      keeper from the previous press was still warm.
  //   3. LAYOUT. startFinale measures the dial with getBoundingClientRect to
  //      find screen centre. Going ready → finish in one tick measures WHILE
  //      the chrome is still folding away, so the dial lands wherever the
  //      transition happened to be — low, half off the bottom of the screen,
  //      and differently every time. It appeared to "fix itself" because the
  //      glide back clears the transform.
  //
  // So the preview now enters focus mode, renders, and waits for both the
  // chrome transition and the keeper before finishing.
  replayFinish() {
    clearTimeout(replayTimer);
    reset();
    armAudio();
    unlockAudioForMobile();
    startAudioSession();
    session.rounds = 3; session.punches = 84; session.seconds = 360;
    session.pendingPunches = 0; session.started = true;
    state.phase = "done";
    render();                       // focus mode on; the chrome starts folding
    // Long enough for the 0.3s chrome transition to land AND the keeper's
    // play() promise to resolve. Cleared on re-entry, so hammering the button
    // restarts one preview rather than overlapping two — which is what rang
    // the bell twice.
    // 500ms was not enough: the first press still measured mid-transition and
    // put the dial 52px below centre. The chrome fold, the stage growing to
    // fullscreen and the keeper's promise all have to land first.
    replayTimer = setTimeout(finish, 900);
  },
  // Two ten-second rounds: the whole arc — countdown, work, rest, finish — in
  // about half a minute, using the ordinary settings and the ordinary start.
  quickSession() {
    roundsCtl.set(2); workCtl.set(10); restCtl.set(5);
    el.startBtn.click();
  },
  showInstall() { openInstallDialog(true); },
  replayTour() { resetTour(); startTour(); },
  // The two first-run moments in the order a new member actually meets them:
  // the walkthrough, then the home-screen card the moment it ends. Reviewing
  // them one at a time hides the thing most worth judging — how much is being
  // asked of someone in their first thirty seconds.
  firstRun() {
    resetTour();
    clearInsAsk();
    startTour(() => openInstallDialog(true));
  },
  // Writes N consecutive days ending today, so the streak flame and the ready
  // screen's summary can be seen at any length without waiting N days.
  setStreak(n) {
    const days = {};
    let sessions = 0, rounds = 0, punches = 0, seconds = 0;
    for (let i = 0; i < n; i++) {
      const ts = Date.now() - i * 86400000;
      days[dayKey(ts)] = { sessions: 1, rounds: 3, punches: 84, seconds: 360 };
      sessions += 1; rounds += 3; punches += 84; seconds += 360;
    }
    history = { days, totals: { sessions, rounds, punches, seconds }, lastTrainedAt: Date.now() };
    saveHistory(history);
    render();
    refreshInstallNudge();
  },
  // Back to being a stranger: no history, no settings, no snoozes, no dev
  // flag. The only honest way to check what a first-time member actually sees.
  wipe() {
    try { localStorage.clear(); } catch (e) {}
    location.reload();
  },
});

// ---------- First run ----------
// Runs before anything else can get in the way, and only for someone who has
// never opened Combify before. tourSeen() is written the moment it opens, so
// this can never fire twice even if the member walks away mid-tour.
if (!tourSeen() && !(history && history.totals && history.totals.sessions > 0)) {
  // One frame's delay so the layout has settled and the spotlight measures the
  // real positions rather than the pre-paint ones.
  nextFrame(() => { try { startTour(); } catch (e) {} });
}
