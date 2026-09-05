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

// Each stop names a target by selector and what to say about it.
//
// TWO COPY RULES. Say what the member GETS, not what the control is called —
// "combos get called out loud" is useful, "this is the combo display" is not.
// And keep every line to one breath: this is read standing in a gym, over a
// dimmed screen, by someone who has not decided yet whether to bother. Each
// stop earns roughly a dozen words, and the spotlight is already showing them
// WHICH thing is being described, so the words never have to locate it too.
const STOPS = [
  {
    sel: ".dial",
    text: "Your round timer — counts down, rings the bell, times your rest.",
  },
  {
    sel: ".stage__main",
    text: "Combos appear here, and get called out loud.",
  },
  {
    sel: "#level",
    text: "Pick your level, and how fast the combos come.",
    also: "#pace",
  },
  {
    // Collapsed by default, so most people never discover that round length is
    // adjustable at all — they assume the 2-minute default is the whole app.
    // Naming what is inside is the entire point: "More options" alone tells
    // you nothing about whether it is worth opening.
    sel: ".more",
    text: "Rounds and work/rest times are in here.",
  },
  {
    sel: "#startBtn",
    text: "That's it — hit start.",
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

export function startTour(onDone) {
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

  // `animate` glides the spotlight between stops. It must be OFF for
  // scroll-driven redraws: a 0.28s ease chasing a finger makes the spotlight
  // lag behind the thing it is supposed to be pointing at, which reads as the
  // overlay being broken rather than smooth.
  function render(animate) {
    const stop = live[i];
    const b = boundsFor(stop);
    if (!b) { finish(); return; }

    spot.style.transition = animate ? "" : "none";

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
    // Bring the next target into view before measuring it. The settings live
    // below the fold on a short phone, and a spotlight drawn around something
    // off screen is just a dark screen with a rectangle in it.
    const stop = live[i];
    const target = document.querySelector(stop.sel);
    if (target && target.scrollIntoView) {
      try { target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
    }
    render(true);
  }

  // The spotlight is positioned in viewport coordinates, so ANY scroll moves
  // the target out from under it. Without this the whole overlay slides off
  // the thing it is describing the moment someone flicks the page — which is
  // exactly what it looked like: a caption stuck to the screen, pointing at
  // nothing. Passive, and it only writes styles, so it stays cheap.
  const onScroll = () => render(false);

  function finish() {
    if (root.hidden) return;   // finish() can be reached twice (skip during the last stop)
    root.hidden = true;
    root.removeEventListener("click", onClick);
    window.removeEventListener("resize", onScroll);
    window.removeEventListener("orientationchange", onScroll);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("keydown", onKey);
    if (typeof onDone === "function") { try { onDone(); } catch (e) {} }
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
  // Rotating the phone or scrolling mid-tour moves every target; re-measure
  // rather than leaving the spotlight sitting over empty space. The capturing
  // document listener catches scrolls inside a scrolling child element, which
  // never reach window.
  window.addEventListener("resize", onScroll);
  window.addEventListener("orientationchange", onScroll);
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("scroll", onScroll, true);

  root.hidden = false;
  render(false);
  return true;
}
