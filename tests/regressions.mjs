// regressions.mjs — a tripwire for bugs this project has already shipped once.
//
// WHY THIS EXISTS. The behaviour suites are good and they catch a great deal,
// but they share a blind spot: a test can only fail on a pathway someone
// thought to check. The iOS silent-switch bug shipped three times — v1.5.0,
// v1.7.1, and again in v2.0.0 — and the third time the whole suite stayed
// green, because the tests asserted that the bell SOUNDS (it did, in jsdom)
// and nothing asserted the invariant underneath: that the silent keeper's
// source stays attached. A different mechanism reached the same old symptom
// through a door no test was watching.
//
// So this file guards INVARIANTS IN THE SOURCE, not behaviour. It is fast,
// it runs before anything else, and when it trips it does not say "assertion
// failed" — it names the bug, when it shipped, what a member heard, and why
// the line you just wrote brings it back.
//
// IT DOES NOT REPLACE THE TESTS. It is a second net with a different weave.
// Behaviour tests catch bugs nobody predicted; this catches the ones we have
// already paid for. Neither is sufficient. A regression should ideally end up
// with BOTH: a behaviour test proving the fix, and a rule here proving the
// cause cannot be retyped.
//
// WHY YOU CAN TRUST IT. Every rule carries a `selfTest` — a snippet that MUST
// trip it. Before checking the real source, the runner applies each rule to
// its own snippet and fails loudly if the rule does not fire. A rule that has
// silently stopped working can therefore never sit here looking reassuring;
// it breaks the build the moment it goes blind. That is the property the
// behaviour suite lacked, and the reason this file is worth having.
//
// WHEN A NEW BUG IS FOUND: fix it, write the behaviour test, then add a rule
// here with its history and a selfTest. The list only ever grows.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => { try { return fs.readFileSync(path.join(REPO, f), "utf8"); } catch (e) { return ""; } };

// Comments describe bugs — this very file quotes `removeAttribute("src")` while
// explaining why not to write it — so they must be stripped before any rule
// hunts for code.
//
// LINE COMMENTS FIRST, and that order is load-bearing. audio.js contains the
// line `// (audio/sfx/*.mp3, rendered from ...)`. Stripping block comments
// first, the `/*` in that PROSE opened a match that ran to the next `*/` four
// hundred lines later and swallowed playSfx along with it — after which two
// rules reported "not found" and read as failures. The `[^:]` guard keeps
// https:// in URLs from looking like a comment.
const stripComments = (src) =>
  src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

// Pull out one function's body by BALANCING BRACES rather than by regex. The
// first version of this file matched `function name(...) { ... \n}` and broke
// the moment a nested block sat at column 0 — reporting "not found", which a
// rule then read as a failure. A rule that cannot locate its subject must say
// so loudly (it is blind, not passing), but it should not be that fragile.
function fnBody(src, name) {
  // Both spellings this codebase uses: `function name(` and `const name = (`.
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) start = src.indexOf(`const ${name} = (`);
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

const REGRESSIONS = [
  {
    id: "keeper-attached",
    file: "js/audio.js",
    shipped: "v1.5.0, v1.7.1, and again in v2.0.0",
    symptom: "Every sound except the voice goes silent with the iPhone silent switch on.",
    why:
      "A looping media element is what puts the page on iOS's media channel, and that is the\n" +
      "  ONLY reason Web Audio (bells, ticks, warnings, blips) ignores the hardware switch.\n" +
      "  The voice plays through audio elements and is unaffected, which is why the failure\n" +
      "  looks so specific. Detaching the keeper's source retires a lock-screen card and takes\n" +
      "  the protection with it. Pausing is as far as it may go.",
    test: (src) => /silenceEl\s*\.\s*removeAttribute|silenceEl\s*\.\s*src\s*=\s*["'`]\s*["'`]/.test(src)
      ? "the silence keeper's source is being detached" : null,
    selfTest: `function stop(){ silenceEl.removeAttribute("src"); silenceEl.load(); }`,
  },
  {
    id: "keeper-live-gate",
    file: "js/audio.js",
    shipped: "v2.1.3",
    symptom: "All sound effects vanish while the voice keeps calling combos — most often on a second session.",
    why:
      "Web Audio is preferred for every bell/tick/warning/blip because media elements were\n" +
      "  105-124ms late. It is muted by the ring/silent switch, and the ONLY thing holding that\n" +
      "  off is the looping keeper putting the page on iOS's media channel. So the gate on that\n" +
      "  path must ask whether the keeper is sounding RIGHT NOW. `silenceOk` cannot answer it:\n" +
      "  it is a latch set when play() resolved, and iOS pauses media elements on any\n" +
      "  interruption without running our code. A latch left up over a dead keeper sends every\n" +
      "  cue into a muted context AND returns true, so the element fallback never runs.",
    test: (src) => {
      const body = fnBody(src, "playSfxBuffer");
      if (body == null) return "playSfxBuffer not found — this rule needs updating";
      if (/\bkeeperLive\s*\(/.test(body)) return null;
      return "playSfxBuffer gates on something other than a live keeper check";
    },
    selfTest: `function playSfxBuffer(key, rate){\n  if (!silenceOk || !sfxBuffers[key]) return false;\n  return true;\n}`,
  },
  {
    id: "flame-body-not-additive",
    file: "js/flame.js",
    shipped: "never — caught in development, recorded so it cannot come back",
    symptom: "The middle of the flame is a featureless white blob however the bands are tuned.",
    why:
      "The celebration canvas composites with 'lighter' throughout, which is right for motes,\n" +
      "  glow and embers. It is catastrophic for the cel bands: fifteen tongues times four\n" +
      "  bands saturate to flat white wherever they cross, so the body loses all its colour\n" +
      "  structure. renderFlame MUST switch to source-over before painting shapes. Painted\n" +
      "  shapes occlude; only light adds.",
    test: (src) => {
      const body = fnBody(src, "renderFlame");
      if (body == null) return "renderFlame not found — this rule needs updating";
      return /globalCompositeOperation\s*=\s*["\`']source-over/.test(body)
        ? null : "renderFlame never leaves additive compositing";
    },
    selfTest: `function renderFlame(g, t){ g.globalAlpha = 1; g.fill(); }`,
  },
  {
    id: "flame-loop-released",
    file: "js/flame.js",
    shipped: "never — a battery leak, not a visual bug, so nothing would report it",
    symptom: "The phone keeps drawing frames after the celebration ends.",
    why:
      "This is a full-screen canvas running an animation loop. If stop() ever stops calling\n" +
      "  cancelAnimationFrame, the loop survives the sequence and burns battery for the rest\n" +
      "  of the page's life. Nobody would report it — the screen looks finished — so the only\n" +
      "  thing that can catch it is this rule.",
    test: (src) => {
      const body = fnBody(src, "stop");
      if (body == null) return "stop() not found — this rule needs updating";
      return /cancelAnimationFrame/.test(body) ? null : "stop() never cancels the animation frame";
    },
    selfTest: `function stop(){ playing = false; raf = 0; }`,
  },
  {
    id: "sfx-unmute",
    file: "js/audio.js",
    shipped: "v2.0.1",
    symptom: "The countdown plays one tick and then goes quiet for the rest of the session.",
    why:
      "primeElement MUTES an element, plays it, pauses it and unmutes it. If anything in the\n" +
      "  middle throws — iOS rejects a pause racing an unresolved play — the unmute is skipped\n" +
      "  and nothing else turns it back on. playWord has always unmuted again at play time;\n" +
      "  playSfx must do the same or sound effects stay silent while the voice recovers.",
    test: (src) => {
      const body = fnBody(src, "playSfx");
      if (body == null) return "playSfx not found — this rule needs updating";
      return /\bmuted\s*=\s*false/.test(body) ? null : "playSfx never unmutes before playing";
    },
    selfTest: `function playSfx(key){ const node = pool[0]; node.play(); }\n`,
  },
  {
    id: "no-double-rewind",
    file: "js/audio.js",
    shipped: "v1.7.1",
    symptom: 'Words stutter ("p-pivot", "e-eight") and the end bells strike double.',
    why:
      "play() rewinds an element that ENDED on its own, as part of the spec'd play algorithm.\n" +
      "  Issuing our own currentTime=0 on top of that is a second, ASYNCHRONOUS seek racing the\n" +
      "  internal one: attack, jump, attack again. Every rewind at play time must be guarded by\n" +
      "  !ended. Rewinding in idle (park sites) is the safe pattern and is exempt.",
    // Scoped to the two PLAY-TIME functions on purpose. Rewinding in idle — the
    // park sites, primeElement, stopVoice — is the safe pattern this codebase
    // deliberately uses, and a whole-file scan flagged those as violations.
    // The invariant is narrow: at the moment of playing, never seek an element
    // that ended on its own.
    test: (src) => {
      for (const name of ["playSfx", "playWord"]) {
        const body = fnBody(src, name);
        if (body == null) return `${name} not found — this rule needs updating`;
        for (const line of body.split("\n")) {
          if (!/currentTime\s*=\s*0/.test(line)) continue;
          if (/\bended\b/.test(line)) continue;   // guarded — correct
          // Pausing something and THEN rewinding it is the safe pause-site
          // pattern: it stops an outgoing element, it does not seek the one
          // about to play. playWord legitimately does this to the previous
          // word before starting the next.
          if (/\.pause\s*\(/.test(line)) continue;
          return `${name} rewinds without an !ended guard: ${line.trim().slice(0, 70)}`;
        }
      }
      return null;
    },
    // Defines both functions the rule inspects, so the snippet exercises the
    // real check rather than tripping on a missing subject.
    selfTest: `function playSfx(n){ n.muted = false; n.play(); }\n`
      + `const playWord = (key) => { node.currentTime = 0; node.play(); };`,
  },
  {
    id: "svg-style-flush",
    file: "js/app.js",
    shipped: "v2.0.0",
    symptom: "The countdown ring draws itself in from empty before counting down.",
    why:
      "offsetWidth is an HTMLElement property. Reading it on an SVG element returns undefined,\n" +
      "  forces NO style recalculation, and a disable/write/restore sequence collapses into one\n" +
      "  recalc in which the browser sees only 'transition on, value changed' and animates.\n" +
      "  Flush an SVG with getComputedStyle(el).<property> instead.",
    test: (src) => /(dialFill|dial__ring|ring__track)[^\n]*offsetWidth/.test(src)
      ? "offsetWidth used to flush style on an SVG element" : null,
    selfTest: `el.dialFill.style.transition = "none"; void el.dialFill.offsetWidth;`,
  },
  {
    id: "inline-animation-none",
    file: "js/app.js",
    shipped: "v2.0.0",
    symptom: "The countdown's shockwave never appears, though the code looks correct.",
    why:
      "An inline `style.animation = \"none\"` silently outranks a class-driven animation, so the\n" +
      "  class goes on exactly as designed and the browser never runs a frame. If anything sets\n" +
      "  it, something must clear it with removeProperty('animation').",
    test: (src) => /style\.animation\s*=\s*["'`]none["'`]/.test(src)
        && !/removeProperty\(\s*["'`]animation["'`]\s*\)/.test(src)
      ? "an inline animation:none is set and never cleared" : null,
    selfTest: `pulse.style.animation = "none";`,
  },
  {
    id: "window-history",
    file: "js/app.js",
    shipped: "v2.0.0",
    symptom: "An internal ?ath=1 parameter is left sitting in the address bar.",
    why:
      "This module declares its own module-level `history` (the member's training log), which\n" +
      "  SHADOWS window.history. Written bare, `history.replaceState` is silently undefined and\n" +
      "  the guard around it quietly does nothing. Spell out window.history here.",
    test: (src) => /(^|[^.\w])history\s*\.\s*(replaceState|pushState)/m.test(src)
      ? "history.replaceState used without the window. prefix" : null,
    selfTest: `if (history.replaceState) history.replaceState(null, "", u);`,
  },
  {
    id: "localhost-telemetry",
    file: "js/app.js",
    shipped: "v1.9.5",
    symptom: "A day of development shows up in the digest as 94 unique members.",
    why:
      "The layout suite drives a real browser with real network access and runs real sessions,\n" +
      "  so every test run files genuine-looking rows into the production sheet — and each fresh\n" +
      "  browser context mints a new anonymous id, so each looks like a different person. Local\n" +
      "  development does the same. pingUsage must refuse to report from a local host.",
    test: (src) => {
      const fn = /function pingUsage\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src);
      if (!fn) return "pingUsage not found — this rule needs updating";
      return /isLocalHost\(\)/.test(fn[1]) ? null : "pingUsage has no localhost guard";
    },
    selfTest: `function pingUsage(kind){\n  fetch(FORM, { method: "POST" });\n}\n`,
  },
  {
    id: "layout-tests-sealed",
    file: "tests/layout.mjs",
    shipped: "v1.9.5",
    symptom: "The same 94 fictional members, filed by the test suite itself.",
    why:
      "Belt and braces over the app's own guard: every browser context this suite opens must\n" +
      "  abort requests to telemetry hosts, so a regression in that guard breaks a test instead\n" +
      "  of turning up in a digest days later.",
    test: (src) => {
      const contexts = (src.match(/\.newContext\(/g) || []).length;
      const sealed = (src.match(/sealContext\(/g) || []).length - 1; // minus the definition
      return sealed >= contexts ? null
        : `${contexts} browser contexts but only ${sealed} sealed against telemetry`;
    },
    selfTest: `async function f(){ const ctx = await browser.newContext({}); }`,
  },
  {
    id: "changelog-brevity",
    file: "js/changelog.js",
    shipped: "v2.0.0",
    symptom: "The changelog reads as paragraphs nobody skims.",
    why:
      "House style: every line is a claim, not a paragraph. A note over 30 words is doing too\n" +
      "  much and should be split or cut.",
    test: (src) => {
      const long = [];
      for (const m of src.matchAll(/"((?:[^"\\]|\\.){60,})"/g)) {
        const words = m[1].split(/\s+/).length;
        if (words > 30) long.push(`${words} words: ${m[1].slice(0, 50)}…`);
      }
      return long.length ? `${long.length} note(s) too long — ${long[0]}` : null;
    },
    selfTest: '"' + Array.from({ length: 40 }, (_, i) => "word" + i).join(" ") + '"',
  },
  {
    id: "tour-brevity",
    file: "js/tour.js",
    shipped: "v1.10.2",
    symptom: "The walkthrough is read standing in a gym over a dimmed screen.",
    why: "Every stop stays one breath — roughly a dozen words, and never more than fourteen.",
    test: (src) => {
      const long = [];
      for (const m of src.matchAll(/text:\s*"((?:[^"\\]|\\.)*)"/g)) {
        const words = m[1].split(/\s+/).length;
        if (words > 14) long.push(`${words} words: ${m[1].slice(0, 40)}…`);
      }
      return long.length ? long[0] : null;
    },
    selfTest: 'text: "' + Array.from({ length: 20 }, (_, i) => "w" + i).join(" ") + '",',
  },
];

// ---------------------------------------------------------------- the runner
const lines = [];
let pass = 0, fail = 0, blind = 0;

// SELF-TEST FIRST. A rule that has stopped detecting its own bug is worse than
// no rule at all, because it sits in the list looking like protection.
for (const r of REGRESSIONS) {
  if (!r.selfTest) { blind++; lines.push(`  ⚠️  ${r.id}: no selfTest — this rule is unproven`); continue; }
  if (r.test(r.selfTest)) continue;
  blind++;
  lines.push(`  ⚠️  ${r.id}: RULE IS BLIND — it no longer catches its own bug`);
}

for (const r of REGRESSIONS) {
  const src = stripComments(read(r.file));
  if (!src) { blind++; lines.push(`  ⚠️  ${r.id}: ${r.file} unreadable`); continue; }
  const hit = r.test(src);
  if (!hit) { pass++; lines.push(`  ✅ ${r.id}`); continue; }
  fail++;
  lines.push("");
  lines.push(`  ❌ ${r.id}  —  ${r.file}`);
  lines.push(`     ${hit}`);
  lines.push(`     THIS BUG ALREADY SHIPPED: ${r.shipped}`);
  lines.push(`     What a member heard: ${r.symptom}`);
  lines.push(`     ${r.why}`);
  lines.push("");
}

console.log("\n── regression tripwires ──");
console.log(lines.join("\n"));
const bar = "=".repeat(52);
console.log(`\n${bar}\n  regressions: ${pass} clear, ${fail} tripped` +
  (blind ? `, ${blind} BLIND RULE(S)` : "") + `\n${bar}`);
if (fail || blind) {
  console.log("\nA tripped rule means a bug this project has already paid for is being");
  console.log("retyped. Read the history above before deciding it is a false alarm.");
}
process.exit(fail || blind ? 1 : 0);
