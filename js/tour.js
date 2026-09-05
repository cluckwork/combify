// tour.js — the thirty seconds that decide whether a stranger ever presses
// start.
//
// WHY. A member opens the link Bakr sent and lands on a dark screen holding a
// ring, two rows of unlabelled-looking buttons and the word "Ready". Everyone
// who has built the app knows what that is. Nobody arriving from a text
// message does. They are one shrug away from closing the tab, and a person who
// closes the tab never finds out that the app is any good.
//
// So: on the very first visit only, dim the app and walk through it — four
// stops, one sentence each, tap anywhere to advance. It ends on the Start
// button, because the entire point is to get them to press it.
//
// RULES THIS FILE KEEPS
//   * Once. Ever. It writes a flag the moment it opens, not when it finishes,
//     so a tour abandoned halfway never ambushes anyone a second time.
//   * Always escapable. A quiet "Skip" sits in the corner from the first
//     frame; nobody is held hostage by an onboarding they didn't ask for.
//   * Never in the way of the real thing. If a target isn't on screen or has
//     no size (a narrow phone folding the layout, a headless test), that stop
//     is dropped rather than pointing the spotlight at nothing.
//
// The spotlight is one element with an enormous spread box-shadow: the div
// sits exactly over the target, and the shadow paints the darkness across the
// entire rest of the screen. One element, no SVG masks, no canvas, and it
// animates by moving a single box — which the compositor handles for free.

const KEY = "combify.tour.v1";

// Each stop names a target by selector and what to say about it. Copy is
// deliberately about what the member GETS, not what the control is called:
// "Combos get called out loud" is useful, "this is the combo display" is not.
const STOPS = [
  {
    sel: ".dial",
    text: "Your round timer. It counts the round down, rings the bell, and gives you rest between rounds.",
  },
  {
    sel: ".stage__main",
    text: "Combos appear here — and get called out loud, so you can keep your eyes up and just box.",
  },
  {
    sel: "#level",
    text: "Set your level here. Combo pace below it controls how fast they come at you.",
    also: "#pace",
  },
  {
    sel: "#startBtn",
    text: "That's everything. Hit start and shadowbox.",
  },
];

const PAD = 8;        // breathing room around the spotlit element
const BUBBLE_GAP = 14; // between the spotlight edge and the caption

export function tourSeen() {
  try { return localStorage.getItem(KEY) === "1"; } catch (e) { return true; }
}
function markSeen() {
  try { localStorage.setItem(KEY, "1"); } catch (e) {}
}
// Forget that this device has seen it, so the dev panel can replay a
// once-per-lifetime experience without clearing every other setting too.
export function resetTour() {
  try { localStorage.removeItem(KEY); } catch (e) {}
}

// Combined bounds of a stop's target(s) — `also` lets one caption cover two
// controls that are only meaningful together (level and pace).
function boundsFor(stop) {
  const els = [stop.sel, stop.also].filter(Boolean)
    .map((s) => document.querySelector(s))
    .filter(Boolean);
  if (!els.length) return null;
  let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    // Zero-sized means hidden, collapsed, or a DOM with no layout engine at
    // all (jsdom). Either way there is nothing to point at.
    if (!r.width || !r.height) continue;
    top = Math.min(top, r.top); left = Math.min(left, r.left);
    right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
  }
  if (top === Infinity) return null;
  return { top, left, width: right - left, height: bottom - top, bottom };
}

export function startTour() {
  if (tourSeen()) return false;

  const root = document.getElementById("tour");
  const spot = document.getElementById("tourSpot");
  const bubble = document.getElementById("tourBubble");
  const textEl = document.getElementById("tourText");
  const countEl = document.getElementById("tourCount");
  const skipBtn = document.getElementById("tourSkip");
  if (!root || !spot || !bubble || !textEl) return false;

  // Resolve the stops we can actually show BEFORE committing to opening. On a
  // layout where nothing measures (no layout engine, display:none app) this
  // leaves the member with the plain app rather than a black screen.
  const live = STOPS.filter((s) => boundsFor(s));
  if (!live.length) return false;

  // Written now, not at the end: an interrupted tour still counts as asked.
  markSeen();

  let i = 0;

  function render() {
    const stop = live[i];
    const b = boundsFor(stop);
    if (!b) { finish(); return; }

    spot.style.top = `${b.top - PAD}px`;
    spot.style.left = `${b.left - PAD}px`;
    spot.style.width = `${b.width + PAD * 2}px`;
    spot.style.height = `${b.height + PAD * 2}px`;

    textEl.textContent = stop.text;
    if (countEl) countEl.textContent = `${i + 1} of ${live.length}`;

    // The caption goes below the spotlight when there's room beneath it, and
    // above when there isn't — with the arrow flipped to match, so it always
    // points back at the thing being described.
    const vh = window.innerHeight || 0;
    const below = b.bottom + BUBBLE_GAP + 130 < vh;
    bubble.dataset.side = below ? "below" : "above";
    bubble.style.top = below ? `${b.bottom + PAD + BUBBLE_GAP}px` : "auto";
    bubble.style.bottom = below ? "auto" : `${vh - (b.top - PAD) + BUBBLE_GAP}px`;
    // Horizontally the bubble is centred on the target but never allowed off
    // screen; the arrow is then nudged back so it stays over the target even
    // when the bubble has been pushed sideways.
    const bw = Math.min(320, (window.innerWidth || 320) - 32);
    const centre = b.left + b.width / 2;
    const bx = Math.max(16, Math.min(centre - bw / 2, (window.innerWidth || 320) - bw - 16));
    bubble.style.width = `${bw}px`;
    bubble.style.left = `${bx}px`;
    bubble.style.setProperty("--arrow-x", `${Math.max(18, Math.min(centre - bx, bw - 18))}px`);
  }

  function next() {
    i += 1;
    if (i >= live.length) { finish(); return; }
    render();
  }

  function finish() {
    root.hidden = true;
    root.removeEventListener("click", onClick);
    window.removeEventListener("resize", render);
    window.removeEventListener("orientationchange", render);
    document.removeEventListener("keydown", onKey);
  }

  function onClick(e) {
    if (skipBtn && (e.target === skipBtn || skipBtn.contains(e.target))) { finish(); return; }
    next();
  }
  function onKey(e) {
    if (e.key === "Escape") finish();
    else if (e.key === "Enter" || e.key === " ") { next(); e.preventDefault(); }
  }

  root.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey);
  // Rotating the phone mid-tour moves every target; re-measure rather than
  // leaving the spotlight sitting over empty space.
  window.addEventListener("resize", render);
  window.addEventListener("orientationchange", render);

  root.hidden = false;
  render();
  return true;
}
