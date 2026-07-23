// tests.mjs — comprehensive behavioural tests against the real js/app.js
import { boot, clearStore, peekStore } from "./harness.mjs";

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ✅ ${name}`); }
  else { fail++; results.push(`  ❌ ${name}${detail ? "  → " + detail : ""}`); }
}
function section(t) { results.push(`\n── ${t} ──`); }

// Count how many distinct combos got called during a window.
async function countCombos(app, ms, step = 200) {
  let last = app.combo(), n = 0;
  const times = [];
  for (let t = 0; t < ms; t += step) {
    await app.clock.advance(step);
    const c = app.combo();
    if (c !== last) { last = c; n++; times.push(app.clock.now); }
  }
  return { n, times };
}

// ---------------------------------------------------------------- 1. baseline
{
  section("1. Happy path — everything works");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 60); app.set("restSec", 10);
  app.setSeg("pace", "1500"); app.setSeg("level", "intermediate");
  app.click("startBtn");
  const { n } = await countCombos(app, 45000);
  check("combos are called steadily through the round", n >= 5, `only ${n} combos in 45s`);
  check("no overlapping voice clips", app.stats.maxVoiceConcurrent <= 1, `max ${app.stats.maxVoiceConcurrent} at once`);
  check("wake lock acquired on start", app.wakeLog[0] === "acquire");
  results.push(`     (${n} combos, ${app.stats.plays} clip plays, ${app.stats.created} elements)`);
  app.restore();
}

// ------------------------------------------------- 2. THE BUG: ended dropped
{
  section("2. iOS drops EVERY 'ended' event (the reported bug)");
  const app = await boot({ duration: 0.6, dropEnded: true });
  app.set("rounds", 1); app.set("workSec", 90); app.set("restSec", 10);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  const primed = app.stats.plays;
  await app.clock.advance(20000);
  const at20 = app.stats.plays;
  await app.clock.advance(20000);
  const at40 = app.stats.plays;
  await app.clock.advance(20000);
  const at60 = app.stats.plays;
  // Count word plays, not combo-text changes: randomCombo can repeat a combo,
  // which leaves the text unchanged and hides progress.
  check("words play in first 20s", at20 - primed >= 10, `${at20 - primed}`);
  check("still playing at 20–40s", at40 - at20 >= 10, `${at40 - at20}`);
  check("STILL playing at 40–60s (no permanent stall)", at60 - at40 >= 10, `${at60 - at40}`);
  results.push(`     (word plays per 20s window: ${at20 - primed}, ${at40 - at20}, ${at60 - at40})`);
  app.restore();
}

// ------------------------------------------------ 3. intermittent drops (50%)
{
  section("3. iOS drops ~50% of 'ended' events at random");
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const app = await boot({ duration: 0.6, dropEnded: () => rnd() < 0.5 });
  app.set("rounds", 1); app.set("workSec", 90); app.set("restSec", 10);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  const a = await countCombos(app, 30000);
  const b = await countCombos(app, 30000);
  check("no stall with flaky events (early)", a.n >= 3, `${a.n}`);
  check("no stall with flaky events (late)", b.n >= 3, `${b.n}`);
  check("no overlapping voice", app.stats.maxVoiceConcurrent <= 1, `max ${app.stats.maxVoiceConcurrent}`);
  app.restore();
}

// ---------------------------------------------------- 4. play() always blocked
{
  section("4. Browser blocks play() entirely (autoplay denied)");
  const app = await boot({ duration: 0.6, playRejects: true });
  app.set("rounds", 1); app.set("workSec", 60); app.set("restSec", 10);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  const { n } = await countCombos(app, 40000);
  check("combos still advance visually when audio is blocked", n >= 4, `${n} combos`);
  app.restore();
}

// -------------------------------------------------------- 5. round transitions
{
  section("5. Multi-round: work → rest → work");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 2); app.set("workSec", 15); app.set("restSec", 10);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  await app.clock.advance(4000);                    // countdown done
  check("round 1 is Work", app.phase() === "Work", app.phase());
  await app.clock.advance(15000);                   // into rest
  check("goes to Rest after work", app.phase() === "Rest", app.phase());
  const restCombo = app.combo();
  const during = await countCombos(app, 8000);
  check("no combos called during Rest", during.n === 0, `${during.n} changes; text=${restCombo}`);
  await app.clock.advance(4000);
  check("round 2 starts (Work again)", app.phase() === "Work", app.phase());
  await app.clock.advance(20000);
  check("session finishes", app.phase() === "Done", app.phase());
  check("wake lock released at end", app.wakeLog.includes("release"), app.wakeLog.join(","));
  app.restore();
}

// ------------------------------------------------------- 6. pause / resume
{
  section("6. Pause mid-combo then resume");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 90); app.set("restSec", 10);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  await app.clock.advance(8000);
  app.click("startBtn");                            // pause
  const pausedAt = app.clockText();
  const idle = await countCombos(app, 6000);
  check("no combos called while paused", idle.n === 0, `${idle.n}`);
  check("clock frozen while paused", app.clockText() === pausedAt, `${pausedAt} → ${app.clockText()}`);
  const beforeResume = app.stats.maxVoiceConcurrent;
  app.click("startBtn");                            // resume
  const after = await countCombos(app, 25000);
  check("combos resume after unpause", after.n >= 2, `${after.n}`);
  check("no doubled/overlapping voice after resume", app.stats.maxVoiceConcurrent <= 1, `max ${app.stats.maxVoiceConcurrent} (was ${beforeResume})`);
  app.restore();
}

// ---------------------------------------- 7. total audio death → revive kicks in
{
  section("7. Audio chain dies completely mid-round → self-heal");
  // Elements stop firing ended AND stop resolving play: simulates the element
  // pool going bad. Only reviveComboLoop() can recover this.
  const app = await boot({ duration: 0.6, dropEnded: true });
  app.set("rounds", 1); app.set("workSec", 120); app.set("restSec", 10);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  await app.clock.advance(10000);
  const before = app.stats.plays;
  await app.clock.advance(60000);
  const after = app.stats.plays;
  check("playback continues over a long round", after > before + 20, `${before} → ${after}`);
  app.restore();
}

// ------------------------------------------------------------ 8. voice toggle
{
  section("8. Voice switched off");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 60); app.set("restSec", 10);
  app.setSeg("pace", "1500");
  app.doc.getElementById("voiceOn").checked = false;
  app.click("startBtn");
  const afterPriming = app.stats.plays; // Start primes the pool — those plays are expected
  const { n } = await countCombos(app, 30000);
  const duringRound = app.stats.plays - afterPriming;
  check("combos still displayed with voice off", n >= 4, `${n}`);
  check("no VOICE clips played during round with voice off",
    Object.keys(app.stats.byKey).filter((k) => k !== "bell").every((k) => app.stats.byKey[k] <= 2),
    `plays during round: ${duringRound}, byKey=${JSON.stringify(app.stats.byKey)}`);
  app.restore();
}

// --------------------------------------------------------- 9. wake lock detail
{
  section("9. Wake lock lifecycle");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 30); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(2000);
  check("acquired on start", app.wakeLog.filter((x) => x === "acquire").length === 1, app.wakeLog.join(","));
  // simulate app-switch: browser releases lock, tab hidden then visible again
  Object.defineProperty(app.doc, "visibilityState", { value: "visible", configurable: true });
  app.doc.dispatchEvent(new app.window.Event("visibilitychange"));
  await app.clock.advance(500);
  check("re-acquires when tab becomes visible again", app.wakeLog.filter((x) => x === "acquire").length >= 2, app.wakeLog.join(","));
  app.click("resetBtn");
  await app.clock.advance(500);
  check("released on reset", app.wakeLog.includes("release"), app.wakeLog.join(","));
  app.restore();
}

// ------------------------------------------- 10. unsupported wake lock (Firefox)
{
  section("10. Browser without wakeLock support");
  const app = await boot({ duration: 0.6, noWakeLock: "unsupported" });
  app.set("rounds", 1); app.set("workSec", 30); app.set("restSec", 5);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  const { n } = await countCombos(app, 20000);
  check("app runs normally without wakeLock API", n >= 2, `${n} combos`);
  app.restore();
}

// ------------------------------------------------------ 11. element count sanity
{
  section("11. Audio element count (iOS decoder pressure)");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 3); app.set("workSec", 20); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(80000);
  check("element count stays bounded (no leak per combo)", app.stats.created <= 40, `${app.stats.created} created`);
  results.push(`     (${app.stats.created} elements for a 3-round session)`);
  app.restore();
}

// ------------------------------------------------------------ 12. timer accuracy
{
  section("12. Timer accuracy");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 60); app.set("restSec", 10);
  app.click("startBtn");
  await app.clock.advance(3000);                    // countdown
  const startClock = app.clockText();
  await app.clock.advance(30000);
  const endClock = app.clockText();
  const toSec = (s) => { const [m, x] = s.split(":").map(Number); return m * 60 + x; };
  const elapsed = toSec(startClock) - toSec(endClock);
  check("30s of real time ≈ 30s on the clock", Math.abs(elapsed - 30) <= 1, `${startClock} → ${endClock} = ${elapsed}s`);
  app.restore();
}

// ------------------------------------------------------- 13. TTS fallback path
{
  section("13. Clip files missing → TTS fallback");
  const app = await boot({ duration: 0.6, failLoad: true });
  // simulate load errors on the preloaded clips
  for (const a of app.stats.live) if (a._l.error) for (const fn of a._l.error) fn({ type: "error" });
  app.set("rounds", 1); app.set("workSec", 60); app.set("restSec", 10);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  const { n } = await countCombos(app, 30000);
  check("combos advance via TTS when clips fail to load", n >= 3, `${n} combos`);
  check("speechSynthesis was actually used", app.speechLog.some((s) => s.startsWith("speak:")), app.speechLog.slice(0, 3).join("|"));
  app.restore();
}

// --------------------------------------------------- 14. TTS onend never fires
{
  section("14. TTS + iOS never fires onend");
  const app = await boot({ duration: 0.6, dropSpeechEnd: true });
  for (const a of app.stats.live) if (a._l.error) for (const fn of a._l.error) fn({ type: "error" });
  app.set("rounds", 1); app.set("workSec", 120); app.set("restSec", 10);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  const { n } = await countCombos(app, 60000);
  check("still advances (via 10s safety timeout)", n >= 3, `${n} combos in 60s`);
  results.push(`     (note: relies on the 10s fallback — slow but not stuck)`);
  app.restore();
}

// ------------------------------------------- 15. backgrounded tab (timer drift)
{
  section("15. Backgrounded tab — browser throttles the 1s interval");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 180); app.set("restSec", 10);
  app.click("startBtn");
  await app.clock.advance(3000);
  const before = app.clockText();
  // Simulate throttling: push the 1s interval out so it only fires once a minute.
  for (let min = 0; min < 3; min++) {
    for (const t of app.clock.q) if (t.every === 1000) t.time = app.clock.now + 60000;
    await app.clock.advance(60000);
  }
  const after = app.clockText();
  const toSec = (s) => { const [m, x] = s.split(":").map(Number); return m * 60 + x; };
  const counted = toSec(before) - toSec(after);
  check("180s of real time counts as ~180s on the clock", Math.abs(counted - 180) <= 2, `counted ${counted}s (lost ${180 - counted}s)`);
  results.push(`     (${before} → ${after} across 3 throttled minutes)`);
  app.restore();
}

// ------------------------------------- 16. returning to the app catches up fast
{
  section("16. Clock catches up the moment you return to the app");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 180); app.set("restSec", 10);
  app.click("startBtn");
  await app.clock.advance(3000);
  const before = app.clockText();
  for (const t of app.clock.q) if (t.every === 1000) t.time = app.clock.now + 90000;
  await app.clock.advance(45000);          // 45s passes with no tick at all
  const stale = app.clockText();
  Object.defineProperty(app.doc, "visibilityState", { value: "visible", configurable: true });
  app.doc.dispatchEvent(new app.window.Event("visibilitychange"));
  await Promise.resolve();
  const fresh = app.clockText();
  const toSec = (s) => { const [m, x] = s.split(":").map(Number); return m * 60 + x; };
  check("display corrects itself on returning", Math.abs((toSec(before) - toSec(fresh)) - 45) <= 2, `${before} → stale ${stale} → ${fresh}`);
  app.restore();
}

// ------------------------------------------------ 17. settings are remembered
{
  section("17. Settings persist across a reload");
  clearStore();
  // --- visit 1: defaults, then the member changes things through the real UI
  const a = await boot({ duration: 0.6 });
  check("first visit uses defaults", a.doc.getElementById("level").dataset.value === "intermediate",
    a.doc.getElementById("level").dataset.value);

  const tapSeg = (app, id, frac) => app.doc.getElementById(id).dispatchEvent(
    new app.window.MouseEvent("pointerdown", { bubbles: true, clientX: Math.floor(300 * frac) }));
  const clickPlus = (app, id) => app.doc.querySelectorAll(`#${id} .step__btn`)[1]
    .dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));

  tapSeg(a, "level", 0.9);        // → advanced (3rd of 3 segments)
  tapSeg(a, "pace", 0.9);         // → Fast
  clickPlus(a, "rounds"); clickPlus(a, "rounds");   // 3 → 5
  a.doc.getElementById("voiceOn").checked = false;
  a.doc.getElementById("voiceOn").dispatchEvent(new a.window.Event("change", { bubbles: true }));

  const want = {
    level: a.doc.getElementById("level").dataset.value,
    pace: a.doc.getElementById("pace").dataset.value,
    rounds: a.doc.getElementById("rounds").dataset.value,
  };
  check("level actually changed via UI", want.level === "advanced", want.level);
  check("rounds actually changed via UI", want.rounds === "5", want.rounds);
  check("changing a setting writes to storage", !!peekStore()["combify.settings.v1"], "nothing stored");
  a.restore();

  // --- visit 2: closing and reopening the app
  const b = await boot({ duration: 0.6 });
  check("level restored", b.doc.getElementById("level").dataset.value === want.level,
    `wanted ${want.level}, got ${b.doc.getElementById("level").dataset.value}`);
  check("pace restored", b.doc.getElementById("pace").dataset.value === want.pace,
    `wanted ${want.pace}, got ${b.doc.getElementById("pace").dataset.value}`);
  check("rounds restored", b.doc.getElementById("rounds").dataset.value === want.rounds,
    `wanted ${want.rounds}, got ${b.doc.getElementById("rounds").dataset.value}`);
  check("stepper display matches restored value",
    b.doc.querySelector("#rounds .step__val").textContent === want.rounds,
    b.doc.querySelector("#rounds .step__val").textContent);
  check("voice toggle restored", b.doc.getElementById("voiceOn").checked === false,
    String(b.doc.getElementById("voiceOn").checked));
  // and the restored settings must actually drive the session
  b.click("startBtn");
  await b.clock.advance(4000);
  check("restored rounds used by the session", b.doc.getElementById("round").textContent.includes("/ 5"),
    b.doc.getElementById("round").textContent);
  b.restore();
  clearStore();
}

// -------------------------------------- 18. storage blocked (private browsing)
{
  section("18. Private browsing — localStorage throws");
  const app = await boot({ duration: 0.6, storage: "throws" });
  app.set("rounds", 1); app.set("workSec", 30); app.set("restSec", 5);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  const { n } = await countCombos(app, 20000);
  check("app still runs when storage is unavailable", n >= 2, `${n} combos`);
  app.restore();
}

// ---------------------------------------------------------------- 19. the bell
{
  section("19. Bell must ring even though audio/sfx/bell.mp3 doesn't exist");
  // The sample was deleted deliberately (the synth FM bell replaced it). The
  // app must therefore ring the SYNTH, not try to play a missing file.
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.click("startBtn");
  const beforeRound = app.synth.oscStarted;
  await app.clock.advance(4000);          // countdown ends → round 1 bell
  const afterBell = app.synth.oscStarted;
  check("something audible fires at round start", afterBell > beforeRound,
    `oscillators started: ${beforeRound} → ${afterBell}`);
  await app.clock.advance(25000);         // work ends → session-over bell (3 strikes)
  check("session-end bell rings too", app.synth.oscStarted > afterBell + 2,
    `${afterBell} → ${app.synth.oscStarted}`);
  check("no attempt to play the missing sample",
    !Object.keys(app.stats.byKey).includes("bell"),
    `tried to play: ${JSON.stringify(app.stats.byKey)}`);
  app.restore();
}

// ------------------------------- 20. mobile defers loading — no load events fire
{
  section("20. Mobile defers loading (no canplaythrough / no error ever)");
  // This is the exact condition that silenced the bell: the browser fires no
  // load events at all, so any flag that flips on an error never flips.
  const app = await boot({ duration: 0.6, deferMetadata: true });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  const before = app.synth.oscStarted;
  await app.clock.advance(4000);
  check("bell still rings with zero load events", app.synth.oscStarted > before,
    `oscillators: ${before} → ${app.synth.oscStarted}`);
  const { n } = await countCombos(app, 15000);
  check("combos still called with zero load events", n >= 2, `${n} combos`);
  // The real guard on the bug: the app must not reach for a file that isn't
  // there in the first place. Relying on play() to reject is a safety net, not
  // a plan — a browser that stalls instead of rejecting rings nothing.
  check("never tries to play a file that doesn't exist",
    app.stats.missingPlayAttempts.length === 0,
    `${app.stats.missingPlayAttempts.length} attempts, e.g. ${app.stats.missingPlayAttempts[0]?.src}`);
  app.restore();
}

// ------------------------------------- 21. no double-tap zoom on the controls
{
  section("21. Tapping controls must not trigger iOS double-tap zoom");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const repo = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
  const css = fs.readFileSync(path.join(repo, "css/styles.css"), "utf8");

  // Pull out every selector whose rule sets a touch-action that suppresses
  // double-tap zoom, then check each real control matches one of them.
  const covered = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, sel, body] = m;
    if (/touch-action:\s*(manipulation|none|pan-y)/.test(body)) covered.push(sel.trim());
  }
  const app = await boot({ duration: 0.6 });
  const controls = [...app.doc.querySelectorAll("button, summary, .switch input, .step__val, .seg")];
  const uncovered = controls.filter((elm) => !covered.some((sel) => {
    try { return elm.matches(sel); } catch (e) { return false; }
  }));
  check("every interactive control opts out of double-tap zoom",
    uncovered.length === 0,
    `uncovered: ${uncovered.map((e) => e.id || e.className || e.tagName).join(", ")}`);
  results.push(`     (${controls.length} controls checked against ${covered.length} touch-action rules)`);
  app.restore();
}

// ------------------------------ 22. every punch in a combo is actually spoken
// Records which combo was on screen and which clips were genuinely audible,
// then checks they match word for word. A move's on-screen label is identical
// to its clip key, so the displayed text can be compared directly.
async function collectSpokenVsShown(app, ms) {
  const shown = [];
  let last = app.combo();
  for (let t = 0; t < ms; t += 50) {
    await app.clock.advance(50);
    const c = app.combo();
    if (c !== last) { shown.push({ t: app.clock.now, combo: c }); last = c; }
  }
  const rows = [];
  for (let k = 0; k < shown.length - 1; k++) {
    const { t, combo } = shown[k];
    if (!combo.includes(" - ")) continue;
    const expected = combo.split(" - ");
    // The first word plays in the same instant the text updates, which this
    // 50ms sampler can only notice afterwards — so shift the window back a
    // little (still far inside the >=500ms gap between combos) and compare
    // only as many words as this combo actually has.
    const LAG = 200;
    const heard = app.stats.audible.filter((a) => a.t >= t - LAG && a.t < shown[k + 1].t - LAG)
      .map((a) => a.key).slice(0, expected.length);
    rows.push({ expected, heard });
  }
  return rows;
}
{
  section("22. Every punch in a combo is actually spoken");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 90); app.set("restSec", 5);
  app.setSeg("pace", "1500"); app.setSeg("level", "intermediate");
  app.click("startBtn");
  const before = app.stats.audible.length;
  const rows = await collectSpokenVsShown(app, 45000);
  const bad = rows.filter((r) => r.expected.join(",") !== r.heard.join(","));
  check("normal playback speaks every word, in order",
    rows.length >= 4 && bad.length === 0,
    bad.length ? `e.g. shown ${bad[0].expected.join("-")} but heard ${bad[0].heard.join("-") || "(nothing)"}` : `only ${rows.length} combos`);
  // Guards the opposite failure: an over-eager retry speaking words twice,
  // which is heard as clips cutting each other off and ragged timing.
  const wordsShown = rows.reduce((n, r) => n + r.expected.length, 0);
  const wordsHeard = app.stats.audible.length - before;
  check("no word is spoken twice (no spurious retries)",
    wordsHeard <= wordsShown + rows.length + 2,
    `${wordsShown} words shown but ${wordsHeard} clips played`);
  results.push(`     (${wordsShown} words shown, ${wordsHeard} clips played)`);
  check("only one clip ever sounds at a time", app.stats.maxVoiceConcurrent <= 1,
    `max ${app.stats.maxVoiceConcurrent} at once`);
  app.restore();
}
{
  section("23. A clip that dies silently must not leave a hole in the combo");
  // Half the pool elements report "ended" instantly without making a sound —
  // the failure behind "shown 1-2-3-4, heard 1 _ 3 4".
  const order = new Map();
  const app = await boot({
    duration: 0.6,
    phantomEnded: (el) => {
      if (!order.has(el)) order.set(el, order.size);
      return order.get(el) % 2 === 1;
    },
  });
  app.set("rounds", 1); app.set("workSec", 90); app.set("restSec", 5);
  app.setSeg("pace", "1500"); app.setSeg("level", "intermediate");
  app.click("startBtn");
  const rows = await collectSpokenVsShown(app, 45000);
  const bad = rows.filter((r) => r.expected.join(",") !== r.heard.join(","));
  check("silent clips are retried so no punch is skipped",
    rows.length >= 3 && bad.length === 0,
    bad.length ? `${bad.length}/${rows.length} combos had holes, e.g. shown ${bad[0].expected.join("-")} heard ${bad[0].heard.join("-") || "(nothing)"}` : `only ${rows.length} combos`);
  results.push(`     (${rows.length} combos checked; ${app.stats.phantoms.length} silent clips recovered)`);
  app.restore();
}

console.log(results.join("\n"));
console.log(`\n${"=".repeat(50)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(50)}`);
process.exit(fail ? 1 : 0);
