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
const shotDir = path.join(HERE, ".shots");

let pass = 0, fail = 0;
const lines = [];
const check = (name, cond, detail = "") => {
  if (cond) { pass++; lines.push(`    ✅ ${name}`); }
  else { fail++; lines.push(`    ❌ ${name}${detail ? "  → " + detail : ""}`); }
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp3": "audio/mpeg", ".png": "image/png", ".svg": "image/svg+xml" };
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
    controls: box(".controls"), stats: box("#stats"),
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
const browser = await chromium.launch();
if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });

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
  await page.click("#startBtn");
}

for (const dev of DEVICES.filter((d) => !ONLY || d.name.toLowerCase().includes(ONLY.toLowerCase()))) {
  lines.push(`\n── ${dev.name} (${dev.width}×${dev.height}) ──`);
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dpr, isMobile: dev.mobile, hasTouch: dev.mobile,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });

  // ---- Ready screen ----
  let m = await page.evaluate(probe);
  check("no horizontal scrolling on the ready screen", m.docScrollW <= m.docClientW + 1, `${m.docScrollW} > ${m.docClientW}`);
  check("settings visible before starting", m.settingsVisible);
  check("Start button on screen", m.controls && m.controls.bottom <= m.vh + 1, `controls bottom ${m.controls?.bottom} vs ${m.vh}`);
  // The ring is decorative — but if it renders, the time must genuinely sit
  // inside it. Short-landscape once shipped a ~100px ring with the clock
  // bursting out of it, and every box-based check called that fine.
  check("ready: time inside the ring, or ring hidden", !m.ringVisible || m.clockTextW <= m.dial.w * 0.86,
    `clock text ${Math.round(m.clockTextW)} vs ring ${Math.round(m.dial?.w)}`);
  if (SHOTS) await page.screenshot({ path: path.join(shotDir, `${dev.name.replace(/\s+/g, "-")}-ready.png`) });

  // ---- Mid-round (focus mode) ----
  await startSession(page, FAST ? { work: 4, rest: 2, rounds: 1 } : undefined);
  await page.waitForTimeout(3600); // countdown done, into work
  m = await page.evaluate(probe);
  check("focus mode engaged", m.focus === "1", `focus=${m.focus}`);
  check("settings hidden mid-round", !m.settingsVisible);
  check("top bar hidden mid-round", !m.topbarVisible);
  check("pause button still reachable", m.controlsVisible && m.controls.bottom <= m.vh + 1,
    `controls bottom ${m.controls?.bottom} vs vh ${m.vh}`);
  check("stage fills most of the screen", m.stage.h >= m.vh * 0.55, `stage ${Math.round(m.stage.h)} of ${m.vh}`);
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
    document.getElementById("comboName").textContent = "The 10";
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

  // ---- Pause returns the settings ----
  await page.click("#startBtn");
  await page.waitForTimeout(250);
  m = await page.evaluate(probe);
  check("pausing brings settings back", m.settingsVisible, "settings still hidden");
  check("pausing leaves focus mode", m.focus !== "1", `focus=${m.focus}`);
  check("no horizontal scroll when paused", m.docScrollW <= m.docClientW + 1, `${m.docScrollW} > ${m.docClientW}`);

  // ---- Finish screen ----
  await page.click("#startBtn");            // resume
  await page.waitForTimeout(FAST ? 7000 : 30000);   // let the rounds run out
  m = await page.evaluate(probe);
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

  check("no JavaScript errors on this device", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// Rotating the phone MID-ROUND — the case most likely to break, and the one
// jsdom can say nothing about.
// ---------------------------------------------------------------------------
lines.push(`\n── Rotating mid-session ──`);
if (!ONLY || "rotating mid-session".includes(ONLY.toLowerCase())) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await startSession(page, { work: 30, rest: 10, rounds: 2 });
  await page.waitForTimeout(3600);

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
    check(`${label}: stage still fills the screen`, m.stage.h >= m.vh * 0.5, `${Math.round(m.stage.h)} of ${m.vh}`);
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

  // Rotate on the finish screen too.
  await page.waitForTimeout(35000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const m2 = await page.evaluate(probe);
  check("finish screen survives rotation", m2.docScrollW <= m2.docClientW + 1, `${m2.docScrollW} > ${m2.docClientW}`);
  check("finish summary still on screen after rotating", m2.stats.bottom <= m2.vh + 1, `${m2.stats.bottom} vs ${m2.vh}`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(lines.join("\n"));
console.log(`\n${"=".repeat(52)}\n  layout: ${pass} passed, ${fail} failed\n${"=".repeat(52)}`);
process.exit(fail ? 1 : 0);
