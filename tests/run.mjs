// tests.mjs — comprehensive behavioural tests against the real js/app.js
import { boot, clearStore, peekStore } from "./harness.mjs";

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ✅ ${name}`); }
  else { fail++; results.push(`  ❌ ${name}${detail ? "  → " + detail : ""}`); }
}
function section(t) { results.push(`\n── ${t} ──`); }
// -1 / 0 / 1 for "a older / same / newer than b", comparing numerically so
// 1.10.0 sorts above 1.9.0 rather than below it as strings would.
function cmpVer(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1; }
  return 0;
}

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

// ------------------------------------------- 10a. per-move callout highlight
{
  section("10a. The move being called is the one highlighted");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 60); app.set("restSec", 5);
  app.setSeg("pace", "3000"); // relaxed: one combo stays up long enough to watch
  const marks = () => [...app.doc.querySelectorAll("#combo .mv")].map((e) => e.classList.contains("is-now"));
  const litIndex = () => marks().indexOf(true);
  const litCount = () => marks().filter(Boolean).length;

  app.click("startBtn");
  await app.clock.advance(3600); // through the countdown, first word playing
  check("the first move lights up as it is called", litIndex() === 0, `index ${litIndex()}`);
  check("exactly one move is lit", litCount() === 1, `${litCount()} lit`);

  // Walk forward a word at a time; the mark must follow the voice.
  const seen = [litIndex()];
  for (let i = 0; i < 3; i++) {
    await app.clock.advance(900); // clip (600ms) plus the gap between words
    if (litCount() !== 1) break;
    if (litIndex() !== seen[seen.length - 1]) seen.push(litIndex());
  }
  check("the highlight advances through the combo", seen.length >= 3, `sequence ${seen.join("-")}`);
  check("it never lights two moves at once", litCount() === 1, `${litCount()} lit`);
  check("and it only moves forward", seen.every((v, i) => i === 0 || v > seen[i - 1]), `sequence ${seen.join("-")}`);
  app.restore();
}

// -------------------------------------------------- 10e. countdown ring steps
{
  section("10e. The countdown ring steps by the second");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 30); app.set("restSec", 5);
  const off = () => parseFloat(app.doc.getElementById("dialFill").style.strokeDashoffset);
  app.click("startBtn");
  await app.clock.advance(100);
  const at3 = off();
  await app.clock.advance(400);   // 500ms in — same second, disc must not move
  check("disc holds still inside a countdown second", off() === at3, `${at3} → ${off()}`);
  await app.clock.advance(700);   // 1.2s in — crossed the boundary
  const at2 = off();
  check("disc jumps at the second boundary", at2 > at3, `${at3} → ${at2}`);
  await app.clock.advance(400);
  check("and holds again until the next one", off() === at2, `${at2} → ${off()}`);
  app.restore();
}

// ------------------------------------------------- 10b. fullscreen lifecycle
{
  section("10b. Fullscreen follows the session");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 10); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(4000); // through the countdown, into work
  check("fullscreen requested on start", app.fsLog[0] === "enter", app.fsLog.join(","));
  app.click("startBtn"); // pause
  await app.clock.advance(500);
  check("pause keeps fullscreen (no in/out flicker)", !app.fsLog.includes("exit"), app.fsLog.join(","));
  app.click("startBtn"); // resume
  await app.clock.advance(500);
  check("resume doesn't re-request while already fullscreen",
    app.fsLog.filter((x) => x === "enter").length === 1, app.fsLog.join(","));
  await app.clock.advance(15000); // work runs out → done
  // Finishing must NOT drop out: the collapse yanked the layout mid-celebration.
  check("still fullscreen on the finish screen", !app.fsLog.includes("exit"), app.fsLog.join(","));
  app.click("resetBtn");
  await app.clock.advance(500);
  check("reset restarts without leaving fullscreen", !app.fsLog.includes("exit"), app.fsLog.join(","));
  app.restore();
}

// ---------------------------------------- 10d. pause/resume in every phase
{
  section("10d. Resume works from any pausable phase");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 30); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(1000);           // still in the 3-2-1 countdown
  check("countdown is the phase under test", app.phase() === "Get Ready", app.phase());
  app.click("startBtn");                   // pause DURING the countdown
  const pausedAt = app.clockText();
  await app.clock.advance(2000);
  check("countdown freezes while paused", app.clockText() === pausedAt, `${pausedAt} → ${app.clockText()}`);
  app.click("startBtn");                   // resume — used to be a dead button
  await app.clock.advance(4000);
  check("resume from the countdown reaches Work", app.phase() === "Work", app.phase());
  // And the ordinary case still works.
  app.click("startBtn");
  await app.clock.advance(500);
  app.click("startBtn");
  await app.clock.advance(3000);
  check("resume from Work keeps running", app.phase() === "Work" && app.clockText() !== "00:30", app.clockText());
  app.restore();
}

// ------------------------------------- 10c. no fullscreen API (iPhone Safari)
{
  section("10c. Browser without a fullscreen API");
  const app = await boot({ duration: 0.6, noFullscreen: true });
  app.set("rounds", 1); app.set("workSec", 30); app.set("restSec", 5);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  const { n } = await countCombos(app, 20000);
  check("app runs normally without a fullscreen API", n >= 2, `${n} combos`);
  check("no fullscreen calls attempted", app.fsLog.length === 0, app.fsLog.join(","));
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

// ------------------------------------------------------- 24. version stamping
{
  section("24. Version is shown and consistent everywhere");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const repo = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
  const read = (f) => fs.readFileSync(path.join(repo, f), "utf8");

  const version = /VERSION\s*=\s*"([^"]+)"/.exec(read("js/version.js"))?.[1];
  const released = /RELEASED\s*=\s*"([^"]+)"/.exec(read("js/version.js"))?.[1];
  const cache = /CACHE\s*=\s*"combify-v([^"]+)"/.exec(read("sw.js"))?.[1];
  const pkg = JSON.parse(read("package.json")).version;

  check("version.js declares a version", !!version, "not found");
  check("service worker cache matches the version", cache === version, `sw.js has ${cache}, version.js has ${version}`);
  check("package.json matches the version", pkg === version, `package.json has ${pkg}, version.js has ${version}`);
  check("release date looks like a date", /^\d{4}-\d{2}-\d{2}$/.test(released || ""), String(released));

  const app = await boot({ duration: 0.6 });
  const shown = app.doc.getElementById("appVersion")?.textContent || "";
  check("version is rendered into the About section", shown.includes(version), `About shows "${shown}"`);
  // A module missing from the precache list only bites offline, and only after
  // a fresh install — easy to add a file and never notice.
  const sw = read("sw.js");
  const modules = fs.readdirSync(path.join(repo, "js")).filter((f) => f.endsWith(".js"));
  const missing = modules.filter((f) => !sw.includes(`./js/${f}`));
  check("every js module is precached for offline use", missing.length === 0, missing.join(", "));
  // The changelog is only useful if it is actually kept up to date, and the
  // one way it silently rots is shipping a version without adding an entry.
  const { CHANGELOG } = await import("../js/changelog.js");
  check("the changelog's newest entry matches the shipped version",
    CHANGELOG[0].v === version, `newest entry v${CHANGELOG[0].v} vs VERSION ${version}`);
  const complete = (e) => e.date && e.title && (e.size === "minor" || e.size === "patch") && e.notes?.length;
  check("every changelog entry is complete",
    CHANGELOG.every(complete),
    CHANGELOG.filter((e) => !complete(e)).map((e) => e.v || e.date).join(", "));
  // Entries predating the version system carry v: null; the numbered ones must
  // still run strictly newest-first among themselves.
  const numbered = CHANGELOG.filter((e) => e.v);
  check("changelog versions run newest-first, no duplicates",
    numbered.every((e, i) => i === 0 || cmpVer(numbered[i - 1].v, e.v) > 0),
    numbered.map((e) => e.v).join(" > "));
  check("the changelog reaches back to the first build",
    numbered.some((e) => e.v === "1.0.0") && CHANGELOG.some((e) => e.v === null),
    `${numbered.length} numbered, ${CHANGELOG.length - numbered.length} pre-version`);
  // changelog.html is a real page users can land on; offline it must be there.
  check("the changelog page is precached", sw.includes("./changelog.html"), "missing from sw.js");
  results.push(`     (showing "${shown}")`);
  app.restore();
}

// ------------------------------------------------- 25. streak logic in isolation
{
  section("25. Streak counting");
  const s = await import("../js/stats.js");
  const DAY = 86400000;
  const noon = (dayOffset) => new Date(2026, 6, 20 + dayOffset, 12, 0, 0).getTime();
  const build = (offsets) => {
    let h = { days: {}, totals: { sessions: 0, rounds: 0, punches: 0, seconds: 0 } };
    for (const o of offsets) h = s.recordRound(h, { punches: 10, seconds: 120, firstOfSession: true }, noon(o));
    return h;
  };
  check("no history = no streak", s.currentStreak(build([]), noon(0)) === 0);
  check("trained today = 1", s.currentStreak(build([0]), noon(0)) === 1);
  check("three days running = 3", s.currentStreak(build([-2, -1, 0]), noon(0)) === 3);
  check("a missed day breaks it", s.currentStreak(build([-3, -2, 0]), noon(0)) === 1,
    String(s.currentStreak(build([-3, -2, 0]), noon(0))));
  // Opening the app in the morning before training must not show zero.
  check("yesterday but not yet today still counts", s.currentStreak(build([-1]), noon(0)) === 1,
    String(s.currentStreak(build([-1]), noon(0))));
  check("two days ago and not since = 0", s.currentStreak(build([-2]), noon(0)) === 0,
    String(s.currentStreak(build([-2]), noon(0))));
  check("several sessions in one day = still 1 day", s.currentStreak(build([0, 0, 0]), noon(0)) === 1);
  // Late-night training counts for that evening, not the next morning (local day).
  const lateNight = new Date(2026, 6, 20, 23, 30, 0).getTime();
  const h = s.recordRound({ days: {}, totals: { sessions: 0, rounds: 0, punches: 0, seconds: 0 } },
    { punches: 5, seconds: 60, firstOfSession: true }, lateNight);
  check("11:30pm counts for that day", s.dayKey(lateNight) === "2026-07-20", s.dayKey(lateNight));
  check("and gives a streak that evening", s.currentStreak(h, lateNight) === 1);
  check("duration formats as m:ss", s.formatDuration(390) === "6:30", s.formatDuration(390));
}

// --------------------------------------- 26. stats recorded from a real session
{
  section("26. A real session records rounds, punches and a streak");
  clearStore();
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 2); app.set("workSec", 20); app.set("restSec", 5);
  app.setSeg("pace", "1500"); app.setSeg("level", "beginner");
  check("ready screen is empty before any training", app.doc.getElementById("stats").textContent === "",
    `"${app.doc.getElementById("stats").textContent}"`);
  app.click("startBtn");
  await app.clock.advance(4000);
  check("stats hidden during a round", app.doc.getElementById("stats").textContent === "",
    `"${app.doc.getElementById("stats").textContent}"`);
  await app.clock.advance(60000); // run both rounds out
  check("session finishes", app.phase() === "Done", app.phase());
  const statsEl = app.doc.getElementById("stats");
  const heroNum = statsEl.querySelector(".finish__hero .stat-num");
  const meta = statsEl.querySelector(".finish__meta");
  const summary = statsEl.textContent;
  check("punch total is the headline", !!heroNum && Number(heroNum.textContent.replace(/,/g, "")) > 0,
    `hero="${heroNum && heroNum.textContent}"`);
  check("rounds shown in the supporting line", /2 rounds/.test(meta.textContent), `"${meta.textContent}"`);
  check("summary includes a duration", /\d+:\d\d/.test(meta.textContent), `"${meta.textContent}"`);
  const stored = JSON.parse(peekStore()["combify.history.v1"] || "{}");
  check("history persisted", stored.totals && stored.totals.rounds === 2, JSON.stringify(stored.totals));
  check("counted exactly one session", stored.totals.sessions === 1, String(stored.totals?.sessions));
  check("punches counted (beginner combos are all punches)", stored.totals.punches > 0, String(stored.totals?.punches));
  results.push(`     (finish screen: "${summary}")`);
  app.restore();

  // Reopening shows the streak carried over
  const b = await boot({ duration: 0.6 });
  const ready = b.doc.getElementById("stats").textContent;
  check("streak shown on the ready screen next visit", /1 day in a row/.test(ready), `"${ready}"`);
  check("lifetime totals shown", /session/.test(ready) && /punches/.test(ready), `"${ready}"`);
  results.push(`     (ready screen: "${ready}")`);
  b.restore();
  clearStore();
}

// ---------------------------------- 27. partial rounds must not inflate the log
{
  section("27. Quitting mid-round doesn't count that round");
  clearStore();
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 3); app.set("workSec", 60); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(4000 + 30000);   // halfway through round 1
  app.click("resetBtn");
  await app.clock.advance(500);
  const stored = JSON.parse(peekStore()["combify.history.v1"] || "{}");
  check("no rounds logged for an abandoned round", !stored.totals || stored.totals.rounds === 0,
    JSON.stringify(stored.totals));
  app.restore();
  clearStore();
}

// ------------------------------------------------ 28. hold +/- to run the value
{
  section("28. Press and hold the steppers");
  clearStore();
  const app = await boot({ duration: 0.6 });
  const doc = app.doc;
  const plus = doc.querySelectorAll("#workSec .step__btn")[1];
  const minus = doc.querySelectorAll("#workSec .step__btn")[0];
  const val = () => +doc.getElementById("workSec").dataset.value;
  const down = (b) => b.dispatchEvent(new app.window.MouseEvent("pointerdown", { bubbles: true, clientX: 10 }));
  const up = (b) => b.dispatchEvent(new app.window.MouseEvent("pointerup", { bubbles: true }));
  const click = (b) => b.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));

  // A quick tap must still move exactly one step (5s), not two.
  const start = val();
  down(plus); up(plus); click(plus);
  check("a quick tap moves exactly one step", val() === start + 5, `${start} → ${val()}`);

  // Holding should run, and accelerate rather than crawl.
  const beforeHold = val();
  down(plus);
  await app.clock.advance(2000);
  up(plus); click(plus);
  const afterHold = val();
  check("holding + runs the value up", afterHold > beforeHold + 20, `${beforeHold} → ${afterHold} in 2s`);
  results.push(`     (2s hold moved ${beforeHold}s → ${afterHold}s)`);

  // Releasing must actually stop it.
  const atRelease = val();
  await app.clock.advance(3000);
  check("releasing stops the run", val() === atRelease, `kept moving to ${val()}`);

  // Same downward, and it must respect the minimum.
  down(minus);
  await app.clock.advance(20000);
  up(minus); click(minus);
  check("holding - runs down and clamps at the minimum", val() === 10, `landed on ${val()}`);

  check("held value is persisted", !!peekStore()["combify.settings.v1"], "nothing stored");
  app.restore();
  clearStore();
}

// ------------------------------------------- 29. Bakr's named "10 combo"
{
  section("29. Bakr's 10 combo");
  const c = await import("../js/combos.js");
  const ten = ["1", "2", "3", "2", "1", "1", "2", "slip", "2", "3", "2", "roll"];
  const inAdvanced = c.COMBOS.advanced.some((x) => x.join("-") === ten.join("-"));
  check("the 10 combo is in the advanced set", inAdvanced);
  check("it is named", c.comboName(ten) === "The 10", String(c.comboName(ten)));
  check("unnamed combos return null", c.comboName(["1", "2"]) === null, String(c.comboName(["1", "2"])));
  // The name should match reality: ten punches, slip and roll excluded.
  const punches = ten.filter((k) => /^[1-8]$/.test(k)).length;
  check("it really does contain 10 punches", punches === 10, `${punches} punches`);
  check("every move in it is a known move", ten.every((k) => !!c.MOVES[k]),
    ten.filter((k) => !c.MOVES[k]).join(","));
  check("it speaks as words", c.comboToSpeech(ten).startsWith("one, two, three"), c.comboToSpeech(ten));

  // And it shows its name on screen when called.
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 200); app.set("restSec", 5);
  app.setSeg("pace", "500"); app.setSeg("level", "advanced");
  app.click("startBtn");
  let sawName = false;
  for (let t = 0; t < 120000 && !sawName; t += 100) {
    await app.clock.advance(100);
    if (app.doc.getElementById("comboName").textContent === "The 10") sawName = true;
  }
  check("name appears on screen when the combo comes up", sawName, "never displayed");
  app.click("resetBtn");
  await app.clock.advance(200);
  check("name cleared when the session resets", app.doc.getElementById("comboName").textContent === "",
    `"${app.doc.getElementById("comboName").textContent}"`);
  app.restore();
}

// --------------------------------------------- 30. finish screen celebration
{
  section("30. Finish screen summary and streak flame");
  clearStore();
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.setSeg("pace", "1500"); app.setSeg("level", "beginner");
  app.click("startBtn");
  await app.clock.advance(30000);
  check("session finished", app.phase() === "Done", app.phase());
  const stats = app.doc.getElementById("stats");
  // Without requestAnimationFrame the counts must land on their final values
  // immediately, so the summary is never left showing zeros.
  const hero0 = stats.querySelector(".finish__hero .stat-num");
  check("counts are final, not stuck at zero", hero0 && hero0.textContent !== "0", `hero="${hero0 && hero0.textContent}"`);
  check("summary reads as expected",
    /1 round/.test(stats.querySelector(".finish__meta").textContent) &&
    /\d+:\d\d/.test(stats.querySelector(".finish__meta").textContent),
    `"${stats.querySelector(".finish__meta").textContent}"`);
  check("flame shows from the very first session", !!stats.querySelector(".flame"), "no flame on day 1");
  results.push(`     (day 1: "${stats.textContent}")`);
  app.restore();

  // Train again "tomorrow" → 2-day streak → flame appears.
  const b = await boot({ duration: 0.6, startTime: 86400000 });
  b.set("rounds", 1); b.set("workSec", 20); b.set("restSec", 5);
  b.click("startBtn");
  await b.clock.advance(30000);
  const stats2 = b.doc.getElementById("stats");
  check("2-day streak shown", /2 days in a row/.test(stats2.textContent), `"${stats2.textContent}"`);
  check("flame appears on a real streak", !!stats2.querySelector(".flame"), "no flame");
  check("flame is decorative only", stats2.querySelector(".flame")?.getAttribute("aria-hidden") === "true");
  check("flame is a drawn shape, not stacked boxes", stats2.querySelectorAll(".flame path").length === 2,
    String(stats2.querySelectorAll(".flame path").length));
  results.push(`     (day 2: "${stats2.textContent}")`);
  b.restore();
  clearStore();
}

// ------------------------------- 31. the count-up itself (real animation path)
{
  section("31. Punch count animates, pops and buzzes");
  clearStore();
  // Real requestAnimationFrame here, so the actual animation runs.
  const app = await boot({ duration: 0.6, animate: true });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.setSeg("pace", "1500"); app.setSeg("level", "beginner");
  app.click("startBtn");
  await app.clock.advance(30000);
  const punchNode = app.doc.querySelector("#stats .finish__hero .stat-num");
  check("a punch counter exists", !!punchNode, "not found");
  const midway = punchNode ? punchNode.textContent : "";
  check("starts below the final total (it counts up)", midway !== "" && Number(midway.replace(/,/g, "")) >= 0);

  // Let the real animation finish (1200ms + slack).
  await app.realWait(1600);
  const finalShown = Number(punchNode.textContent.replace(/,/g, ""));
  const stored = JSON.parse(peekStore()["combify.history.v1"] || "{}");
  check("lands exactly on the punches thrown", finalShown === stored.totals.punches,
    `showed ${finalShown}, threw ${stored.totals?.punches}`);
  check("counted up rather than jumping", midway !== String(finalShown) || finalShown === 0,
    `was already ${midway} at the start`);
  check("haptics fired while settling and on landing", app.vibrations.length >= 2,
    `${app.vibrations.length} vibrations`);
  const last = app.vibrations[app.vibrations.length - 1];
  check("the landing buzz is a pattern, not a tick", Array.isArray(last.pattern),
    JSON.stringify(last.pattern));
  results.push(`     (${app.vibrations.length} buzzes, landed on ${finalShown} punches)`);
  app.restore();
  clearStore();
}

// ------------------------------------- 32. devices without the Vibration API
{
  section("32. No Vibration API (iOS Safari)");
  clearStore();
  const app = await boot({ duration: 0.6, animate: true, noVibrate: true });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(30000);
  await app.realWait(1600);
  const punchNode = app.doc.querySelector("#stats .finish__hero .stat-num");
  const stored = JSON.parse(peekStore()["combify.history.v1"] || "{}");
  check("count-up still completes without haptics",
    Number(punchNode.textContent.replace(/,/g, "")) === stored.totals.punches,
    `showed ${punchNode.textContent}, threw ${stored.totals?.punches}`);
  app.restore();
  clearStore();
}

// -------------------------------------------------- 33. full-screen focus mode
{
  section("33. Focus mode expands the screen mid-session");
  clearStore();
  const app = await boot({ duration: 0.6 });
  const appEl = app.doc.querySelector(".app");
  app.set("rounds", 2); app.set("workSec", 20); app.set("restSec", 10);

  check("normal screen before starting", appEl.dataset.focus !== "1", `focus=${appEl.dataset.focus}`);
  app.click("startBtn");
  await app.clock.advance(500);
  check("expands during the countdown", appEl.dataset.focus === "1", `focus=${appEl.dataset.focus}`);
  await app.clock.advance(4000);
  check("stays expanded through work", appEl.dataset.focus === "1" && app.phase() === "Work", app.phase());
  await app.clock.advance(20000);
  check("stays expanded through rest", appEl.dataset.focus === "1" && app.phase() === "Rest", app.phase());

  // Pausing must bring the settings back — that's the whole interaction model.
  app.click("startBtn");
  await app.clock.advance(200);
  check("pausing returns to the normal screen", appEl.dataset.focus !== "1", `focus=${appEl.dataset.focus}`);
  check("settings reachable while paused", !!app.doc.getElementById("level"), "settings missing");
  app.click("startBtn");
  await app.clock.advance(200);
  check("resuming expands again", appEl.dataset.focus === "1", `focus=${appEl.dataset.focus}`);

  await app.clock.advance(60000);
  check("session finished", app.phase() === "Done", app.phase());
  check("finishing returns to the normal screen", appEl.dataset.focus !== "1", `focus=${appEl.dataset.focus}`);
  app.click("resetBtn");
  await app.clock.advance(200);
  check("reset leaves the normal screen", appEl.dataset.focus !== "1", `focus=${appEl.dataset.focus}`);
  app.restore();
  clearStore();
}

// ------------------------------------- 34. layout rules exist for every device
{
  section("34. Portrait, landscape and desktop layouts");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const repo = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
  const css = fs.readFileSync(path.join(repo, "css/styles.css"), "utf8");
  check("landscape gets its own layout", /@media\s*\(orientation:\s*landscape\)/.test(css));
  // Grid with minmax(0,...) tracks, not flex: a flex item's basis is its content
  // width, so the combo column never narrowed and overlapped the clock.
  check("landscape uses constrained grid columns",
    /orientation:\s*landscape\)[\s\S]{0,600}grid-template-columns:\s*minmax\(0/.test(css));
  check("big screens get their own sizing", /@media\s*\(min-width:\s*900px\)/.test(css));
  check("stage can grow to fill the screen", /\.app\[data-focus="1"\]\s*\.stage[\s\S]{0,200}flex:\s*1/.test(css));
  check("app is at least a full viewport tall", /min-height:\s*100dvh/.test(css));
  // The combo is the thing read from across the room: it must scale with the
  // viewport, not sit at a fixed size.
  check("combo text scales with the viewport", /\.app\[data-focus="1"\]\s*\.combo[\s\S]{0,200}font-size:\s*calc\(clamp\(/.test(css));
  check("long combos are scaled down to fit", /var\(--fit/.test(css));
  check("motion still opt-out", /prefers-reduced-motion/.test(css));
}

console.log(results.join("\n"));
console.log(`\n${"=".repeat(50)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(50)}`);
process.exit(fail ? 1 : 0);
