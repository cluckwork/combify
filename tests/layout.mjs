// layout.mjs — real-browser layout checks across devices and orientations.
//
// The behavioural suite (run.mjs) uses jsdom, which does no layout at all: it
// cannot tell you that text overflows, that a button is off-screen, or that
// rotating the phone mid-round breaks the screen. This drives a real Chromium
// so those questions have real answers.
//
//   node tests/layout.mjs            (add --shots to write PNGs to tests/.shots)
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import http from "node:http";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SHOTS = process.argv.includes("--shots");
// --only <substring> runs a single device, which turns a ~5 minute full sweep
// into ~30 seconds when you already know which layout you're fixing.
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i > -1 ? process.argv[i + 1] : null; })();
// --fast shortens the in-session waits; enough to reach every screen, not
// enough to sit through realistic rounds.
const FAST = process.argv.includes("--fast");
// How many devices run at once. The suite is dominated by WAITING (a 3s
// countdown, a round playing out) rather than CPU, so overlapping devices
// collapses the wall clock even on a 2-core box. --jobs 1 restores the old
// serial behaviour if a run ever needs isolating.
const JOBS = (() => {
  const i = process.argv.indexOf("--jobs");
  const n = i > -1 ? parseInt(process.argv[i + 1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 6; // 6 = every device at once
})();

// Fixed-size worker pool preserving input order in the results.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  }));
  return out;
}
const shotDir = path.join(HERE, ".shots");

let pass = 0, fail = 0;
const lines = [];
const check = (name, cond, detail = "") => {
  if (cond) { pass++; lines.push(`    ✅ ${name}`); }
  else { fail++; lines.push(`    ❌ ${name}${detail ? "  → " + detail : ""}`); }
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".png": "image/png", ".svg": "image/svg+xml" };
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(REPO, rel === "/" ? "index.html" : rel);
      if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("nope"); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, () => resolve(server));
  });
}

const DEVICES = [
  { name: "iPhone portrait",  width: 390, height: 844,  dpr: 3, mobile: true },
  { name: "iPhone landscape", width: 844, height: 390,  dpr: 3, mobile: true },
  { name: "small phone",      width: 320, height: 568,  dpr: 2, mobile: true },
  { name: "iPad portrait",    width: 820, height: 1180, dpr: 2, mobile: true },
  { name: "Mac window",       width: 1440, height: 900, dpr: 2, mobile: false },
  { name: "Mac fullscreen",   width: 1920, height: 1080, dpr: 2, mobile: false },
];

// Measurements taken inside the page.
const probe = () => {
  const q = (s) => document.querySelector(s);
  const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right, top: r.top }; };
  const fs = (s) => { const e = q(s); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; };
  const vis = (s) => {
    const e = q(s); if (!e) return false;
    const st = getComputedStyle(e); const r = e.getBoundingClientRect();
    return st.display !== "none" && st.visibility !== "hidden" && parseFloat(st.opacity) > 0.01 && r.width > 0 && r.height > 0;
  };
  // Do any two things that should never touch actually overlap? Measuring
  // "nothing overflows" missed a landscape screen where the clock sat directly
  // on top of the combo — each box was inside the stage, they just collided.
  const overlaps = [];
  const pairs = [["#clock", "#combo"], ["#clock", "#comboName"], ["#round", "#combo"],
                 ["#phase", "#combo"], [".stage__meta", ".stage__main"], ["#combo", ".controls"],
                 ["#stats", ".controls"]];
  for (const [a, b] of pairs) {
    const ea = q(a), eb = q(b);
    if (!ea || !eb) continue;
    const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
    if (!ra.width || !rb.width || !ra.height || !rb.height) continue;
    const hit = ra.left < rb.right - 1 && rb.left < ra.right - 1 &&
                ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1;
    if (hit) overlaps.push(`${a}×${b}`);
  }
  return {
    overlaps,
    vw: window.innerWidth, vh: window.innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    focus: q(".app").dataset.focus,
    stage: box("#stage"), combo: box("#combo"), clock: box("#clock"),
    controls: box(".controls"), stats: box("#stats"), startBtn: box("#startBtn"),
    comboFont: fs("#combo"), clockFont: fs("#clock"),
    heroFont: fs(".finish__hero .stat-num"),
    comboText: q("#combo").textContent,
    comboScrollW: q("#combo").scrollWidth, comboClientW: q("#combo").clientWidth,
    clockScrollW: q("#clock").scrollWidth, clockClientW: q("#clock").clientWidth,
    dial: box(".dial"), meta: box(".stage__meta"),
    ringVisible: (() => { const e = q(".dial__ring"); if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== "none" && r.width > 0; })(),
    clockTextW: (() => { const r = document.createRange(); r.selectNodeContents(q("#clock")); return r.getBoundingClientRect().width; })(),
    stageScrollH: q("#stage").scrollHeight, stageClientH: q("#stage").clientHeight,
    settingsVisible: vis("#settings"), topbarVisible: vis(".topbar"),
    controlsVisible: vis(".controls"),
  };
};

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/index.html`;

// BELT AND BRACES over js/app.js's own localhost guard. This suite drives a
// real browser with real network access and runs real sessions to completion,
// so a regression in that guard means production telemetry filling up with
// rows minted by this repo — which is exactly what happened, once, to the tune
// of 94 fictional "members" in a single afternoon. Every request to a
// telemetry host is aborted at the browser, and recorded so a test can fail on
// it rather than the damage being discovered in a daily digest.
const TELEMETRY_HOSTS = /docs\.google\.com|formsubmit\.co/;
async function sealContext(ctx) {
  const escaped = [];
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (TELEMETRY_HOSTS.test(url)) { escaped.push(url); return route.abort(); }
    return route.continue();
  });
  return escaped;
}
const browser = await chromium.launch();
if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });

// Clicks are dispatched inside the page rather than through page.click(). A
// real Playwright click carries a user gesture, so the app requests genuine
// fullscreen — and that call parked page.click() for ~5 SECONDS, long enough
// that the 3s countdown was over before any assertion about it could run (the
// countdown-steps check was silently measuring the work phase). Layout here is
// driven by data-focus and 100dvh, which behave identically either way; the
// real fullscreen lifecycle is covered in run.mjs (section 10b).
const tap = (page, id = "startBtn") => page.evaluate((i) => document.getElementById(i).click(), id);

// Headless Chromium freezes CSS transitions while the page sits idle: 3.6s
// into a session the fold-away had reached only 4% opacity, because nothing
// had woken the renderer since the click. waitForFunction polls on animation
// frames, so it both wakes the page and waits for the real end state rather
// than guessing a duration. Never fails the run on its own — the assertion
// that follows is what reports.
// Measures rendered HEIGHT, not opacity: the two properties have different
// durations (0.18s vs 0.35s), so opacity hits zero while the panels still
// occupy a few hundred pixels — which is what "edge-to-edge" actually cares
// about.
const settled = (page, hidden) => page.waitForFunction(
  (want) => [document.querySelector(".topbar"), document.getElementById("settings"), document.querySelector(".about")]
    .every((e) => { const h = e.getBoundingClientRect().height; return want ? h < 1 : h > 1; }),
  hidden, { timeout: 5000 }).catch(() => {});

// Wait for the app to actually REACH a phase instead of sleeping a guessed
// duration. Returns the moment it happens rather than always burning the
// worst case, and because waitForFunction polls on animation frames it keeps
// the renderer awake — headless otherwise throttles it, freezing the very
// timers and transitions being waited on.
const reachPhase = (page, want, timeout) => page.waitForFunction(
  (w) => document.getElementById("stage").dataset.phase === w, want, { timeout }).catch(() => {});

// Drive a session to a given phase, with the clock sped up so it's quick.
async function startSession(page, { work = 8, rest = 5, rounds = 2 } = {}) {
  await page.evaluate(({ work, rest, rounds }) => {
    document.getElementById("workSec").dataset.value = work;
    document.getElementById("workSec").querySelector(".step__val").textContent = work;
    document.getElementById("restSec").dataset.value = rest;
    document.getElementById("restSec").querySelector(".step__val").textContent = rest;
    document.getElementById("rounds").dataset.value = rounds;
    document.getElementById("rounds").querySelector(".step__val").textContent = rounds;
  }, { work, rest, rounds });
  await tap(page);
}

// One device, self-contained: its own tallies so devices can run concurrently
// without interleaving each other's output. `check` and `lines` deliberately
// shadow the module-level ones.
async function runDevice(dev) {
  let pass = 0, fail = 0;
  const lines = [];
  const check = (name, cond, detail = "") => {
    if (cond) { pass++; lines.push(`    ✅ ${name}`); }
    else { fail++; lines.push(`    ❌ ${name}${detail ? "  → " + detail : ""}`); }
  };
  lines.push(`\n── ${dev.name} (${dev.width}×${dev.height}) ──`);
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dpr, isMobile: dev.mobile, hasTouch: dev.mobile,
  });
  const escaped = await sealContext(ctx);
  const page = await ctx.newPage();
  // Log every unmuted sfx play with a timestamp, so the finale can prove the
  // count-up stays silent until its numbers are actually on screen.
  await page.addInitScript(() => {
    // The first-run walkthrough (js/tour.js) covers the whole screen with a
    // spotlight overlay, which would sit in front of every measurement and
    // every screenshot below. A fresh browser context is a first run by
    // definition, so mark it seen before the app boots.
    try { localStorage.setItem("combify.tour.v1", "1"); } catch (e) {}
    window.__sfxLog = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted && this.src) window.__sfxLog.push({ src: this.src.split("/").pop(), t: performance.now() });
      return orig.call(this);
    };
    // Sfx go through Web Audio buffers when decoded (v1.15). Tell the blip
    // apart by decoded length: blip.wav is exactly 0.070s, the next-shortest
    // (tick.wav) 0.090s — 0.08 splits two fixed values with margin.
    const bs = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
      const blip = this.buffer && this.buffer.duration > 0 && this.buffer.duration <= 0.08;
      window.__sfxLog.push({ src: blip ? "blip-buffer" : "sfx-buffer", t: performance.now() });
      return bs.apply(this, a);
    };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });

  // ---- Ready screen ----
  let m = await page.evaluate(probe);
  check("no horizontal scrolling on the ready screen", m.docScrollW <= m.docClientW + 1, `${m.docScrollW} > ${m.docClientW}`);
  // No dead space under the footer. min-height:100dvh used to sit on BOTH body
  // and .app, and iOS browsers do not reliably resolve dvh to the toolbar-shown
  // height — so the page was sized to the taller toolbar-hidden viewport and
  // the difference became a screen of scrollable nothing below the content.
  // Anything past the app's own 40px bottom padding is that bug returning.
  const dead = await page.evaluate(() => {
    const de = document.documentElement;
    const footBottom = document.querySelector(".foot").getBoundingClientRect().bottom + window.scrollY;
    // Only space past BOTH the content and the viewport is dead. A document is
    // always at least viewport-tall, and on a big screen that gap sits below
    // the footer without being scrollable — measuring against the footer alone
    // flagged every desktop layout.
    return Math.round(de.scrollHeight - Math.max(footBottom, de.clientHeight));
  });
  check("no dead scroll space below the footer", dead <= 70, `${dead}px of nothing under the last element`);
  check("settings visible before starting", m.settingsVisible);
  check("Start button on screen", m.controls && m.controls.bottom <= m.vh + 1, `controls bottom ${m.controls?.bottom} vs ${m.vh}`);
  // The ring is decorative — but if it renders, the time must genuinely sit
  // inside it. Short-landscape once shipped a ~100px ring with the clock
  // bursting out of it, and every box-based check called that fine.
  check("ready: time inside the ring, or ring hidden", !m.ringVisible || m.clockTextW <= m.dial.w * 0.86,
    `clock text ${Math.round(m.clockTextW)} vs ring ${Math.round(m.dial?.w)}`);
  if (SHOTS) await page.screenshot({ path: path.join(shotDir, `${dev.name.replace(/\s+/g, "-")}-ready.png`) });

  // ---- Mid-round (focus mode) ----
  // work must outlast every probe, screenshot and pause below, or the session
  // finishes mid-assertion and focus mode is already gone (a 4s work phase
  // failed exactly that way once --shots was added).
  await startSession(page, FAST ? { work: 14, rest: 2, rounds: 1 } : undefined);
  // NOTE: the countdown's stepping is asserted in run.mjs (section 10e), not
  // here. Headless Chromium throttles timers until an evaluate() wakes the
  // renderer, so the 3s countdown either freezes or fires in a burst that the
  // app's real-time catch-up correctly skips through — neither of which says
  // anything about the ring. The virtual clock in jsdom answers it exactly.
  await reachPhase(page, "work", 15000); // countdown done, into work
  await settled(page, true);
  m = await page.evaluate(probe);
  check("focus mode engaged", m.focus === "1", `focus=${m.focus}`);
  check("settings hidden mid-round", !m.settingsVisible);
  check("top bar hidden mid-round", !m.topbarVisible);
  check("pause button still reachable", m.controlsVisible && m.controls.bottom <= m.vh + 1,
    `controls bottom ${m.controls?.bottom} vs vh ${m.vh}`);
  check("stage is genuinely edge-to-edge", m.stage.h >= m.vh * 0.95 && m.stage.w >= m.vw - 1,
    `stage ${Math.round(m.stage.w)}×${Math.round(m.stage.h)} vs screen ${m.vw}×${m.vh}`);
  check("controls are compact icons mid-round", m.startBtn && m.startBtn.w <= 64 && m.startBtn.h <= 64,
    `start button ${Math.round(m.startBtn?.w)}×${Math.round(m.startBtn?.h)}`);
  check("no horizontal scrolling mid-round", m.docScrollW <= m.docClientW + 1, `${m.docScrollW} > ${m.docClientW}`);
  check("combo text not clipped horizontally", m.comboScrollW <= m.comboClientW + 1,
    `combo scrollW ${m.comboScrollW} > clientW ${m.comboClientW}`);
  check("stage content not overflowing its own box", m.stageScrollH <= m.stageClientH + 2,
    `stage scrollH ${m.stageScrollH} > clientH ${m.stageClientH}`);
  check("combo is genuinely large", m.comboFont >= (dev.height < 500 ? 28 : 34), `${m.comboFont}px`);
  check("nothing overlaps mid-round", m.overlaps.length === 0, m.overlaps.join(", "));
  check("clock fits its own column", m.clockScrollW <= m.clockClientW + 1, `clock ${m.clockScrollW} > ${m.clockClientW}`);
  // The ring must stay inside its column, and the time inside the ring.
  check("dial stays within its column", !m.dial || !m.meta || m.dial.w <= m.meta.w + 1,
    `dial ${Math.round(m.dial?.w)} > column ${Math.round(m.meta?.w)}`);
  check("time fits inside the ring", !m.dial || m.clockTextW <= m.dial.w * 0.86,
    `clock text ${Math.round(m.clockTextW)} vs ring ${Math.round(m.dial?.w)}`);
  check("combo bigger than it was before focus", m.comboFont > 30, `${m.comboFont}px`);
  lines.push(`       (combo ${Math.round(m.comboFont)}px, clock ${Math.round(m.clockFont)}px, stage ${Math.round(m.stage.h)}px of ${m.vh})`);
  if (SHOTS) await page.screenshot({ path: path.join(shotDir, `${dev.name.replace(/\s+/g, "-")}-work.png`) });

  // ---- Longest combo must still fit ----
  await page.evaluate(() => {
    const keys = ["1","2","3","2","1","1","2","slip","2","3","2","roll"];
    const c = document.getElementById("combo");
    c.textContent = "";
    keys.forEach((k, i) => {
      const s = document.createElement("span");
      s.className = "mv";
      s.textContent = k + (i < keys.length - 1 ? " -" : "");
      c.appendChild(s);
      if (i < keys.length - 1) c.appendChild(document.createTextNode(" "));
    });
    c.style.setProperty("--fit", "0.54");
    document.getElementById("comboName").textContent = "10 combo";
  });
  await page.waitForTimeout(120);
  m = await page.evaluate(probe);
  check("Bakr's 12-move combo fits without clipping", m.comboScrollW <= m.comboClientW + 1,
    `scrollW ${m.comboScrollW} > clientW ${m.comboClientW}`);
  check("12-move combo doesn't overflow the stage", m.stageScrollH <= m.stageClientH + 2,
    `stage scrollH ${m.stageScrollH} > clientH ${m.stageClientH}`);
  check("no horizontal page scroll with the long combo", m.docScrollW <= m.docClientW + 1,
    `${m.docScrollW} > ${m.docClientW}`);
  check("12-move combo doesn't collide with the clock", m.overlaps.length === 0, m.overlaps.join(", "));
  if (SHOTS) await page.screenshot({ path: path.join(shotDir, `${dev.name.replace(/\s+/g, "-")}-longcombo.png`) });

  // ---- Pause stays fullscreen; the exit icon is present and reachable ----
  await tap(page);
  await page.waitForTimeout(250);
  m = await page.evaluate(probe);
  check("pausing stays in focus mode", m.focus === "1", `focus=${m.focus}`);
  check("settings stay tucked away while paused", !m.settingsVisible, "settings became visible");
  const exitBox = await page.evaluate(() => {
    const b = document.getElementById("exitBtn");
    const r = b.getBoundingClientRect();
    return { shown: getComputedStyle(b).display !== "none" && r.width > 0, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  });
  check("exit button is on screen in focus mode",
    exitBox.shown && exitBox.right <= m.vw + 1 && exitBox.bottom <= m.vh + 1,
    JSON.stringify(exitBox));
  check("exit button is icon-sized like its siblings", exitBox.w <= 64 && exitBox.h <= 64,
    `${Math.round(exitBox.w)}×${Math.round(exitBox.h)}`);
  check("no horizontal scroll when paused", m.docScrollW <= m.docClientW + 1, `${m.docScrollW} > ${m.docClientW}`);

  // ---- Finish screen (fullscreen, staged finale) ----
  await tap(page);            // resume
  await reachPhase(page, "done", FAST ? 40000 : 70000);   // let the rounds run out
  // Mid-hold: the dial is centre stage, the numbers are hidden — and so must
  // be their sound. Blips leaking here was a shipped bug.
  await page.waitForTimeout(500);
  const earlyBlips = await page.evaluate(() => window.__sfxLog.filter((e) => e.src.startsWith("blip") || e.src.startsWith("land")).length);
  check("count-up stays silent through the centre-stage hold", earlyBlips === 0, `${earlyBlips} early plays`);
  await page.waitForTimeout(2700); // finale: glide + reveal + count-up
  const lateBlips = await page.evaluate(() => window.__sfxLog.filter((e) => e.src.startsWith("blip")).length);
  check("blips play when the numbers appear", lateBlips > 0, `${lateBlips} blips`);
  m = await page.evaluate(probe);
  check("the finish screen stays fullscreen", m.focus === "1", `focus=${m.focus}`);
  const phase = await page.textContent("#phase");
  check("session reached the finish screen", phase.trim() === "Done", phase);
  check("finish summary on screen", m.stats && m.stats.bottom <= m.vh + 1 && m.stats.h > 0,
    `stats bottom ${m.stats?.bottom} vs ${m.vh}`);
  check("punch total is large and readable", m.heroFont >= (dev.height < 500 ? 34 : 42), `${m.heroFont}px`);
  check("no horizontal scroll on the finish screen", m.docScrollW <= m.docClientW + 1, `${m.docScrollW} > ${m.docClientW}`);
  check("nothing overlaps on the finish screen", m.overlaps.length === 0, m.overlaps.join(", "));
  check("finish: time inside the ring, or ring hidden", !m.ringVisible || m.clockTextW <= m.dial.w * 0.86,
    `clock text ${Math.round(m.clockTextW)} vs ring ${Math.round(m.dial?.w)}`);
  lines.push(`       (finish punch total ${Math.round(m.heroFont)}px)`);
  if (SHOTS) await page.screenshot({ path: path.join(shotDir, `${dev.name.replace(/\s+/g, "-")}-finish.png`) });

  // ---- Exit is the one door back to the settings ----
  await tap(page, "exitBtn");
  await page.waitForTimeout(250);
  await settled(page, false);
  m = await page.evaluate(probe);
  check("exit returns to the normal screen", m.focus !== "1" && m.settingsVisible, `focus=${m.focus}`);

  check("no JavaScript errors on this device", errors.length === 0, errors.join(" | "));
  check("no telemetry escaped to the network", escaped.length === 0, escaped.join(", "));
  await ctx.close();
  return { lines, pass, fail };
}

// ---------------------------------------------------------------------------
// Rotating the phone MID-ROUND — the case most likely to break, and the one
// jsdom can say nothing about.
// ---------------------------------------------------------------------------
async function runRotation() {
  let pass = 0, fail = 0;
  const lines = [`\n── Rotating mid-session ──`];
  const check = (name, cond, detail = "") => {
    if (cond) { pass++; lines.push(`    ✅ ${name}`); }
    else { fail++; lines.push(`    ❌ ${name}${detail ? "  → " + detail : ""}`); }
  };
  // Its own browser, not a context on the shared one. Rotation is simulated by
  // setViewportSize, and Chromium refuses to resize a window left in a
  // maximized/fullscreen state — which the 1920×1080 device above puts it in.
  // Sharing the browser made this section die with a protocol error that looked
  // like an app bug and wasn't.
  const rotBrowser = await chromium.launch();
  const ctx = await rotBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const escaped = await sealContext(ctx);
  const page = await ctx.newPage();
  // Rotation is simulated by resizing the window, and Chromium refuses to
  // resize one in a fullscreen state — which starting a session puts it in.
  // Exiting element fullscreen first is NOT enough: the window stays flagged
  // and the resize still fails. So this page never enters fullscreen at all.
  // What's under test here is the orientation layout, which is driven by
  // data-focus and media queries and is identical either way; the fullscreen
  // lifecycle itself is covered in run.mjs section 10b.
  await page.addInitScript(() => {
    try { localStorage.setItem("combify.tour.v1", "1"); } catch (e) {}
    const no = () => Promise.reject(new Error("fullscreen disabled for rotation tests"));
    Element.prototype.requestFullscreen = no;
    Element.prototype.webkitRequestFullscreen = no;
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  // One short round: long enough that the sampling window below cannot cross
  // a phase boundary, short enough that waiting it out costs seconds not a
  // minute. It used to be 2 rounds of 30s and the finish was never reached —
  // the wait expired first, so "finish screen survives rotation" was really
  // asserting against a mid-round screen.
  await startSession(page, { work: 12, rest: 3, rounds: 1 });
  await reachPhase(page, "work", 15000);

  const clockBefore = await page.textContent("#clock");
  const comboBefore = await page.textContent("#combo");

  // The ring must drain continuously, not in one-second steps. This runs here
  // because the 30s work phase guarantees no phase boundary interrupts the
  // sampling window. Three samples 300ms apart can straddle at most one second
  // boundary, so per-second stepping yields at most two distinct values —
  // smooth drain yields three.
  const offsets = [];
  for (let i = 0; i < 3; i++) {
    offsets.push(await page.evaluate(() => parseFloat(document.getElementById("dialFill").style.strokeDashoffset)));
    if (i < 2) await page.waitForTimeout(300);
  }
  check("ring drains smoothly between second ticks", new Set(offsets).size === 3,
    `offsets ${offsets.map((o) => Math.round(o * 10) / 10).join(", ")}`);

  for (const [w, h, label] of [[844, 390, "→ landscape"], [390, 844, "→ back to portrait"], [844, 390, "→ landscape again"]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const m = await page.evaluate(probe);
    check(`${label}: still in focus mode`, m.focus === "1", `focus=${m.focus}`);
    check(`${label}: no horizontal scrolling`, m.docScrollW <= m.docClientW + 1, `${m.docScrollW} > ${m.docClientW}`);
    check(`${label}: combo not clipped`, m.comboScrollW <= m.comboClientW + 1, `${m.comboScrollW} > ${m.comboClientW}`);
    check(`${label}: stage content fits`, m.stageScrollH <= m.stageClientH + 2, `${m.stageScrollH} > ${m.stageClientH}`);
    check(`${label}: pause button still on screen`, m.controlsVisible && m.controls.bottom <= m.vh + 1,
      `bottom ${m.controls?.bottom} vs ${m.vh}`);
    check(`${label}: stage still edge-to-edge`, m.stage.h >= m.vh * 0.95 && m.stage.w >= m.vw - 1,
      `${Math.round(m.stage.w)}×${Math.round(m.stage.h)} of ${m.vw}×${m.vh}`);
    check(`${label}: nothing overlaps`, m.overlaps.length === 0, m.overlaps.join(", "));
    lines.push(`       (${label}: combo ${Math.round(m.comboFont)}px, stage ${Math.round(m.stage.h)}/${m.vh})`);
  }

  // The session must survive rotation — timer running, combos still coming.
  const clockAfter = await page.textContent("#clock");
  const toSec = (s) => { const [a, b] = s.split(":").map(Number); return a * 60 + b; };
  check("timer kept running through rotations", toSec(clockAfter) < toSec(clockBefore),
    `${clockBefore} → ${clockAfter}`);
  check("still showing a combo after rotating", (await page.textContent("#combo")).length > 0);
  check("no JavaScript errors while rotating", errors.length === 0, errors.join(" | "));

  // Rotate on the finish screen too — after the finale has settled.
  await reachPhase(page, "done", 40000);
  await page.waitForTimeout(3200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const m2 = await page.evaluate(probe);
  check("the session really did finish", (await page.textContent("#phase")).trim() === "Done",
    await page.textContent("#phase"));
  check("finish screen survives rotation", m2.docScrollW <= m2.docClientW + 1, `${m2.docScrollW} > ${m2.docClientW}`);
  check("finish summary still on screen after rotating", m2.stats.bottom <= m2.vh + 1, `${m2.stats.bottom} vs ${m2.vh}`);
  check("no telemetry escaped while rotating", escaped.length === 0, escaped.join(", "));
  await ctx.close();
  await rotBrowser.close();
  return { lines, pass, fail };
}

// The install card and its pointer, measured in a real browser.
//
// This exists because the exact bug it checks for has already shipped once:
// the card was anchored high in `vh` units, and on iOS `vh` resolves against
// the viewport with the toolbars HIDDEN, so it sat underneath Chrome's address
// bar with its instructions covered. jsdom cannot catch that — it has no
// layout engine, so every box is zero-sized and every assertion passes.
async function runInstallCard() {
  const lines = [];
  let pass = 0, fail = 0;
  const check = (name, cond, detail = "") => {
    if (cond) { pass++; lines.push(`  ✅ ${name}`); }
    else { fail++; lines.push(`  ❌ ${name}${detail ? `  → ${detail}` : ""}`); }
  };
  lines.push("\n── install card + pointer ──");

  const CASES = [
    { name: "iPhone Chrome", h: 844, edge: "top", inset: 33,
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1" },
    { name: "iPhone Safari", h: 844, edge: "bottom", inset: null,
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
    // A small phone is where a card pulled toward one edge runs out of room.
    { name: "small iPhone Safari", h: 667, edge: "bottom", inset: null,
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
  ];

  for (const c of CASES) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: c.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: c.ua,
    });
    const escaped = await sealContext(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      try {
        localStorage.setItem("combify.tour.v1", "1");
        // A finished session is what earns the ask; seeding it beats sitting
        // through a real one three times over.
        localStorage.setItem("combify.history.v1", JSON.stringify({
          days: { "2026-01-01": { sessions: 1, rounds: 3, punches: 40, seconds: 300 } },
          totals: { sessions: 1, rounds: 3, punches: 40, seconds: 300 },
        }));
      } catch (e) {}
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    const m = await page.evaluate(() => {
      const modal = document.getElementById("insModal");
      if (modal.hidden) return { shown: false };
      const a = document.getElementById("insAim");
      const card = document.querySelector(".ins__card").getBoundingClientRect();
      const aim = a.hidden ? null : a.getBoundingClientRect();
      return {
        shown: true, edge: a.dataset.edge, vh: window.innerHeight, vw: window.innerWidth,
        card: { top: card.top, bottom: card.bottom, left: card.left, right: card.right },
        aim: aim && { top: aim.top, bottom: aim.bottom, centreFromRight: window.innerWidth - (aim.left + aim.width / 2) },
      };
    });

    check(`${c.name}: the card is shown`, m.shown === true, "never opened");
    if (m.shown) {
      // The whole card on screen, both ends. This is the shipped bug.
      check(`${c.name}: card fully on screen`,
        m.card.top >= 0 && m.card.bottom <= m.vh + 1,
        `top ${Math.round(m.card.top)}, bottom ${Math.round(m.card.bottom)} of ${m.vh}`);
      check(`${c.name}: pointer aims ${c.edge}`, m.edge === c.edge, m.edge);
      check(`${c.name}: card and pointer do not overlap`,
        m.aim && (m.card.bottom < m.aim.top || m.card.top > m.aim.bottom),
        m.aim ? `card ${Math.round(m.card.top)}-${Math.round(m.card.bottom)} vs aim ${Math.round(m.aim.top)}-${Math.round(m.aim.bottom)}` : "no pointer");
      // Close enough to read as one instruction, far enough not to collide.
      const gap = c.edge === "top" ? m.card.top - m.aim.bottom : m.aim.top - m.card.bottom;
      check(`${c.name}: card sits beside its pointer (gap ${Math.round(gap)}px)`,
        gap > 0 && gap < 60, `${Math.round(gap)}px`);
      // The pointer must be at the end of the screen it claims.
      check(`${c.name}: pointer is at the ${c.edge} of the screen`,
        c.edge === "top" ? m.aim.top < m.vh * 0.2 : m.aim.bottom > m.vh * 0.8,
        `${Math.round(m.aim.top)}-${Math.round(m.aim.bottom)} of ${m.vh}`);
      if (c.inset != null) {
        // Under the real button, not merely near its corner — the miss that
        // put the arrow beside Chrome's share icon rather than below it.
        check(`${c.name}: pointer lines up with the share button (${c.inset}px in)`,
          Math.abs(m.aim.centreFromRight - c.inset) <= 3,
          `${Math.round(m.aim.centreFromRight)}px from the right edge, wanted ${c.inset}`);
      }
    }
    if (m.shown) {
      // The scrim no longer dismisses, so "Not now" is the ONLY exit. If it
      // ever renders off screen the card stops being firm and becomes a trap.
      const skip = await page.evaluate(() => {
        const r = document.getElementById("insSkip").getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, h: r.height, vh: window.innerHeight };
      });
      check(`${c.name}: the only exit is on screen`,
        skip.top >= 0 && skip.bottom <= skip.vh + 1,
        `Not now at ${Math.round(skip.top)}-${Math.round(skip.bottom)} of ${skip.vh}`);
      check(`${c.name}: and is big enough to hit`, skip.h >= 40, `${Math.round(skip.h)}px tall`);
      // A stray tap on the scrim must leave it open.
      await page.mouse.click(8, Math.round(skip.vh / 2));
      await page.waitForTimeout(200);
      check(`${c.name}: a tap outside the card does not dismiss it`,
        await page.isVisible("#insModal"), "closed on a stray tap");

      // "Don't ask again" is the real opt-out: reachable, but nowhere near
      // the card, the pointer, or "Not now", so nobody hits it while
      // declining once.
      const nev = await page.evaluate(() => {
        const n = document.getElementById("insNever").getBoundingClientRect();
        const c2 = document.querySelector(".ins__card").getBoundingClientRect();
        const a = document.getElementById("insAim");
        const ar = a.hidden ? null : a.getBoundingClientRect();
        return {
          top: n.top, bottom: n.bottom, h: n.height, vh: window.innerHeight,
          gapFromCard: Math.min(Math.abs(n.top - c2.bottom), Math.abs(c2.top - n.bottom)),
          overlapsAim: ar ? !(n.bottom < ar.top || n.top > ar.bottom) : false,
        };
      });
      check(`${c.name}: the opt-out is on screen`,
        nev.top >= 0 && nev.bottom <= nev.vh + 1, `${Math.round(nev.top)}-${Math.round(nev.bottom)} of ${nev.vh}`);
      check(`${c.name}: and is far from the card`, nev.gapFromCard > 40, `${Math.round(nev.gapFromCard)}px away`);
      check(`${c.name}: and never collides with the pointer`, !nev.overlapsAim, "overlapping the arrow");
    }
    check(`${c.name}: no JavaScript errors`, errors.length === 0, errors.join("; "));
    check(`${c.name}: no telemetry escaped`, escaped.length === 0, escaped.join(", "));
    if (SHOTS) await page.screenshot({ path: path.join(shotDir, `install-${c.name.replace(/\s+/g, "-")}.png`) });
    await ctx.close();
  }
  return { lines, pass, fail };
}

// The countdown's per-second beat. Its predecessor was a fixed 5-iteration CSS
// animation that could drift out of step with the digits; this one is
// retriggered from the clock, so what matters is that a beat actually fires on
// each second and that nothing is left stranded when the countdown ends.
async function runCountdownBeat() {
  const lines = [];
  let pass = 0, fail = 0;
  const check = (name, cond, detail = "") => {
    if (cond) { pass++; lines.push(`  ✅ ${name}`); }
    else { fail++; lines.push(`  ❌ ${name}${detail ? `  → ${detail}` : ""}`); }
  };
  lines.push("\n── countdown beat ──");

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const escaped = await sealContext(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem("combify.tour.v1", "1"); } catch (e) {} });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // Count how many times each beat class is (re)applied across the countdown.
  await page.evaluate(() => {
    window.__beats = { slam: 0, shock: 0 };
    const watch = (sel, key) => {
      const el = document.querySelector(sel);
      if (!el) return;
      new MutationObserver(() => {
        if (el.classList.contains(key === "slam" ? "is-slam" : "is-shock")) window.__beats[key]++;
      }).observe(el, { attributes: true, attributeFilter: ["class"] });
    };
    watch(".clock", "slam");
    watch(".dial__pulse", "shock");
  });

  // getAnimations() reports what the browser is genuinely running, which an
  // inline `animation: none` would leave empty however many classes were set.
  await page.evaluate(() => {
    window.__ran = { slamRan: 0, shockRan: 0, shockInline: null };
    setInterval(() => {
      const c = document.querySelector(".clock"), s = document.querySelector(".dial__pulse");
      if (c && c.getAnimations && c.getAnimations().length) window.__ran.slamRan++;
      if (s && s.getAnimations && s.getAnimations().length) window.__ran.shockRan++;
      if (s) window.__ran.shockInline = s.style.animation;
    }, 60);
  });
  // Sample the ring through the countdown's first second, where the wind-up
  // would happen. Only while the countdown is actually the live phase — the
  // ready screen legitimately sits at an empty ring.
  await page.evaluate(() => {
    window.__ring = [];
    const fill = document.getElementById("dialFill");
    const stage = document.getElementById("stage");
    const id = setInterval(() => {
      if (stage.dataset.phase !== "countdown") return;
      const v = parseFloat(getComputedStyle(fill).strokeDashoffset) || 0;
      window.__ring.push(v);
      if (window.__ring.length > 400) clearInterval(id);
    }, 16);
  });
  await page.click("#startBtn");
  await page.waitForTimeout(6800);   // the whole 5s countdown, into work
  const ranAnim = await page.evaluate(() => window.__ran);

  // The ring must START full. Sampled densely from the moment Start is tapped:
  // if the easing ever catches the first write, the offset sweeps from empty
  // (the full circumference) down to 0 and these samples record it.
  // Offset 0 is a full ring and the circumference (~339) is an empty one, so a
  // correct countdown starts near 0 and only ever RISES as it drains. Winding
  // up shows as the opposite: starting near 339 and falling.
  const ringPath = await page.evaluate(() => window.__ring || []);
  check("the countdown ring starts full", ringPath.length > 0 && ringPath[0] < 40,
    `first offset ${Math.round(ringPath[0])} of ~339 — the ring started empty`);
  // Allow a little slack for the once-a-second eased step settling.
  const backwards = ringPath.filter((o, i) => i > 0 && o < ringPath[i - 1] - 2);
  check("and only ever drains, never draws itself in",
    backwards.length === 0,
    `${backwards.length} samples moved backwards, e.g. ${backwards.slice(0, 4).map((n) => Math.round(n)).join(", ")}`);

  const beats = await page.evaluate(() => window.__beats);
  check(`the number beats on every countdown second (${beats.slam})`, beats.slam >= 5, JSON.stringify(beats));
  check(`the shockwave fires with it (${beats.shock})`, beats.shock >= 5, JSON.stringify(beats));
  // Counting class toggles is NOT enough, and this is why: the slam replaced a
  // CSS animation that the entrance used to hold off with an inline
  // `animation: none`. The class went on exactly as expected and the inline
  // style silently outranked it, so the shockwave never once ran — and a test
  // that only watched classes passed the whole time. These assert the browser
  // actually animated something.
  check("the shockwave is not pinned by an inline animation style",
    ranAnim.shockInline === "" || ranAnim.shockInline === undefined,
    `inline animation: "${ranAnim.shockInline}"`);
  check("the browser really ran both animations",
    ranAnim.slamRan > 0 && ranAnim.shockRan > 0,
    `slam ran ${ranAnim.slamRan}, shockwave ran ${ranAnim.shockRan}`);

  const phase = (await page.textContent("#phase")).trim();
  check("the countdown handed off into the round", phase === "Work", phase);
  // Nothing may be left mid-animation once the round is running.
  const stranded = await page.evaluate(() => {
    const p = document.querySelector(".dial__pulse");
    return { pulseOpacity: getComputedStyle(p).opacity, stage: document.getElementById("stage").dataset.phase };
  });
  check("the shockwave is not left sitting on screen during the round",
    Number(stranded.pulseOpacity) < 0.02, JSON.stringify(stranded));
  check("no JavaScript errors", errors.length === 0, errors.join("; "));
  check("no telemetry escaped", escaped.length === 0, escaped.join(", "));
  await ctx.close();
  return { lines, pass, fail };
}

// The first-run walkthrough, which had no coverage at all until its spotlight
// was found sliding off the page on scroll. jsdom cannot test it — every stop
// is measured with getBoundingClientRect, and without a layout engine they all
// come back zero-sized and the tour declines to run.
async function runTour() {
  const lines = [];
  let pass = 0, fail = 0;
  const check = (name, cond, detail = "") => {
    if (cond) { pass++; lines.push(`  ✅ ${name}`); }
    else { fail++; lines.push(`  ❌ ${name}${detail ? `  → ${detail}` : ""}`); }
  };
  lines.push("\n── first-run walkthrough ──");

  // A small phone: the stops below the fold are where this gets interesting.
  // A real phone user-agent, not just a phone-sized window: one stop carries a
  // landscape clause that is only shown on phones.
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const escaped = await sealContext(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  check("it runs on a first visit", await page.isVisible("#tour"), "never appeared");

  const seen = [];
  for (let i = 0; i < 8; i++) {
    if (!(await page.isVisible("#tour"))) break;
    const stop = await page.evaluate(() => {
      const spot = document.getElementById("tourSpot").getBoundingClientRect();
      return {
        text: document.getElementById("tourText").textContent,
        count: document.getElementById("tourCount").textContent,
        spotOnScreen: spot.top > -40 && spot.bottom < window.innerHeight + 40,
        spotHasSize: spot.width > 8 && spot.height > 8,
      };
    });
    seen.push(stop);
    check(`stop ${i + 1}: spotlight has a real target`, stop.spotHasSize, JSON.stringify(stop));
    check(`stop ${i + 1}: spotlight is on screen`, stop.spotOnScreen, JSON.stringify(stop));
    await page.mouse.click(180, 620);
    await page.waitForTimeout(600);
  }

  check("it walks every stop and then closes", await page.isHidden("#tour"), "still open after 8 taps");
  check("there are five stops", seen.length === 5, `${seen.length}: ${seen.map((s) => s.count).join(", ")}`);
  // The one people never find on their own, because it is collapsed.
  check("one of them explains what More options contains",
    seen.some((s) => /rounds/i.test(s.text) && /work/i.test(s.text)),
    seen.map((s) => s.text.slice(0, 40)).join(" | "));
  // Read standing in a gym over a dimmed screen: every stop stays one breath.
  const longest = seen.reduce((a, s) => Math.max(a, s.text.split(/\s+/).length), 0);
  check(`every stop stays short (longest ${longest} words)`, longest <= 14, `${longest} words`);
  // It must end on the button it is trying to get pressed.
  check("a phone is told landscape is the bigger view",
    seen.some((s) => /sideways/i.test(s.text)), seen.map((s) => s.text.slice(0, 40)).join(" | "));
  check("and it ends on the Start button",
    /Hit start/i.test(seen[seen.length - 1].text), seen[seen.length - 1].text);
  check("no JavaScript errors", errors.length === 0, errors.join("; "));
  check("no telemetry escaped", escaped.length === 0, escaped.join(", "));

  // Once, ever — an abandoned or completed tour must not ambush anyone again.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  check("it never runs a second time", await page.isHidden("#tour"), "came back");
  await ctx.close();
  return { lines, pass, fail };
}

// The segmented controls warm from the logo's teal toward its ember as you
// step up. This runs in a REAL browser because the whole effect is
// color-mix() + a registered @property, neither of which jsdom computes — in
// the unit suite the thumb is just an empty style string.
async function runSegRamp() {
  const lines = [];
  let pass = 0, fail = 0;
  const check = (name, cond, detail = "") => {
    if (cond) { pass++; lines.push(`  ✅ ${name}`); }
    else { fail++; lines.push(`  ❌ ${name}${detail ? `  → ${detail}` : ""}`); }
  };
  lines.push("\n── segmented controls warm as they step up ──");

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sealContext(ctx);
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem("combify.tour.v1", "1"); } catch (e) {} });
  await page.goto(base, { waitUntil: "load" });
  await page.waitForTimeout(300);

  // Read the thumb's actual painted colour at each position of a control.
  // REAL pointer input, not element.click(): the control selects on
  // pointerdown (so a swipe across it scrubs), and a synthetic click event
  // moves nothing at all.
  const ramp = async (id) => {
    const n = await page.locator(`#${id} .seg__opt`).count();
    const out = [];
    for (let i = 0; i < n; i++) {
      await page.locator(`#${id} .seg__opt`).nth(i).click();
      // WAIT FOR THE STATE, don't just sleep. A fixed delay made this test
      // flaky under load: a click occasionally landed while the previous
      // transition was still settling and the read came back stale, so the
      // ramp looked like it stopped halfway. Poll --i until the control has
      // actually moved, then let the tint finish easing.
      await page.waitForFunction(
        ([segId, want]) => Number(getComputedStyle(document.getElementById(segId)).getPropertyValue("--i")) === want,
        [id, i], { timeout: 4000 });
      await page.waitForTimeout(420);
      const meta = await page.evaluate((segId) => {
        const seg = document.getElementById(segId);
        return {
          t: Number(getComputedStyle(seg).getPropertyValue("--t")),
          bg: getComputedStyle(seg.querySelector(".seg__thumb")).backgroundImage,
        };
      }, id);
      // The PAINTED colour, not the declaration. Chromium leaves color-mix()
      // unresolved in a computed background-image, so the only honest way to
      // ask what the member sees is to look at the pixels. Sampled near the
      // thumb's left edge, clear of the centred label glyphs.
      const box = await page.locator(`#${id} .seg__thumb`).boundingBox();
      const shot = await page.screenshot({ clip: { x: box.x + 5, y: box.y + box.height / 2, width: 3, height: 3 } });
      const rgb = await page.evaluate((u) => new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          const g = c.getContext("2d");
          g.drawImage(img, 0, 0);
          const d = g.getImageData(1, 1, 1, 1).data;
          res([d[0], d[1], d[2]]);
        };
        img.src = u;
      }), "data:image/png;base64," + shot.toString("base64"));
      out.push({ ...meta, rgb });
    }
    return out;
  };

  for (const [name, id, count] of [["Level", "level", 3], ["Combo pace", "pace", 4]]) {
    const steps = await ramp(id);
    check(`${name} has ${count} segments`, steps.length === count, `${steps.length}`);
    check(`${name} spans the full ramp`,
      steps[0].t === 0 && steps[steps.length - 1].t === 1,
      `--t ran ${steps.map((s) => s.t).join(" → ")}`);
    check(`${name} thumb is a gradient, not a flat fill`,
      steps.every((s) => /gradient/.test(s.bg)), steps[0].bg.slice(0, 40));
    // Warmer means more red than blue. At the bottom of the ramp the teal has
    // more blue than red; at the top the ember has clearly more red.
    const rb = (s) => s.rgb[0] - s.rgb[2];
    check(`${name} starts cool and ends warm`,
      rb(steps[0]) < 0 && rb(steps[steps.length - 1]) > 40,
      `rgb ${steps.map((s) => s.rgb.join(",")).join("  →  ")}`);
    check(`${name} warms at every step, never backwards`,
      steps.every((s, i) => i === 0 || rb(s) > rb(steps[i - 1])),
      steps.map((s) => rb(s)).join(" → "));
  }

  await ctx.close();
  return { lines, pass, fail };
}

// Devices run through the pool; the rotation section owns a separate browser
// and runs alongside them, so it is never the thing everything else waits on.
const devices = DEVICES.filter((d) => !ONLY || d.name.toLowerCase().includes(ONLY.toLowerCase()));
const wantRotation = !ONLY || "rotating mid-session".includes(ONLY.toLowerCase());
const wantInstall = !ONLY || "install card pointer".includes(ONLY.toLowerCase());
const wantTour = !ONLY || "first-run walkthrough tour".includes(ONLY.toLowerCase());
const wantBeat = !ONLY || "countdown beat".includes(ONLY.toLowerCase());
const wantSeg = !ONLY || "segmented controls warm as they step up".includes(ONLY.toLowerCase());
const [devResults, rotResult, insResult, tourResult, beatResult, segResult] = await Promise.all([
  pool(devices, JOBS, runDevice),
  wantRotation ? runRotation() : null,
  wantInstall ? runInstallCard() : null,
  wantTour ? runTour() : null,
  wantBeat ? runCountdownBeat() : null,
  wantSeg ? runSegRamp() : null,
]);
for (const r of [...devResults, rotResult, insResult, tourResult, beatResult, segResult]) {
  if (!r) continue;
  lines.push(...r.lines); pass += r.pass; fail += r.fail;
}

await browser.close();
server.close();
console.log(lines.join("\n"));
console.log(`\n${"=".repeat(52)}\n  layout: ${pass} passed, ${fail} failed\n${"=".repeat(52)}`);
process.exit(fail ? 1 : 0);
