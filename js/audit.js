// audit.js — an on-device flight recorder for what the app actually does.
//
// The test harness cannot see what a real iPhone does to the audio pipeline
// (stale events, slow seeks, the silent switch) — the v1.13.0 ghost-words
// revert proved that the hard way, and the rule since is that audio changes
// need real-device evidence. This closes the gap from the device's side:
// with audit mode ON, every audio-relevant event is stamped into a ring
// buffer ON THE PHONE, and the log is copied out afterwards. "It stuttered
// on pivot" becomes "a second ended event hit pivot's element 340ms into
// its next play" — a diagnosis instead of a guess.
//
// How to use it (this is the founder-facing contract, wired up in app.js):
//   1. Tap the version number in the footer five times → "audit on".
//   2. Run a training session normally. Recording survives reload.
//   3. Back on the settings screen, tap "Copy audit log", paste it to the
//      developer. Five more taps on the version turns it off.
//
// Costs nothing when off — every call is one boolean test. When on, a call
// is one object push; no DOM, no string formatting until dump time.
//
// Deliberately generic — nothing in this file knows it lives in a boxing
// app — so it can be lifted whole into any future project.

const KEY = "combify.audit";
const CAP = 4000; // ring buffer; a long session logs well under this
const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

let enabled = false;
try { enabled = localStorage.getItem(KEY) === "1"; } catch (e) {}
let buf = [];
let dropped = 0; // how many early entries the ring displaced
let t0 = now();

export function auditOn() { return enabled; }

export function setAudit(on) {
  enabled = !!on;
  buf = []; dropped = 0; t0 = now();
  try { on ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch (e) {}
}

// One event. tag is a short fixed word ("word", "sfx", "phase"); detail is
// anything cheap to build — prefer passing pieces over pre-formatting.
export function audit(tag, detail) {
  if (!enabled) return;
  if (buf.length >= CAP) { buf.splice(0, CAP >> 2); dropped += CAP >> 2; }
  buf.push({ t: now() - t0, tag, d: detail == null ? "" : String(detail) });
}

// The whole story as text, oldest first, millisecond timestamps relative to
// when audit mode was armed (or the buffer last cleared). Ends with a
// uniformity report built from ":out" events (detail format "key +Nms",
// where N is the delay between asking for the sound and hearing it): per
// sound, how many played, how consistent the start latency was, and how
// even the gaps between successive onsets were. Uneven numbers here ARE the
// "glitchy blips / off-tempo ticks" complaints, made measurable.
export function auditDump(header) {
  const lines = buf.map((e) => `${String(Math.round(e.t)).padStart(8)}  ${e.tag}${e.d ? "  " + e.d : ""}`);
  const head = (header ? header + "\n" : "")
    + `events: ${buf.length}${dropped ? ` (ring dropped ${dropped} older)` : ""}\n`;

  const series = {};
  for (const e of buf) {
    if (!e.tag.endsWith(":out")) continue;
    const m = /^(\S+) \+(\d+)ms$/.exec(e.d);
    if (!m) continue;
    const k = `${e.tag} ${m[1]}`;
    (series[k] = series[k] || []).push({ t: e.t + Number(m[2]), lat: Number(m[2]) });
  }
  const rows = [];
  for (const [k, s] of Object.entries(series)) {
    if (s.length < 2) continue;
    const lats = s.map((x) => x.lat);
    // Gaps only within a burst (< 2s apart) — a tick during round 1 and one
    // during round 2 are not a rhythm.
    const gaps = [];
    for (let i = 1; i < s.length; i++) {
      const g = s[i].t - s[i - 1].t;
      if (g < 2000) gaps.push(Math.round(g));
    }
    let row = `  ${k}: n=${s.length} latency ${Math.min(...lats)}-${Math.max(...lats)}ms`;
    if (gaps.length >= 2) row += ` gaps ${Math.min(...gaps)}-${Math.max(...gaps)}ms`;
    rows.push(row);
  }
  const uniformity = rows.length ? `\n\nonset uniformity:\n${rows.join("\n")}` : "";
  return head + lines.join("\n") + uniformity;
}
