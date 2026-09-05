// dev.js — the founder's own workbench, hidden inside the shipped app.
//
// TWO DIFFERENT THINGS SHARE ONE FLAG, and it's worth being clear about which
// is which, because they arrived for different reasons:
//
//   1. ANALYTICS EXCLUSION. `combify.dev` marks this device so every usage
//      ping carries dev:1 and the daily digest can subtract it. Without it the
//      founder's own testing is indistinguishable from a member training, and
//      at five testers two of his own sessions is a third of the day — every
//      early number would be a lie. This half needs no UI at all.
//
//   2. THIS PANEL. The states worth looking at are the slowest to reach: the
//      finish finale is three real rounds away, the install card only appears
//      after a completed session, the walkthrough only ever runs once, and the
//      streak flame at seven days is a week of waiting. Checking any of them
//      used to mean sitting through the app or hand-editing localStorage in a
//      console that phones don't have. Each one is a button here.
//
// They share a flag because they are both "this device belongs to whoever
// builds the app". Turning dev mode off does both: the panel disappears and
// the pings go back to looking like everyone else's.
//
// HOW IT IS TURNED ON. Either visit with ?dev=1, or tap "by Boxing With Bakr"
// in the header five times. The gesture exists because a home-screen app on
// iOS gets its OWN storage, separate from the Safari tab it was installed
// from — so a phone flagged in Safari comes back UNFLAGGED inside the
// installed app, where there is no address bar to type ?dev=1 into. The
// gesture is the only way to reach it there.
//
// NOTHING HERE IS REACHABLE BY A MEMBER. Every control is built only when the
// flag is already set, and the flag is only set by the URL or a five-tap
// gesture on a word nobody taps once.

import { OVERRIDE_NAMES } from "./platform.js";

const KEY = "combify.dev";
const PLATFORM_KEY = "combify.dev.platform";
const PROMPT_KEY = "combify.dev.prompt";

const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const write = (k, v) => {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {}
};

export function devOn() { return read(KEY) === "1"; }

export function setDev(on) {
  write(KEY, on ? "1" : null);
  if (!on) { write(PLATFORM_KEY, null); write(PROMPT_KEY, null); }
}

// Reads ?dev=1 / ?dev=0 out of the URL once at boot.
export function readDevFromUrl() {
  try {
    const q = new URLSearchParams(location.search).get("dev");
    if (q === "1") setDev(true);
    else if (q === "0") setDev(false);
  } catch (e) {}
}

// ---------- The always-visible reminder ----------
// A badge, not a subtle tint. Dev mode changes what the numbers mean, and the
// one genuinely costly mistake is handing the phone to Bakr or a member with
// it still on — their session would be filed as the developer's and quietly
// dropped from the digest. It sits in a corner and says so.
function renderBadge() {
  let badge = document.querySelector(".devbadge");
  if (!devOn()) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement("button");
    badge.type = "button";
    badge.className = "devbadge";
    badge.title = "Dev mode is on — this device's sessions are excluded from the daily numbers";
    badge.addEventListener("click", togglePanel);
    document.body.appendChild(badge);
  }
  const pin = read(PLATFORM_KEY);
  badge.textContent = `DEV · ${deviceId || "?"}${pin ? ` · ${pin}` : ""}`;
}

// ---------- The panel ----------
// `actions` is supplied by app.js: this file deliberately knows nothing about
// timers, combos or history, so it can be lifted into another project the same
// way audit.js can.
let actions = {};
let panel = null;
// The anonymous id this device sends with every ping, handed in by app.js.
// Shown on the badge because it is the ONLY way to tie a row in the sheet back
// to a physical device: there is no server, no account and no registry, so a
// device's id is knowable only by reading it off the device itself.
let deviceId = "";

function row(label) {
  const r = document.createElement("div");
  r.className = "devpanel__row";
  const l = document.createElement("span");
  l.className = "devpanel__label";
  l.textContent = label;
  r.appendChild(l);
  return r;
}
function button(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "devpanel__btn";
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}

function buildPanel() {
  const p = document.createElement("div");
  p.className = "devpanel";
  p.hidden = true;

  const head = document.createElement("div");
  head.className = "devpanel__head";
  const title = document.createElement("span");
  title.textContent = "Developer";
  const close = button("Close", togglePanel);
  head.appendChild(title);
  head.appendChild(close);
  p.appendChild(head);

  // --- Jump straight to the slow states ---
  const jump = row("Jump to");
  jump.appendChild(button("Finish screen", () => { hide(); actions.replayFinish && actions.replayFinish(); }));
  jump.appendChild(button("Quick session", () => { hide(); actions.quickSession && actions.quickSession(); }));
  jump.appendChild(button("Walkthrough", () => { hide(); actions.replayTour && actions.replayTour(); }));
  // The whole arrival, in order: walkthrough then home-screen card.
  jump.appendChild(button("Full first run", () => { hide(); actions.firstRun && actions.firstRun(); }));
  p.appendChild(jump);

  // --- Every install card, from whatever device is in your hand ---
  const inst = row("Install card as");
  const sel = document.createElement("select");
  sel.className = "devpanel__sel";
  for (const [value, text] of [
    ["", "this device"],
    ["ios-safari", "iPhone · Safari"],
    ["ios-other", "iPhone · Chrome"],
    ["ipad", "iPad · Safari"],
    ["android", "Android"],
    ["desktop", "Computer"],
  ]) {
    if (value && !OVERRIDE_NAMES.includes(value)) continue;
    const o = document.createElement("option");
    o.value = value; o.textContent = text;
    sel.appendChild(o);
  }
  sel.value = read(PLATFORM_KEY) || "";
  sel.addEventListener("change", () => { write(PLATFORM_KEY, sel.value || null); renderBadge(); });
  inst.appendChild(sel);

  // The one-tap prompt is the only branch a fake user-agent cannot produce —
  // it depends on the browser volunteering a beforeinstallprompt event.
  const promptWrap = document.createElement("label");
  promptWrap.className = "devpanel__check";
  const promptBox = document.createElement("input");
  promptBox.type = "checkbox";
  promptBox.checked = read(PROMPT_KEY) === "1";
  promptBox.addEventListener("change", () => write(PROMPT_KEY, promptBox.checked ? "1" : null));
  promptWrap.appendChild(promptBox);
  promptWrap.appendChild(document.createTextNode("fake one-tap prompt"));
  inst.appendChild(promptWrap);
  inst.appendChild(button("Show it", () => { hide(); actions.showInstall && actions.showInstall(); }));
  p.appendChild(inst);

  // --- Fake a history, to see what a member with one would see ---
  const streak = row("Fake streak");
  for (const n of [0, 1, 3, 7, 30]) {
    streak.appendChild(button(String(n), () => { actions.setStreak && actions.setStreak(n); }));
  }
  p.appendChild(streak);

  // --- Back to being a stranger ---
  const danger = row("Reset");
  danger.appendChild(button("Forget this device", () => {
    if (actions.wipe) actions.wipe();
  }));
  danger.appendChild(button("Dev mode off", () => {
    setDev(false);
    hide();
    renderBadge();
    location.reload();
  }));
  p.appendChild(danger);

  const note = document.createElement("p");
  note.className = "devpanel__note";
  note.textContent = `This device is ${deviceId || "unknown"}. Its sessions are tagged dev and left out of the daily numbers. Write the id down — it is the only way to match a row in the sheet back to a real device.`;
  p.appendChild(note);

  document.body.appendChild(p);
  return p;
}

function hide() { if (panel) panel.hidden = true; }
function togglePanel() {
  if (!panel) panel = buildPanel();
  panel.hidden = !panel.hidden;
}

// ---------- Wiring ----------
// Called once at boot from app.js, whether or not dev mode is currently on:
// the five-tap gesture has to be listening for the moment it gets turned on.
export function initDev(a) {
  actions = a || {};
  deviceId = (actions.deviceId || "").slice(0, 12);
  renderBadge();

  const tag = document.querySelector(".brand__tag");
  if (!tag) return;
  let taps = 0, last = 0;
  tag.addEventListener("click", () => {
    const now = Date.now();
    taps = now - last < 900 ? taps + 1 : 1; // a slow tap starts the count over
    last = now;
    if (taps >= 5) {
      taps = 0;
      setDev(!devOn());
      renderBadge();
      // Say what happened. Without this the gesture is indistinguishable from
      // nothing having happened at all.
      tag.textContent = devOn() ? "dev mode on" : "dev mode off";
      setTimeout(() => { tag.textContent = "by Boxing With Bakr"; }, 1400);
    }
  });
}
