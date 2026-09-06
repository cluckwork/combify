// tests.mjs — comprehensive behavioural tests against the real js/app.js
import { boot, clearStore, peekStore, runAndSample } from "./harness.mjs";

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

// -------------------------------------- 1b. ready screen shows session length
{
  section("1b. Ready screen shows the whole session's length");
  clearStore();
  const app = await boot({ duration: 0.6 });
  // Defaults: 3 rounds × 120s work + 2 × 30s rest = 420s. The clock must
  // answer "how long will this take?" instead of showing 00:00.
  check("total time shown at boot", app.clockText() === "07:00", app.clockText());
  // Changing a setting through the real UI updates it live.
  const plus = app.doc.querySelectorAll("#rounds .step__btn")[1];
  plus.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  check("total follows the settings (4 rounds)", app.clockText() === "09:30", app.clockText());
  // One round means no rest at all — the session ends on the bell.
  const minus = app.doc.querySelectorAll("#rounds .step__btn")[0];
  for (let i = 0; i < 3; i++) minus.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  check("a single round counts no rest", app.clockText() === "02:00", app.clockText());
  // And exiting a session lands back on the total, not a dead 00:00.
  app.click("startBtn");
  await app.clock.advance(1000);
  app.click("startBtn"); // pause mid-countdown
  app.click("exitBtn");
  await app.clock.advance(200);
  check("back on the ready screen, the total returns", app.clockText() === "02:00", app.clockText());
  app.restore();
  clearStore();
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
  await app.clock.advance(6500);                    // countdown done
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

// ------------------------------------------------------- 8. rest-end warning
// (This section replaced the voice on/off toggle tests when the toggle was
// removed in v1.12.0 — the voice is always on now.)
{
  section("8. Rest warns before it ends");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 2); app.set("workSec", 15); app.set("restSec", 20);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  await app.clock.advance(6500);           // countdown → into work
  await app.clock.advance(15000);          // work runs out → rest begins (20s)
  check("in Rest for this test", app.phase() === "Rest", app.phase());
  const warnBase = app.stats.byKey.warning || 0;
  const tickBase = app.stats.byKey.tick || 0;
  await app.clock.advance(8000);           // still >10s left — must stay quiet
  check("no early warning deep inside rest", (app.stats.byKey.warning || 0) === warnBase,
    `${(app.stats.byKey.warning || 0) - warnBase} extra`);
  await app.clock.advance(3000);           // crosses the 10s-left boundary
  check("the 10-second heads-up plays in rest", (app.stats.byKey.warning || 0) === warnBase + 1,
    `warning plays: ${warnBase} → ${app.stats.byKey.warning || 0}`);
  await app.clock.advance(8000);           // through 3-2-1 into the next round
  check("the last three seconds tick like the countdown", (app.stats.byKey.tick || 0) >= tickBase + 3,
    `tick plays: ${tickBase} → ${app.stats.byKey.tick || 0}`);
  check("round 2 starts after the run-in", app.phase() === "Work", app.phase());
  app.restore();

  // A rest of 10s or less skips the heads-up (it would fire on top of the rest
  // bell) but keeps the 3-2-1 run-in.
  const b = await boot({ duration: 0.6 });
  b.set("rounds", 2); b.set("workSec", 15); b.set("restSec", 10);
  b.click("startBtn");
  await b.clock.advance(6500);
  await b.clock.advance(15000);            // into the 10s rest
  const warnBase2 = b.stats.byKey.warning || 0;
  const tickBase2 = b.stats.byKey.tick || 0;
  await b.clock.advance(9500);             // nearly the whole rest
  check("a short rest skips the 10s heads-up", (b.stats.byKey.warning || 0) === warnBase2,
    `${(b.stats.byKey.warning || 0) - warnBase2} extra`);
  check("but keeps the 3-2-1 run-in", (b.stats.byKey.tick || 0) >= tickBase2 + 3,
    `tick plays: ${tickBase2} → ${b.stats.byKey.tick || 0}`);
  b.restore();
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
  // Restart is still a session — the screen must stay awake through it.
  const releasesBefore = app.wakeLog.filter((x) => x === "release").length;
  app.click("resetBtn");
  await app.clock.advance(500);
  check("restart keeps the wake lock held",
    app.wakeLog.filter((x) => x === "release").length === releasesBefore, app.wakeLog.join(","));
  app.click("exitBtn");
  await app.clock.advance(500);
  check("released on exit", app.wakeLog.includes("release"), app.wakeLog.join(","));
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
  await app.clock.advance(7200); // countdown 5s + 1.6s first-call runway + ~600ms: first word playing
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
  await app.clock.advance(6500); // through the countdown, into work
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
  check("countdown is the phase under test",
    app.doc.getElementById("stage").dataset.phase === "countdown",
    app.doc.getElementById("stage").dataset.phase);
  app.click("startBtn");                   // pause DURING the countdown
  const pausedAt = app.clockText();
  await app.clock.advance(2000);
  check("countdown freezes while paused", app.clockText() === pausedAt, `${pausedAt} → ${app.clockText()}`);
  app.click("startBtn");                   // resume — used to be a dead button
  await app.clock.advance(6500);
  check("resume from the countdown reaches Work", app.phase() === "Work", app.phase());
  // And the ordinary case still works.
  app.click("startBtn");
  await app.clock.advance(500);
  app.click("startBtn");
  await app.clock.advance(5500);
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

// ============================================================================
// 10f–10i. AUDIO RESILIENCE. Every one of these was silent-in-the-real-world
// before: the app carried on perfectly, the timer ran, and no error was
// raised — it just made no sound.
// ============================================================================

// --------------------------------- 10f. context suspended when you hit Start
{
  section("10f. Audio context suspended at Start");
  // Browsers hand you a suspended context until a gesture resumes it, and
  // resume() is ASYNC. start() used to fire the first countdown tick straight
  // after asking for a resume, so the tick was scheduled against a suspended
  // context and never made a sound.
  const app = await boot({ duration: 0.6, audioSuspended: true });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(1200);
  // The first tick now arrives as a media-element sample, which doesn't need
  // the AudioContext at all — the strongest form of "heard even while the
  // context is suspended". The synth path satisfies this too, for the case
  // where the sample errored.
  check("the first countdown tick is actually heard",
    (app.stats.byKey.tick || 0) >= 1 || app.synth.oscStarted > 0,
    `tick samples ${app.stats.byKey.tick || 0}, oscillators ${app.synth.oscStarted}, lost ${app.synth.lost}`);
  check("no sound was fired into a suspended context", app.synth.lost === 0, `${app.synth.lost} lost`);
  await app.clock.advance(3000);
  check("the round-start bell is heard too", (app.stats.byKey.bell || 0) >= 1 || app.synth.oscStarted > 1,
    `bell samples ${app.stats.byKey.bell || 0}, oscillators ${app.synth.oscStarted}`);
  app.restore();
}

// ------------------------- 10g. the phone locks / a call comes in mid-round
{
  section("10g. Context suspended mid-round (phone locked, call, app switch)");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 60); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(6500);
  const before = app.stats.audible.length;
  // The OS suspends the context. Nothing in the app used to notice, and every
  // tick, bell and warning was silent for the remainder of the session.
  app.synth.ctx.state = "suspended";
  Object.defineProperty(app.doc, "visibilityState", { value: "visible", configurable: true });
  app.doc.dispatchEvent(new app.window.Event("visibilitychange"));
  await app.clock.advance(500);
  check("coming back re-arms the audio context", app.synth.ctx.state === "running", app.synth.ctx.state);
  await app.clock.advance(52000); // run out the round: warning beeps + end bell
  check("sound returns for the rest of the session", app.stats.audible.length > before,
    `audible ${before} → ${app.stats.audible.length}`);
  check("nothing was lost to the suspended context", app.synth.lost === 0, `${app.synth.lost} lost`);
  app.restore();
}

// -------------------------------------- 10h. suspended while paused, then resumed
{
  section("10h. Suspended while paused, then resumed");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 60); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(6500);
  app.click("startBtn");                    // pause
  app.synth.ctx.state = "suspended";        // ...and the OS pulls audio away
  const before = app.stats.audible.length;
  app.click("startBtn");                    // resume — a real user gesture
  await app.clock.advance(200);
  check("resuming re-arms the context", app.synth.ctx.state === "running", app.synth.ctx.state);
  await app.clock.advance(58000);
  check("sound continues after resuming", app.stats.audible.length > before,
    `audible ${before} → ${app.stats.audible.length}`);
  app.restore();
}

// ------------------------------------------- 10i. one clip file is missing
{
  section("10i. A single missing clip");
  // One bad file used to flip the WHOLE app to robotic text-to-speech.
  // Knock out the two most common moves so a combo containing one is a
  // certainty rather than a dice roll, while staying under the threshold that
  // abandons clips altogether.
  const app = await boot({ duration: 0.6, missingClips: ["1", "2"] });
  app.set("rounds", 1); app.set("workSec", 90); app.set("restSec", 5);
  app.setSeg("pace", "1500"); app.setSeg("level", "advanced");
  app.click("startBtn");
  await app.clock.advance(60000);
  const spokenKeys = Object.keys(app.stats.byKey).filter((k) => k !== "bell" && k !== "1" && k !== "2");
  check("the other words still play from their clips", spokenKeys.length >= 3, spokenKeys.join(","));
  check("combos keep advancing despite the missing word", app.stats.plays > 10, `${app.stats.plays} plays`);
  check("the missing word is spoken instead of skipped silently",
    app.speechLog.some((l) => l.startsWith("speak:")), app.speechLog.slice(0, 3).join(" | "));
  app.restore();
}

// -------------------------------------- 10k. backgrounded mid-round, then back
{
  section("10k. Leaving the app mid-round and coming back");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 90); app.set("restSec", 5);
  app.setSeg("pace", "1500");
  app.click("startBtn");
  await app.clock.advance(8000);
  // Backgrounded: iOS pauses media and throttles timers. The chain must be
  // CUT here — a half-alive chain is what burst into overlapping words on
  // return, or never recovered at all.
  Object.defineProperty(app.doc, "visibilityState", { value: "hidden", configurable: true });
  app.doc.dispatchEvent(new app.window.Event("visibilitychange"));
  const during = await countCombos(app, 8000);
  check("no combos while backgrounded", during.n === 0, `${during.n} advanced`);
  // Return.
  Object.defineProperty(app.doc, "visibilityState", { value: "visible", configurable: true });
  app.doc.dispatchEvent(new app.window.Event("visibilitychange"));
  const after = await countCombos(app, 20000);
  check("combos resume promptly on return", after.n >= 2, `${after.n} combos in 20s`);
  check("no words tumbling over each other on return", app.stats.maxVoiceConcurrent <= 1,
    `max ${app.stats.maxVoiceConcurrent} at once`);
  // And returning during REST must not start calling combos into the break.
  const app2 = await boot({ duration: 0.6 });
  app2.set("rounds", 2); app2.set("workSec", 8); app2.set("restSec", 20);
  app2.setSeg("pace", "1500");
  app2.click("startBtn");
  await app2.clock.advance(13000); // into rest
  Object.defineProperty(app2.doc, "visibilityState", { value: "hidden", configurable: true });
  app2.doc.dispatchEvent(new app2.window.Event("visibilitychange"));
  await app2.clock.advance(1000);
  Object.defineProperty(app2.doc, "visibilityState", { value: "visible", configurable: true });
  app2.doc.dispatchEvent(new app2.window.Event("visibilitychange"));
  const restCombos = await countCombos(app2, 4000);
  check("returning during rest stays quiet", restCombos.n === 0, `${restCombos.n} combos in rest`);
  app2.restore();
  app.restore();
}

// ------------------------------------------------------ 10j. install nudge
{
  section("10j. Install nudge is earned, not thrown at strangers");
  // A finished session is the price of admission. Asking on arrival was the
  // old behaviour and it burned the one ask on people who had never trained.
  const IOS = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari", noVibrate: true };
  // beforeinstallprompt fires on desktop Chrome too, but a computer has no
  // home screen and is never offered any of this — so the one-tap prompt path
  // is exercised where it actually matters.
  const ANDROID = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0 Mobile Safari/537.36", maxTouchPoints: 5 };
  const offerInstall = (app) => {
    const ev = new app.window.Event("beforeinstallprompt");
    ev.prompt = () => {};
    ev.userChoice = new Promise(() => {});
    app.window.dispatchEvent(ev);
    return ev;
  };
  // Run one real session to completion, then walk back out to the ready screen.
  const trainAndExit = async (app) => {
    app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
    app.click("startBtn");
    await app.clock.advance(40000);
    app.click("exitBtn");
  };

  clearStore();
  const app = await boot({ duration: 0.6, ...ANDROID });
  const nudge = () => app.doc.getElementById("installNudge");
  check("hidden at boot", nudge().hidden === true, "visible at boot");
  offerInstall(app);
  check("still hidden when the browser offers install but nothing is trained yet",
    nudge().hidden === true, "asked a stranger");
  await trainAndExit(app);
  check("appears once a session has been finished", nudge().hidden === false, "still hidden");
  check("with a real Install button", app.doc.getElementById("installBtn").hidden === false, "button hidden");
  check("iOS steps stay hidden where a real prompt exists",
    app.doc.getElementById("installSteps").hidden === true, "steps shown");
  app.restore();

  // Tapping Install runs the browser's own prompt.
  clearStore();
  const appP = await boot({ duration: 0.6, ...ANDROID });
  let prompted = 0;
  const ev = new appP.window.Event("beforeinstallprompt");
  ev.prompt = () => { prompted++; };
  ev.userChoice = Promise.resolve({ outcome: "accepted" });
  appP.window.dispatchEvent(ev);
  await trainAndExit(appP);
  appP.click("installBtn");
  await appP.clock.advance(50);
  await Promise.resolve(); await Promise.resolve();
  check("tapping Install calls the browser prompt", prompted === 1, `prompted ${prompted}`);
  check("accepting hides the nudge", appP.doc.getElementById("installNudge").hidden === true, "still visible");
  appP.restore();

  // iOS gets the numbered Share steps instead — Apple exposes no install API.
  clearStore();
  const appI = await boot({ duration: 0.6, ...IOS });
  await trainAndExit(appI);
  check("iOS shows the nudge after a session", appI.doc.getElementById("installNudge").hidden === false, "hidden");
  check("iOS shows the Share steps", appI.doc.getElementById("installSteps").hidden === false, "steps hidden");
  check("iOS hides the Install button it cannot use",
    appI.doc.getElementById("installBtn").hidden === true, "button shown");
  appI.restore();

  // Dismissing SNOOZES. The old build made it permanent, so one reflex tap
  // silenced the ask for a member who went on to train every day.
  clearStore();
  const appD = await boot({ duration: 0.6, ...IOS });
  await trainAndExit(appD);
  appD.click("installDismiss");
  check("dismiss hides it", appD.doc.getElementById("installNudge").hidden === true, "still visible");
  appD.restore();
  const appD2 = await boot({ duration: 0.6, ...IOS });
  check("still quiet during the snooze week", appD2.doc.getElementById("installNudge").hidden === true, "came back too soon");
  appD2.restore();
  // Same device, eight days later.
  const LATER = Date.now() + 8 * 86400000;
  const appD3 = await boot({ duration: 0.6, startTime: LATER, ...IOS });
  check("asks once more after the snooze expires",
    appD3.doc.getElementById("installNudge").hidden === false, "stayed silent");
  appD3.click("installDismiss");
  appD3.restore();
  const appD4 = await boot({ duration: 0.6, startTime: LATER + 30 * 86400000, ...IOS });
  check("two declines means never again", appD4.doc.getElementById("installNudge").hidden === true, "asked a third time");
  appD4.restore();

  // The old permanent tombstone is honoured as one decline, not a life
  // sentence: it answered a question asked before the member had trained.
  clearStore();
  {
    const seed = await boot({ duration: 0.6, ...IOS });
    seed.window.localStorage.setItem("combify.installDismissed", "1");
    await trainAndExit(seed);
    check("a legacy dismissal still suppresses the ask now",
      seed.doc.getElementById("installNudge").hidden === true, "ignored the old choice");
    seed.restore();
  }
  const appL = await boot({ duration: 0.6, startTime: Date.now() + 8 * 86400000, ...IOS });
  check("but it is asked again a week later", appL.doc.getElementById("installNudge").hidden === false, "silenced forever");
  check("the legacy key is migrated away",
    peekStore()["combify.installDismissed"] === undefined, "old key still there");
  appL.restore();
  clearStore();

  // A session must fold the nudge away with the rest of the chrome (CSS is
  // asserted in the layout suite; here just confirm the row's still in flow).
  const app4 = await boot({ duration: 0.6, ...ANDROID });
  check("nudge element exists for the layout to manage", !!app4.doc.querySelector(".install"), "missing");
  app4.restore();
  clearStore();

  // A computer is offered nothing at all — not the dialog, not the strip, not
  // even when Chrome volunteers a real install prompt on a Mac.
  const mac = await boot({ duration: 0.6 });
  offerInstall(mac);
  await trainAndExit(mac);
  check("a computer is never offered the strip, prompt or not",
    mac.doc.getElementById("installNudge").hidden === true, "a laptop was asked to install");
  check("and no dialog either", mac.doc.getElementById("insModal").hidden === true, "dialog on a laptop");
  mac.restore();
  clearStore();
}

// ----------------------------------------------- 10m. restarts must be cheap
{
  section("10m. Priming happens once, not on every start");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 8); app.set("restSec", 3);
  app.click("startBtn");
  await app.clock.advance(20000);           // session runs out
  app.click("exitBtn");
  await app.clock.advance(500);
  const before = app.stats.plays;
  app.click("startBtn");                    // second session
  await app.clock.advance(600);
  const delta = app.stats.plays - before;
  // First start primed one element per sound (~17 muted plays). A restart
  // must NOT repeat that burst — the re-prime jank was a reported freeze.
  check("a restart does not re-prime the audio pools", delta <= 4,
    `${delta} plays in the first 600ms of the second session`);
  app.restore();
}

// ---------------------------- 10n. chain cut inside a word gap must not stutter
{
  section("10n. A chain cut mid-gap leaves no zombie behind");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 90); app.set("restSec", 5);
  app.setSeg("pace", "3000"); // relaxed: the widest word gaps, the reported case
  app.click("startBtn");
  await app.clock.advance(5140 + 2250); // settle (140ms) + countdown, runway (1.6s), word 1 (600ms) → inside its gap
  // Background + return INSIDE the inter-word gap. The old anonymous gap timer
  // survived the cut and revived the old combo next to the new one — two
  // chains interleaving through the same pools, heard as stuttering.
  Object.defineProperty(app.doc, "visibilityState", { value: "hidden", configurable: true });
  app.doc.dispatchEvent(new app.window.Event("visibilitychange"));
  await app.clock.advance(50);
  Object.defineProperty(app.doc, "visibilityState", { value: "visible", configurable: true });
  app.doc.dispatchEvent(new app.window.Event("visibilitychange"));
  await app.clock.advance(20000);
  check("only one chain speaks (no interleaved zombie)", app.stats.maxVoiceConcurrent <= 1,
    `max ${app.stats.maxVoiceConcurrent} at once`);
  check("no overlap events at all", app.stats.overlapEvents.length === 0,
    JSON.stringify(app.stats.overlapEvents.slice(0, 3)));
  app.restore();
}

// -------------------------------------------- 10p. the entrance crossfade
{
  section("10p. The entrance crossfades, then the countdown holds");
  // With motion (animate:true provides the requestAnimationFrame that
  // motionOK() keys on) the start is a crossfade: settings fade out, the
  // layout swaps while dark, the countdown fades in — and only then does the
  // clock start ticking.
  const app = await boot({ duration: 0.6, animate: true });
  app.set("rounds", 1); app.set("workSec", 10); app.set("restSec", 3);
  const appEl = app.doc.querySelector(".app");
  app.click("startBtn");
  // Priming inside the Start tap plays one muted tick element — baseline it
  // so only REAL (audible, post-tap) ticks are counted below.
  const tickBase = app.stats.byKey.tick || 0;
  await app.clock.advance(50);
  check("screen fades out first (layout not yet swapped)",
    appEl.classList.contains("is-entering") && app.phase() === "Ready",
    `entering=${appEl.classList.contains("is-entering")} phase=${app.phase()}`);
  await app.clock.advance(250); // fade-out (160ms) + swap + class release (40ms)
  check("countdown layout arrives behind the fade",
    app.doc.getElementById("stage").dataset.phase === "countdown" && app.clockText() === "5",
    `${app.phase()} / ${app.clockText()}`);
  check("fade released after the swap", !appEl.classList.contains("is-entering"), "still fading");
  check("Get ready is on screen", app.combo() === "Get ready...", app.combo());
  await app.clock.advance(300); // t=600: still inside the post-swap hold (760ms)
  check("clock still holding 5 mid-entrance", app.clockText() === "5", app.clockText());
  check("no tick before the entrance lands", (app.stats.byKey.tick || 0) === tickBase,
    `${(app.stats.byKey.tick || 0) - tickBase} early ticks`);
  await app.clock.advance(300); // t=900: crosses fade (160) + settle (600)
  check("first tick fires once the entrance settles", (app.stats.byKey.tick || 0) >= tickBase + 1,
    `${(app.stats.byKey.tick || 0) - tickBase} ticks`);
  await app.clock.advance(5500); // full countdown from the re-anchored clock
  check("round is underway", app.phase() === "Work", app.phase());
  // Pausing mid-session and exiting must never strand the app faded out.
  app.click("resetBtn"); // restart: no crossfade needed (layout unchanged)
  await app.clock.advance(100);
  check("restart skips the crossfade (already fullscreen)", !appEl.classList.contains("is-entering"),
    "is-entering on restart");
  app.click("startBtn"); app.click("exitBtn");
  await app.clock.advance(100);
  check("exit leaves the app fully visible", !appEl.classList.contains("is-entering"), "stranded invisible");
  app.restore();

  // Without motion the fold doesn't animate, so only the short beat applies.
  const b = await boot({ duration: 0.6 });
  b.set("rounds", 1); b.set("workSec", 10); b.set("restSec", 3);
  b.click("startBtn");
  const tickBaseB = b.stats.byKey.tick || 0;
  await b.clock.advance(300);
  check("no long hold in a no-motion environment", (b.stats.byKey.tick || 0) >= tickBaseB + 1,
    `${(b.stats.byKey.tick || 0) - tickBaseB} ticks after 300ms`);
  await b.clock.advance(6000);
  check("countdown still reaches Work", b.phase() === "Work", b.phase());
  b.restore();
}

// ------------------------------------------------------ 11. element count sanity
{
  section("11. Audio element count (iOS decoder pressure)");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 3); app.set("workSec", 20); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(80000);
  // Budget: 12 words × pool of 2, plus sfx pools (bell 3, tick 2, warning 2)
  // and the initial preload elements. Fixed per session regardless of combo
  // count — which is what "no leak per combo" means.
  check("element count stays bounded (no leak per combo)", app.stats.created <= 56, `${app.stats.created} created`);
  results.push(`     (${app.stats.created} elements for a 3-round session)`);
  app.restore();
}

// ------------------------------------------------------------ 12. timer accuracy
{
  section("12. Timer accuracy");
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 60); app.set("restSec", 10);
  app.click("startBtn");
  await app.clock.advance(5500);                    // countdown
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
  // Simulate PERSISTENT load errors on the preloaded clips: twice each,
  // because the first error is absorbed by the cache-bust retry (v1.15) —
  // a genuinely broken file errors again on the refetch.
  for (let round = 0; round < 2; round++) {
    for (const a of app.stats.live) if (a._l.error) for (const fn of [...a._l.error]) fn({ type: "error" });
  }
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
  for (let round = 0; round < 2; round++) {
    for (const a of app.stats.live) if (a._l.error) for (const fn of [...a._l.error]) fn({ type: "error" });
  }
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
  await app.clock.advance(5500);
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
  await app.clock.advance(5500);
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
  // and the restored settings must actually drive the session
  b.click("startBtn");
  await b.clock.advance(6500);
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
  section("19. Bell, tick and warning play as real samples");
  // They ship as files and play through the media pipeline because Web Audio
  // output is muted by the iPhone ring/silent switch while media elements are
  // not — the synth-only bell was silent on any phone set to silent, which is
  // most phones. The synth survives below as the fallback.
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(6500);          // 3 countdown ticks, then round 1 bell
  check("the countdown ticks play as samples", (app.stats.byKey.tick || 0) >= 2,
    `tick plays: ${app.stats.byKey.tick || 0}`);
  check("the round-start bell plays as a sample", (app.stats.byKey.bell || 0) >= 1,
    `bell plays: ${app.stats.byKey.bell || 0}`);
  const afterStart = app.stats.byKey.bell || 0;
  await app.clock.advance(25000);         // 10s warning, then session-over bell x3
  check("the 10-second warning plays as a sample", (app.stats.byKey.warning || 0) >= 1,
    `warning plays: ${app.stats.byKey.warning || 0}`);
  check("the session-end bell rings all three strikes", (app.stats.byKey.bell || 0) >= afterStart + 3,
    `bell plays: ${afterStart} → ${app.stats.byKey.bell || 0}`);
  // Exactly one synth sound is expected: the tick fired inside start() runs
  // before the sample's load event, so it uses the fallback. Everything after
  // must come from samples.
  check("no synth needed once the samples are loaded", app.synth.oscStarted <= 1,
    `${app.synth.oscStarted} oscillators`);
  app.restore();
}

// ------------------------------------- 19b. sfx files missing → synth fallback
{
  section("19b. Missing sfx files fall back to the synth");
  const app = await boot({ duration: 0.6, missingClips: ["bell", "tick", "warning"] });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(6500);
  check("ticks and bell still sound via the synth", app.synth.oscStarted > 0,
    `${app.synth.oscStarted} oscillators`);
  await app.clock.advance(25000);
  check("the session still ends with an audible bell", app.synth.oscStarted >= 4,
    `${app.synth.oscStarted} oscillators`);
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
  await app.clock.advance(6500);
  check("bell still rings with zero load events",
    (app.stats.byKey.bell || 0) >= 1 || app.synth.oscStarted > 0,
    `bell samples ${app.stats.byKey.bell || 0}, oscillators ${app.synth.oscStarted}`);
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
    const heard = app.stats.audible.filter((a) => a.voice && a.t >= t - LAG && a.t < shown[k + 1].t - LAG)
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
  const voiceHeard = () => app.stats.audible.filter((a) => a.voice).length;
  const before = voiceHeard();
  const rows = await collectSpokenVsShown(app, 45000);
  const bad = rows.filter((r) => r.expected.join(",") !== r.heard.join(","));
  check("normal playback speaks every word, in order",
    rows.length >= 4 && bad.length === 0,
    bad.length ? `e.g. shown ${bad[0].expected.join("-")} but heard ${bad[0].heard.join("-") || "(nothing)"}` : `only ${rows.length} combos`);
  // Guards the opposite failure: an over-eager retry speaking words twice,
  // which is heard as clips cutting each other off and ragged timing.
  const wordsShown = rows.reduce((n, r) => n + r.expected.length, 0);
  const wordsHeard = voiceHeard() - before;
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
  // Every second PLAY dies silently ("ended" with no sound) — the failure
  // behind "shown 1-2-3-4, heard 1 _ 3 4". Per-play, not per-element: marking
  // elements permanently silent could brick BOTH elements of a word's pool,
  // which no real phone does and no retry could ever beat.
  let playN = 0;
  const app = await boot({
    duration: 0.6,
    phantomEnded: () => (playN++ % 2 === 1),
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
  // Same for every sound. The clips and sfx were absent from the precache for
  // weeks: an installed app opened offline ran the whole session in silence.
  const audioFiles = [];
  const walkAudio = (dir) => {
    for (const f of fs.readdirSync(path.join(repo, dir))) {
      const rel = dir + "/" + f;
      if (fs.statSync(path.join(repo, rel)).isDirectory()) walkAudio(rel);
      else if (/\.(mp3|wav)$/.test(f)) audioFiles.push(rel);
    }
  };
  walkAudio("audio");
  const missingAudio = audioFiles.filter((f) => !sw.includes(`./${f}`));
  check("every audio file is precached for offline use", missingAudio.length === 0, missingAudio.join(", "));
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
  await app.clock.advance(6500);
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
  check("it is named", c.comboName(ten) === "10 combo", String(c.comboName(ten)));
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
  // Force the pick rather than hoping. "10 combo" is 1 of 9 advanced combos, so
  // waiting for it to turn up randomly failed roughly one run in seven — a
  // test that fails on a dice roll teaches you to ignore it. Alternating two
  // values matters: randomCombo() re-rolls while it matches the last pick, so
  // a constant would spin forever.
  const realRandom = Math.random;
  let n = 0;
  Math.random = () => (n++ % 2 === 0 ? 0 : 0.5); // 0 selects "10 combo"
  try {
    app.click("startBtn");
    let sawName = false;
    for (let t = 0; t < 30000 && !sawName; t += 100) {
      await app.clock.advance(100);
      if (app.doc.getElementById("comboName").textContent === "10 combo") sawName = true;
    }
    check("name appears on screen when the combo comes up", sawName, "never displayed");
  } finally { Math.random = realRandom; }
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
  // animate:true supplies requestAnimationFrame so motionOK() picks the
  // animated path; the count itself runs on (virtual) timers since v1.14.1
  // — the real-phone audit log showed rAF frame drops lurching the blip
  // rhythm — so the whole finale is deterministic under the clock.
  const app = await boot({ duration: 0.6, animate: true });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.setSeg("pace", "1500"); app.setSeg("level", "beginner");
  app.click("startBtn");
  let guard31 = 0;
  while (app.phase() !== "Done" && guard31++ < 400) await app.clock.advance(100);
  check("session finished", app.phase() === "Done", app.phase());
  const punchNode = app.doc.querySelector("#stats .finish__hero .stat-num");
  check("a punch counter exists", !!punchNode, "not found");
  // Step through the staged finale, sampling the hero number as it climbs.
  const seen = new Set();
  for (let t = 0; t < 6000; t += 100) {
    await app.clock.advance(100);
    seen.add(punchNode.textContent);
  }
  const finalShown = Number(punchNode.textContent.replace(/,/g, ""));
  const stored = JSON.parse(peekStore()["combify.history.v1"] || "{}");
  check("lands exactly on the punches thrown", finalShown === stored.totals.punches,
    `showed ${finalShown}, threw ${stored.totals?.punches}`);
  check("counted up rather than jumping", seen.size >= 3, `only saw ${[...seen].join(", ")}`);
  const blipPlays = app.stats.audible.filter((a) => a.key === "blip" && !a.muted);
  const blips = blipPlays.length;
  check("the climb is audible and lands with a hit",
    blips >= 3 && app.stats.audible.some((a) => a.key === "land"), `${blips} blips`);
  // Uniformity: the riff must respect the 50ms floor and never lurch — the
  // rAF-driven count-up failed exactly this on a real phone (gaps of 139ms
  // where the schedule said 50).
  const blipGaps = blipPlays.slice(1).map((b, i) => b.t - blipPlays[i].t);
  check("blip rhythm is uniform (all gaps 45-500ms)",
    blipGaps.length > 0 && blipGaps.every((g) => g >= 45 && g <= 500),
    `gaps: ${blipGaps.join(",")}`);
  check("haptics fired while settling and on landing", app.vibrations.length >= 2,
    `${app.vibrations.length} vibrations`);
  const last = app.vibrations[app.vibrations.length - 1];
  check("the landing buzz is a pattern, not a tick", Array.isArray(last.pattern),
    JSON.stringify(last.pattern));
  results.push(`     (${app.vibrations.length} buzzes, ${blips} blips, landed on ${finalShown} punches)`);
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
  await app.clock.advance(34000); // session + staged finale + count, all on the virtual clock
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
  await app.clock.advance(6500);
  check("stays expanded through work", appEl.dataset.focus === "1" && app.phase() === "Work", app.phase());
  await app.clock.advance(20000);
  check("stays expanded through rest", appEl.dataset.focus === "1" && app.phase() === "Rest", app.phase());

  // The session is ONE continuous fullscreen thing: pausing and restarting
  // stay inside it, and only the exit button leaves.
  app.click("startBtn");
  await app.clock.advance(200);
  check("pausing STAYS fullscreen", appEl.dataset.focus === "1", `focus=${appEl.dataset.focus}`);
  app.click("startBtn");
  await app.clock.advance(200);
  check("resuming carries on fullscreen", appEl.dataset.focus === "1", `focus=${appEl.dataset.focus}`);

  // The restart icon runs it back — new session, still fullscreen.
  app.click("resetBtn");
  await app.clock.advance(500);
  check("restart mid-session starts over WITHOUT leaving fullscreen",
    appEl.dataset.focus === "1" && app.doc.getElementById("stage").dataset.phase === "countdown",
    `focus=${appEl.dataset.focus} phase=${app.phase()}`);

  await app.clock.advance(60000);
  check("session finished", app.phase() === "Done", app.phase());
  check("the finish screen STAYS fullscreen", appEl.dataset.focus === "1", `focus=${appEl.dataset.focus}`);
  // Exit is the one door out.
  app.click("exitBtn");
  await app.clock.advance(200);
  check("exit returns to the normal screen", appEl.dataset.focus !== "1", `focus=${appEl.dataset.focus}`);
  check("settings reachable after exiting", !!app.doc.getElementById("level"), "settings missing");
  // And on the plain ready screen, Reset keeps its ordinary meaning.
  app.click("resetBtn");
  await app.clock.advance(200);
  check("reset on the ready screen stays on the normal screen", appEl.dataset.focus !== "1", `focus=${appEl.dataset.focus}`);
  app.restore();
  clearStore();
}

// --------------------------------------------- 33b. finish headline rotates
{
  section("33b. The finish headline varies");
  const LINES = ["Nice work.", "Strong finish.", "That's a wrap.", "Well earned.", "Sharp today.",
    "In the bank.", "Round's yours.", "Solid rounds.", "Keep showing up.", "That's the way."];
  const seen = new Set();
  // Force the random walk through several picks; assert every one is from the
  // approved set and that consecutive sessions never repeat a headline.
  let prev = null, repeats = 0;
  for (let i = 0; i < 6; i++) {
    const app = await boot({ duration: 0.6 });
    app.set("rounds", 1); app.set("workSec", 10); app.set("restSec", 3);
    app.click("startBtn");
    await app.clock.advance(20000);
    const line = app.combo();
    seen.add(line);
    if (line === prev) repeats++;
    prev = line;
    if (!LINES.includes(line)) { seen.add("UNKNOWN:" + line); break; }
    app.restore();
  }
  check("every headline comes from the approved set", [...seen].every((l) => LINES.includes(l)), [...seen].join(" | "));
  check("headlines vary across sessions", seen.size >= 2, `only saw: ${[...seen].join(" | ")}`);
  results.push(`     (saw ${seen.size} distinct: ${[...seen].join(" · ")})`);
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

// ---------------------- 36. a combo never launches into the end-of-round bell
// The first real-phone audit log caught a combo starting 120ms before the
// round-2 bell — its first word chopped mid-syllable. nextCombo now goes
// quiet when the bell is under 1.3s away (room for the longest first word
// plus the between-words guard's clearance).
{
  section("36. No combo launches right before the bell");
  clearStore();
  // rngSeed 13 is load-bearing: seed-scanned so that WITHOUT the guard a
  // combo provably launches inside the bell window (the test was first
  // written with a seed that never lined one up, and passed on broken code).
  const app = await boot({ duration: 0.6, rngSeed: 13 });
  app.set("rounds", 3); app.set("workSec", 20); app.set("restSec", 5);
  app.setSeg("pace", "500"); app.setSeg("level", "advanced");
  app.click("startBtn");
  await app.clock.advance(95000);
  check("session finished", app.phase() === "Done", app.phase());
  // A combo START is a voice play after ≥400ms of voice silence (within-combo
  // gaps are ~45ms at Fast). Work→rest and work→done transitions ring bells;
  // no combo may begin in the guard window before one.
  const voice = app.stats.audible.filter((a) => a.voice && !a.muted);
  const bells = app.stats.audible.filter((a) => !a.voice && a.key === "bell").map((b) => b.t);
  let launched = 0, intoBell = 0;
  for (let i = 0; i < voice.length; i++) {
    const prevEnd = i ? voice[i - 1].t + 600 : -1e9;
    if (voice[i].t - prevEnd < 400) continue; // mid-combo word, not a launch
    launched++;
    if (bells.some((b) => b > voice[i].t && b - voice[i].t < 1250)) intoBell++;
  }
  check("combos were launched at all", launched >= 6, `${launched}`);
  check("none launched within 1.25s of a bell", intoBell === 0, `${intoBell} launched into the bell`);
  app.restore();
  clearStore();
}

// ------------------------- 37. a wedged element can't keep swallowing a word
// The second real-phone log: slip's first pool element got stuck "playing"
// at 0:00 for an entire session — a play() iOS neither started nor rejected.
// Every other slip landed on the zombie: a 2-second silent hole where the
// word should be, three times, then a robot-voice fallback. The fix heals
// the element (load()) and retries the word on the pool's twin.
{
  section("37. A wedged clip element cannot silently skip its word");
  clearStore();
  let zombie = null;
  const app = await boot({
    duration: 0.6, rngSeed: 11,
    playWedged: (el) => {
      if (el.key !== "slip" || el.muted) return false;
      if (!zombie) zombie = el; // first slip element wedges, forever — like the real log
      return el === zombie;
    },
  });
  app.set("rounds", 1); app.set("workSec", 40); app.set("restSec", 5);
  app.setSeg("pace", "500"); app.setSeg("level", "intermediate");
  app.click("startBtn");
  const seen = await runAndSample(app, 60000);
  const slipShown = seen.reduce((n, s) => n + (s.combo.match(/slip/g) || []).length, 0);
  const slipHeard = app.stats.audible.filter((a) => a.key === "slip" && !a.muted).length;
  check("combos with slip occurred", slipShown >= 2, `${slipShown} shown`);
  check("every shown slip was heard (zombie healed, word retried)",
    slipHeard >= slipShown, `shown ${slipShown}, heard ${slipHeard}`);
  app.restore();
  clearStore();
}

// ------------------- 38. Report a problem: description + session log travel
// The member-facing exit for the flight recorder. No audit arming needed —
// recording is always on — and jsdom has no share sheet, so the report must
// land in the copyable prompt fallback carrying both the member's words and
// the session's sound log.
{
  section("38. Report a problem: silent delivery, thanks, and the offline fallback");
  clearStore();
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 15); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(40000);
  const reportBtn = [...app.doc.querySelectorAll(".foot button")].find((b) => /report/i.test(b.textContent));
  check("footer has a Report a problem button", !!reportBtn);
  const modal = app.doc.getElementById("reportModal");
  const textEl = app.doc.getElementById("reportText");
  const click = (el) => el.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));

  // Happy path: the relay accepts, the member just gets thanked.
  const posts = [];
  const testStub = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { posts.push({ url, body: opts && opts.body }); return { ok: true }; };
  click(reportBtn);
  check("the styled dialog opens", !modal.hidden);
  textEl.value = "the bell rang twice at the end";
  click(app.doc.getElementById("reportSend"));
  await app.clock.advance(50);
  const relayPost = posts.find((p) => p.url.includes("formsubmit.co"));
  const sheetPost = posts.find((p) => p.url.includes("docs.google.com"));
  check("report POSTs to the email relay silently", !!relayPost);
  check("report also files itself into the triage Sheet", !!sheetPost && sheetPost.body.includes("entry."));
  check("report carries the member's words", !!relayPost && relayPost.body.includes("the bell rang twice at the end"));
  check("report carries the session's sound log", !!relayPost && relayPost.body.includes("PROBLEM REPORT") && /word/.test(relayPost.body));
  check("member sees the thank-you", !app.doc.getElementById("reportThanks").hidden);
  await app.clock.advance(2500);
  check("dialog closes itself after thanking", modal.hidden);

  // Offline path: delivery fails → the report lands in the copyable prompt.
  globalThis.fetch = () => Promise.reject(new Error("offline"));
  const prompts = [];
  app.window.prompt = (msg, text) => { prompts.push({ msg, text }); return null; };
  click(reportBtn);
  textEl.value = "no wifi in the gym";
  click(app.doc.getElementById("reportSend"));
  await app.clock.advance(100);
  const fallback = prompts.find((p) => p.text);
  check("offline report falls back to a copyable prompt", !!fallback && fallback.text.includes("no wifi in the gym"));
  check("fallback names where to send it", !!fallback && fallback.msg.includes("jduterme77@gmail.com"));
  globalThis.fetch = testStub;
  app.restore();
  clearStore();
}

// ---------------------------- 35. Audit mode: the on-device flight recorder
// The founder path, end to end: five taps arm it, a session records, "Copy
// audit log" exports a log that actually contains the diagnostic events,
// five more taps disarm it. This is the tool real-phone stutter reports
// depend on — it must never quietly rot.
{
  section("35. Audit mode records and exports a session");
  clearStore();
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 15); app.set("restSec", 5);
  app.setSeg("pace", "1500"); app.setSeg("level", "beginner");
  const ver = app.doc.getElementById("appVersion");
  const tap = () => ver.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 5; i++) tap();
  check("five taps arm audit mode", ver.textContent === "audit on", ver.textContent);
  const btn = app.doc.querySelector(".foot__audit");
  check("copy button appears", !!btn && btn.textContent === "Copy audit log");

  app.click("startBtn");
  await app.clock.advance(45000);
  check("session still completes with audit on", app.phase() === "Done", app.phase());

  // jsdom has no clipboard; the copy flow falls back to window.prompt.
  let log = null;
  app.window.prompt = (msg, text) => { log = text; return null; };
  btn.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  await app.clock.advance(50);
  check("copy exports the log", typeof log === "string" && log.length > 0);
  check("copy button confirms", btn.textContent === "Copied ✓", btn.textContent);
  check("log names the build", log && log.includes("Combify v"));
  for (const must of ["phase  work", "combo  ", "word  ", "word:end", "sfx  bell"]) {
    check(`log contains "${must.trim()}" events`, log && log.includes(must));
  }
  // Element state travels with each play — the part that makes a stutter
  // report diagnosable ("was the element parked, ended, or mid-file?").
  check("word events carry element state", log && / word {2}\S+ a\d ct=\d/.test(log));
  // Real sound ONSETS are recorded (the "playing" event), and the dump ends
  // with the per-sound uniformity report — the founder's yardstick for
  // "did the sounds come out uniformly and clearly".
  check("log records actual sound onsets", log && log.includes("word:out") && log.includes("sfx:out"));
  check("log ends with a uniformity report", log && log.includes("onset uniformity:") && / {2}word:out \S+: n=\d+ latency \d+-\d+ms/.test(log));

  for (let i = 0; i < 5; i++) tap();
  check("five more taps disarm", ver.textContent === "audit off", ver.textContent);
  check("copy button removed when off", !app.doc.querySelector(".foot__audit"));
  app.restore();
}

// ------------------------------------- 39. Install steps match the platform
{
  section("39. Install steps tell the truth about THIS device");
  // The bug this locks down: every iOS visitor used to get "tap Share, then
  // Add to Home Screen". In Chrome on an iPhone that menu item does not
  // exist — Apple gives the install path to Safari alone — so the app was
  // confidently instructing people to do something impossible.
  const { installGuide, canInstall, deviceClass, deviceOS } = await import("../js/platform.js");
  const as = (userAgent, maxTouchPoints = 5) => {
    Object.defineProperty(globalThis, "navigator",
      { value: { userAgent, maxTouchPoints }, configurable: true, writable: true });
  };
  const savedNav = globalThis.navigator;

  const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
  const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1";
  const IPAD_OS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

  as(IPHONE_SAFARI);
  let g = installGuide(false);
  check("iPhone Safari gets the Share steps", g.mode === "ios", g.mode);
  // The route on iPhone now needs an intermediate tap Apple added: the bar at
  // the bottom, THEN the ••• that appears, and Share is in there. Reported
  // from a real phone after the old copy sent someone hunting for a Share
  // button that is no longer on the toolbar.
  check("iPhone Safari is sent to the bar at the bottom first",
    g.steps[0].includes("bar at the bottom"), g.steps[0]);
  check("and then to the ••• that appears there", g.steps[0].includes("{menudots}"), g.steps[0]);
  check("named by its icon, not by repeating the dots in text",
    g.steps[0].includes("{menudots} button") && !g.steps[0].includes("•••"), g.steps[0]);
  check("Share is its own step now", g.steps[1].includes("{share}"), g.steps[1]);
  check("nothing to automate on iOS", g.action === null, String(g.action));
  check("the reason line is one plain sentence, not display-mode jargon",
    g.sub.split(/\s+/).length <= 9 && !/fullscreen|address bar|standalone|offline/i.test(g.sub), g.sub);
  // Reported from a real iPhone: expanding the sheet is a REQUIRED step of
  // its own, it is called "View more", and Add to Home Screen is still
  // further down after that. Two earlier builds got this wrong.
  const viewMore = g.steps.findIndex((x) => /\{chevron\}/.test(x) && /View more/.test(x));
  const addHome = g.steps.findIndex((x) => /Add to Home Screen/.test(x));
  check("\"View more\" is a step of its own, not an aside", viewMore >= 0, g.steps.join(" | "));
  check("and it comes BEFORE Add to Home Screen", viewMore >= 0 && viewMore < addHome,
    `View more at ${viewMore}, Add to Home Screen at ${addHome}`);
  check("with the scroll that still follows it", /Scroll down/i.test(g.steps[addHome] || ""),
    g.steps[addHome]);
  check("and it ends on Add to Home Screen, then the Add confirm",
    /Add to Home Screen/.test(g.steps[g.steps.length - 1]) && /then <strong>Add<\/strong>/.test(g.steps[g.steps.length - 1]),
    g.steps[g.steps.length - 1]);

  // Since iOS 16.4 every iOS browser can install from its own Share menu.
  // Combify used to send these people on a detour through Safari for a
  // limitation Apple had already removed.
  as(IPHONE_CHROME);
  g = installGuide(false);
  check("iPhone Chrome gets the same install steps, not a detour", g.mode === "ios", g.mode);
  check("no Safari-switching anywhere in the copy",
    !/only Safari|Open in Safari/i.test(g.sub + g.steps.join(" ")), g.sub);
  check("but it IS pointed at Chrome's own Share button",
    g.steps[0].includes("top right, beside the address"), g.steps[0]);
  check("and Chrome needs no intermediate tap — Share is right there",
    g.steps[0].includes("{share}"), g.steps[0]);
  check("and nothing to automate there either", g.action === null, String(g.action));

  as(IPAD_OS);
  check("iPadOS is not mistaken for a Mac", deviceClass() === "tablet" && deviceOS() === "ios",
    `${deviceOS()}/${deviceClass()}`);
  g = installGuide(false);
  check("iPad is pointed at the toolbar at the TOP", g.steps[0].includes("toolbar at the top"), g.steps[0]);

  as(ANDROID);
  check("Android is a phone we can install on", canInstall() && deviceOS() === "android", deviceOS());
  check("Android without a prompt event gets its menu steps",
    installGuide(false).mode === "android-manual", installGuide(false).mode);
  check("a real prompt always wins over written steps",
    installGuide(true).action === "prompt", installGuide(true).action);

  // Every browser hides "install" behind a different button in a different
  // corner, and naming the wrong one is the whole failure.
  const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36";
  const EDGE_A = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 EdgA/120.0";
  as(ANDROID);
  check("Chrome on Android is sent to the three dots, top right",
    /\{menu\}/.test(installGuide(false).steps[0]) && /top right/.test(installGuide(false).steps[0]),
    installGuide(false).steps[0]);
  as(SAMSUNG);
  check("Samsung Internet is sent to the stacked lines in its BOTTOM bar",
    /\{menulines\}/.test(installGuide(false).steps[0]) && /bottom right/.test(installGuide(false).steps[0]),
    installGuide(false).steps[0]);
  as(EDGE_A);
  check("Edge on Android is sent to the horizontal dots along the bottom",
    /\{menudots\}/.test(installGuide(false).steps[0]) && /bottom/.test(installGuide(false).steps[0]),
    installGuide(false).steps[0]);
  check("and the install item carries its own icon",
    /\{install\}/.test(installGuide(false).steps[1]), installGuide(false).steps[1]);

  // Every {token} a guide can emit must be a glyph app.js actually draws, or
  // it renders as an empty gap where a picture should be.
  const DRAWN = ["share", "addhome", "menu", "menulines", "menudots", "install", "chevron"];
  const emitted = new Set();
  for (const ua of [IPHONE_SAFARI, IPHONE_CHROME, IPAD_OS, ANDROID, SAMSUNG, EDGE_A]) {
    as(ua);
    for (const hasPrompt of [false, true]) {
      for (const step of installGuide(hasPrompt).steps) {
        for (const m of step.matchAll(/\{(\w+)\}/g)) emitted.add(m[1]);
      }
    }
  }
  check("every glyph token used has a drawing behind it",
    [...emitted].every((t) => DRAWN.includes(t)),
    [...emitted].filter((t) => !DRAWN.includes(t)).join(", ") || "none missing");
  check("and the iOS add-to-home icon is among them", emitted.has("addhome"), [...emitted].join(","));

  // The on-screen pointer must aim at the edge nearest the real button. A page
  // cannot see browser furniture, so this is the closest honest thing — and an
  // arrow pointing the wrong way is worse than no arrow at all.
  as(IPHONE_SAFARI);
  check("iPhone Safari's pointer aims DOWN at the toolbar",
    installGuide(false).aim.edge === "bottom", JSON.stringify(installGuide(false).aim));
  as(IPAD_OS);
  check("iPad's aims UP instead — same browser, other end of the screen",
    installGuide(false).aim.edge === "top", JSON.stringify(installGuide(false).aim));
  as(IPHONE_CHROME);
  check("Chrome on iPhone aims up and right, at the address bar",
    installGuide(false).aim.edge === "top" && installGuide(false).aim.side === "right",
    JSON.stringify(installGuide(false).aim));
  as(SAMSUNG);
  check("Samsung Internet aims down and right, at its bottom bar",
    installGuide(false).aim.edge === "bottom" && installGuide(false).aim.side === "right",
    JSON.stringify(installGuide(false).aim));
  check("and a one-tap install points at nothing — the button is ours",
    installGuide(true).aim == null, JSON.stringify(installGuide(true).aim));
  // Where we are only guessing, we point at nothing and say so. Firefox, Edge
  // and Opera on iOS each hide their menu somewhere different, and a confident
  // arrow into the wrong corner is worse than none.
  const FIREFOX_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/121.0 Mobile/15E148 Safari/605.1.15";
  as(FIREFOX_IOS);
  check("Firefox on iOS is told what to look FOR, not where to look",
    /often behind/.test(installGuide(false).steps[0]), installGuide(false).steps[0]);
  check("and no pointer, rather than one aimed at the wrong corner",
    installGuide(false).aim === null, JSON.stringify(installGuide(false).aim));
  check("it still gets the real destination though",
    installGuide(false).steps.some((x) => /Add to Home Screen/.test(x)),
    installGuide(false).steps.join(" | "));

  // THE INVARIANT THAT MATTERS. Routes to the Share button keep changing —
  // twice now they have shipped wrong. The destination has not moved in a
  // decade. Every iOS browser must name it, whatever the route.
  for (const ua of [IPHONE_SAFARI, IPHONE_CHROME, IPAD_OS, FIREFOX_IOS]) {
    as(ua);
    const steps = installGuide(false).steps.join(" | ");
    check(`every route still ends at the same place (${/CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : /iPhone/.test(ua) ? "Safari" : "iPad"})`,
      /\{share\}/.test(steps) && /Add to Home Screen/.test(steps), steps);
  }

  // Anything that DOES carry a pointer must agree with its own sentence — the
  // sweep below is what stops a reworded step drifting from its arrow.
  for (const ua of [IPHONE_SAFARI, IPHONE_CHROME, IPAD_OS, ANDROID, SAMSUNG, EDGE_A, FIREFOX_IOS]) {
    as(ua);
    const g = installGuide(false);
    if (!g.aim) continue;
    check(`pointer agrees with its wording (${g.aim.edge})`,
      g.steps[0].includes(g.aim.edge), `aims ${g.aim.edge}, says "${g.steps[0]}"`);
  }

  // Computers get none of this. There is no home screen to add anything to,
  // no share sheet to hunt through, and nothing outside the page worth an
  // arrow — a laptop that offers a real one-tap install does it through the
  // browser's own button, which is not ours to point at either.
  // The arrow shows whatever step one says to tap. These drifted apart once:
  // Safari's first step became "tap the bar, then •••" while the arrow still
  // showed Share — pointing at a button that is not the one you press first.
  for (const [ua, want] of [[IPHONE_SAFARI, "menudots"], [IPHONE_CHROME, "share"], [IPAD_OS, "share"], [ANDROID, "menu"], [SAMSUNG, "menulines"]]) {
    as(ua);
    const g = installGuide(false);
    if (!g.aim) continue;
    check(`the arrow's icon is step one's icon (${want})`,
      (/\{(\w+)\}/.exec(g.steps[0]) || [])[1] === want,
      `${(/\{(\w+)\}/.exec(g.steps[0]) || [])[1]} in "${g.steps[0]}"`);
  }

  as(MAC, 0);
  check("a computer is never asked to add a home-screen icon", canInstall() === false, deviceClass());
  check("and never gets a pointer, prompt or not",
    installGuide(false).aim == null && installGuide(true).aim == null,
    `${JSON.stringify(installGuide(false).aim)} / ${JSON.stringify(installGuide(true).aim)}`);

  Object.defineProperty(globalThis, "navigator", { value: savedNav, configurable: true, writable: true });
}

// -------------------------------- 40. The dialog, and who is allowed to see it
{
  section("40. The add-to-home-screen dialog is earned, and skips computers");
  const IOS = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1", maxTouchPoints: 5, noVibrate: true };
  const trainAndExit = async (app) => {
    app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
    app.click("startBtn");
    await app.clock.advance(40000);
    app.click("exitBtn");
    await app.clock.advance(60);
  };

  clearStore();
  const app = await boot({ duration: 0.6, ...IOS });
  const dlg = () => app.doc.getElementById("insModal");
  check("closed at boot", dlg().hidden === true, "open on arrival");
  await trainAndExit(app);
  check("opens once a session has been finished", dlg().hidden === false, "never opened");
  check("carrying the real iPhone steps",
    app.doc.getElementById("insSteps").textContent.includes("Add to Home Screen"),
    app.doc.getElementById("insSteps").textContent);
  check("with an escape hatch", !!app.doc.getElementById("insSkip"), "no skip");
  // A stray tap outside the card must NOT answer the question. This is the
  // one moment the app asks for something it wants, and dismissing by reflex
  // is not the same as deciding.
  const scrim = app.doc.getElementById("insModal");
  scrim.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  check("tapping the scrim does not dismiss it", scrim.hidden === false, "a stray tap closed it");
  app.click("insSkip");
  check("skip closes it", dlg().hidden === true, "still open");
  check("the quiet strip is what remains", app.doc.getElementById("installNudge").hidden === false, "strip gone too");
  app.restore();

  // Asked once, not every session — the strip carries it from here.
  const app2 = await boot({ duration: 0.6, ...IOS });
  await trainAndExit(app2);
  check("never asked a second time", app2.doc.getElementById("insModal").hidden === true, "asked again");
  check("but the footer keeps a way back in",
    [...app2.doc.querySelectorAll(".foot button")].some((b) => /home screen/i.test(b.textContent)),
    "no footer route");
  app2.restore();

  // A computer has no home screen; the ask is pure noise there.
  clearStore();
  const appD = await boot({ duration: 0.6 });
  await trainAndExit(appD);
  check("a computer is never interrupted by it", appD.doc.getElementById("insModal").hidden === true, "asked a laptop");
  check("and gets no footer link either",
    ![...appD.doc.querySelectorAll(".foot button")].some((b) => /home screen/i.test(b.textContent)),
    "footer link on desktop");
  appD.restore();
  clearStore();
}

// ------------------------- 41. Usage pings can tell members and days apart
{
  section("41. Usage pings carry enough to tell new from returning");
  clearStore();
  const posts = [];
  // boot() installs its own network-disabled fetch, so the recorder has to go
  // in AFTER the app is up — same order as the report test above.
  const app = await boot({ duration: 0.6 });
  const testStub = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { posts.push({ url, body: String((opts && opts.body) || "") }); return { ok: true }; };
  app.set("rounds", 1); app.set("workSec", 15); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(40000);
  await app.clock.advance(50);

  const pings = posts.filter((p) => p.body.includes("SESSION_PING"))
    .map((p) => JSON.parse(decodeURIComponent(/entry\.227585221=([^&]*)/.exec(p.body)[1].replace(/\+/g, " "))));
  check("a session start and finish are both pinged", pings.length >= 2, `${pings.length} pings`);
  const fin = pings[pings.length - 1];
  check("the ping is still anonymous (no user-agent)",
    !JSON.stringify(fin).includes("Mozilla") && !("ua" in fin), JSON.stringify(fin));
  check("it carries the device shape instead", typeof fin.p === "string" && fin.p.length > 0, fin.p);
  check("it says when this device first appeared", /^\d{4}-\d{2}-\d{2}$/.test(fin.f), fin.f);
  check("it says how many sessions this device has ever done", fin.s >= 1, String(fin.s));
  check("it says how many distinct days it has trained", fin.days >= 1, String(fin.days));
  check("it carries the streak", typeof fin.st === "number", String(fin.st));
  check("and is not flagged as the developer's own device", fin.dev === undefined, String(fin.dev));
  app.restore();

  // ?dev=1 marks this device so the founder's own testing can be subtracted
  // from the daily digest instead of being counted as a member.
  posts.length = 0;
  const appDev = await boot({ duration: 0.6, search: "?dev=1" });
  globalThis.fetch = async (url, opts) => { posts.push({ url, body: String((opts && opts.body) || "") }); return { ok: true }; };
  appDev.set("rounds", 1); appDev.set("workSec", 15); appDev.set("restSec", 5);
  appDev.click("startBtn");
  await appDev.clock.advance(40000);
  await appDev.clock.advance(50);
  const devPings = posts.filter((p) => p.body.includes("SESSION_PING"))
    .map((p) => JSON.parse(decodeURIComponent(/entry\.227585221=([^&]*)/.exec(p.body)[1].replace(/\+/g, " "))));
  check("?dev=1 flags every ping from that device", devPings.length > 0 && devPings.every((x) => x.dev === 1),
    JSON.stringify(devPings[0]));
  check("the same device is still counted as returning", devPings[devPings.length - 1].s >= 2,
    String(devPings[devPings.length - 1].s));
  appDev.restore();

  // The guard that stops development traffic being counted as members. The
  // layout suite drives a real browser with real network access, so without
  // this every test run filed real-looking rows into the production sheet —
  // one afternoon produced 94 "unique members", every one of them a browser
  // context this repo had just launched.
  posts.length = 0;
  const local = await boot({ duration: 0.6, origin: "http://localhost:8000/" });
  globalThis.fetch = async (url, opts) => { posts.push({ url, body: String((opts && opts.body) || "") }); return { ok: true }; };
  local.set("rounds", 1); local.set("workSec", 15); local.set("restSec", 5);
  local.click("startBtn");
  await local.clock.advance(40000);
  await local.clock.advance(50);
  check("a session on localhost pings nothing at all",
    posts.filter((p) => p.body.includes("SESSION_PING")).length === 0,
    `${posts.filter((p) => p.body.includes("SESSION_PING")).length} pings escaped`);
  check("and the session itself still runs normally",
    local.doc.getElementById("phase").textContent.trim() === "Done",
    local.doc.getElementById("phase").textContent);
  local.restore();

  const file = await boot({ duration: 0.6, origin: "http://127.0.0.1:8000/" });
  posts.length = 0;
  file.set("rounds", 1); file.set("workSec", 15); file.set("restSec", 5);
  file.click("startBtn");
  await file.clock.advance(40000);
  check("127.0.0.1 is silent too", posts.filter((p) => p.body.includes("SESSION_PING")).length === 0,
    `${posts.filter((p) => p.body.includes("SESSION_PING")).length} pings escaped`);
  file.restore();

  globalThis.fetch = testStub;
  clearStore();
}

// ---------------------------- 42. Dev mode is invisible until it is invited
{
  section("42. Dev mode: hidden from members, reachable without an address bar");
  clearStore();
  const plain = await boot({ duration: 0.6 });
  check("a member sees no dev badge", !plain.doc.querySelector(".devbadge"), "badge on a member's phone");
  check("and no dev panel", !plain.doc.querySelector(".devpanel"), "panel on a member's phone");
  plain.restore();

  clearStore();
  const dev = await boot({ duration: 0.6, search: "?dev=1" });
  check("?dev=1 raises the badge", !!dev.doc.querySelector(".devbadge"), "no badge");
  check("the badge says so plainly", /DEV/.test(dev.doc.querySelector(".devbadge").textContent),
    dev.doc.querySelector(".devbadge").textContent);
  // The badge carries this device's ping id. With no server and no registry,
  // reading it off the device is the only way to know which anonymous rows in
  // the sheet belong to which physical phone.
  const uid = peekStore()["combify.uid"];
  // Installing does not carry the flag across, so the panel has to say so —
  // this is the trap that files the founder's own training as a member's.
  // The badge is class-only, so click the element rather than an id.
  dev.doc.querySelector(".devbadge").dispatchEvent(new dev.window.MouseEvent("click", { bubbles: true }));
  const panelText = dev.doc.querySelector(".devpanel").textContent;
  check("the panel warns that the installed copy starts with dev off",
    /separate storage/i.test(panelText) && /five times/i.test(panelText), panelText.slice(0, 160));
  check("and shows the id this device pings with",
    !!uid && dev.doc.querySelector(".devbadge").textContent.includes(uid),
    `badge "${dev.doc.querySelector(".devbadge").textContent}" vs uid "${uid}"`);
  dev.restore();

  // The five-tap gesture is the ONLY route once Combify is installed: a
  // home-screen app on iOS gets its own storage, separate from the Safari tab
  // it was installed from, and there is no address bar in there to retype
  // ?dev=1 into.
  clearStore();
  const tap = await boot({ duration: 0.6 });
  const tagEl = tap.doc.querySelector(".brand__tag");
  const hit = () => tagEl.dispatchEvent(new tap.window.MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 4; i++) hit();
  check("four taps do nothing", !tap.doc.querySelector(".devbadge"), "turned on too early");
  hit();
  check("the fifth tap turns dev mode on", !!tap.doc.querySelector(".devbadge"), "no badge after five taps");
  check("and it says what just happened", /dev mode on/i.test(tagEl.textContent), tagEl.textContent);
  check("the flag is stored for next launch", peekStore()["combify.dev"] === "1",
    String(peekStore()["combify.dev"]));
  for (let i = 0; i < 5; i++) hit();
  check("five more taps turn it back off", !tap.doc.querySelector(".devbadge"), "badge stayed");
  check("and the flag is gone", peekStore()["combify.dev"] === undefined,
    String(peekStore()["combify.dev"]));
  tap.restore();

  // A platform override is dev-only: the key alone must never be enough, or a
  // stale value could pin a real member to somebody else's install steps.
  const { installGuide } = await import("../js/platform.js");
  clearStore();
  const pinned = await boot({ duration: 0.6, search: "?dev=1" });
  pinned.window.localStorage.setItem("combify.dev.platform", "ipad");
  check("dev mode can pin the install card to another device",
    installGuide(false).steps[0].includes("toolbar at the top"), installGuide(false).steps[0]);
  pinned.window.localStorage.removeItem("combify.dev");
  check("without dev mode the override is ignored",
    installGuide(false).mode !== "ios-safari" || !installGuide(false).steps[0].includes("(top of Safari)"),
    installGuide(false).mode);
  pinned.restore();
  clearStore();
}

// ---------------- 43. Every iOS browser is treated the same, and correctly
{
  section("43. iOS: same steps everywhere, and an install link that skips the wait");
  // A correction, and the test that pins it. Combify shipped a build that told
  // Chrome-on-iPhone users only Safari could install web apps and walked them
  // through switching browsers. True until iOS 16.4, false ever since — Chrome,
  // Edge and Firefox on iOS all install from their own Share menu, and the
  // result launches standalone and takes push like any other.
  const CHROME_IOS = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120.0 Mobile Safari/604.1", maxTouchPoints: 5, noVibrate: true };
  const SAFARI_IOS = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1", maxTouchPoints: 5, noVibrate: true };
  const trainAndExit = async (app) => {
    app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
    app.click("startBtn");
    await app.clock.advance(40000);
    app.click("exitBtn");
    await app.clock.advance(60);
  };

  clearStore();
  const chrome = await boot({ duration: 0.6, ...CHROME_IOS });
  await chrome.clock.advance(50);
  check("Chrome on iPhone is no longer ambushed on arrival",
    chrome.doc.getElementById("insModal").hidden === true, "asked a stranger again");
  await trainAndExit(chrome);
  check("it earns the ask like every other browser",
    chrome.doc.getElementById("insModal").hidden === false, "never asked");
  check("and is given real steps it can actually follow",
    /Add to Home Screen/.test(chrome.doc.getElementById("insSteps").textContent),
    chrome.doc.getElementById("insSteps").textContent);
  check("no mention of switching to Safari",
    !/Safari/i.test(chrome.doc.getElementById("insSteps").textContent + chrome.doc.getElementById("insSub").textContent),
    chrome.doc.getElementById("insSub").textContent);
  check("the strip stays a quiet aside, not lifted to the top",
    chrome.doc.getElementById("installNudge").style.order === "",
    chrome.doc.getElementById("installNudge").style.order);
  chrome.restore();

  clearStore();
  const safari = await boot({ duration: 0.6, ...SAFARI_IOS });
  await safari.clock.advance(50);
  check("Safari is unchanged: still earned",
    safari.doc.getElementById("insModal").hidden === true, "asked a stranger");
  safari.restore();

  // An install LINK (?ath=1) is the one thing that still skips the wait — it
  // is what the gym's QR code points at, and someone who followed it has
  // already asked.
  clearStore();
  const link = await boot({ duration: 0.6, search: "?ath=1", ...CHROME_IOS });
  await link.clock.advance(50);
  check("an install link shows the steps at once", link.doc.getElementById("insModal").hidden === false, "ignored the link");
  check("and it shows the real steps, not a pitch",
    /Add to Home Screen/.test(link.doc.getElementById("insSteps").textContent),
    link.doc.getElementById("insSteps").textContent);
  check("the breadcrumb is taken back out of the address bar",
    !/ath=1/.test(link.window.location.search), link.window.location.search);
  link.click("insSkip");
  link.restore();

  const after = await boot({ duration: 0.6, ...CHROME_IOS });
  await after.clock.advance(50);
  check("once answered, it goes back to the earned rule",
    after.doc.getElementById("insModal").hidden === true, "kept asking");
  check("with the footer still offering a way back",
    [...after.doc.querySelectorAll(".foot button")].some((b) => /home screen/i.test(b.textContent)),
    "no route back");
  after.restore();
  clearStore();

  // ---- Asked again, on a session clock ----
  // One "not now" is not a final answer: someone still training three weeks
  // later has changed their mind about the app even if they never thought
  // about the icon again. The gap widens each time (3, 6, 12 sessions) so the
  // app gets quieter the longer they decline, not louder.
  const dlgOpen = (app) => app.doc.getElementById("insModal").hidden === false;

  const seed = await boot({ duration: 0.6, ...CHROME_IOS });
  await trainAndExit(seed);
  check("asked after the first session", dlgOpen(seed), "never asked");
  seed.click("insSkip");
  await trainAndExit(seed);
  check("not asked again the very next session", !dlgOpen(seed), "asked immediately again");
  await trainAndExit(seed);
  await trainAndExit(seed);
  check("asked again three sessions later", dlgOpen(seed), "went quiet for good");
  seed.click("insSkip");
  await trainAndExit(seed);
  await trainAndExit(seed);
  await trainAndExit(seed);
  check("and the gap widens rather than repeating every three",
    !dlgOpen(seed), "nagged on the same cadence");
  seed.restore();

  // ---- The explicit way out ----
  clearStore();
  const never = await boot({ duration: 0.6, ...CHROME_IOS });
  await trainAndExit(never);
  check("the opt-out is on the card", !!never.doc.getElementById("insNever"), "no opt-out");
  check("and sits at the opposite end from the pointer",
    never.doc.getElementById("insNever").dataset.edge !== never.doc.getElementById("insAim").dataset.edge,
    `${never.doc.getElementById("insNever").dataset.edge} vs ${never.doc.getElementById("insAim").dataset.edge}`);
  never.click("insNever");
  check("it closes the card", !dlgOpen(never), "still open");
  check("and takes the quiet strip with it — they meant the subject, not the card",
    never.doc.getElementById("installNudge").hidden === true, "strip survived");
  await trainAndExit(never);
  await trainAndExit(never);
  await trainAndExit(never);
  await trainAndExit(never);
  check("never asked again, however many sessions follow", !dlgOpen(never), "asked after opting out");
  never.restore();
  clearStore();
}

// ------------- 44. Locking the phone must not clip the next words
{
  section("44. A lock screen must not leave words starting mid-syllable");
  // The founder's report: after locking the phone and coming back, "pivot" is
  // heard as "vot", "six" as "s", "slip" as "lip" — and sometimes a word makes
  // no sound at all.
  //
  // WHY. iOS pauses every sounding element when it takes the app away, leaving
  // it mid-file and NOT `ended`. On return, priming repairs only pool[0] of
  // each sound; the spare slots wait for a later tap. Round-robin then hands a
  // displaced spare to the next word, and the only rewind left is the lazy one
  // at play time — an ASYNCHRONOUS seek on iOS, which loses its race with
  // play(). The word starts from the old position and its first syllable is
  // gone. An element parked near the end of its file is the same bug at the
  // limit: a word that never arrives.
  clearStore();
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 30); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(12000);              // words have been spoken, pool is in use

  // Simulate what iOS does: displace idle voice elements mid-file. Written
  // straight to the backing field, because an app-issued seek is exactly what
  // is NOT happening here — the phone moved them, silently.
  const idleVoices = app.stats.live.filter((a) => a.isVoice && a.paused && !a._sounding);
  const displaced = idleVoices.slice(0, 6);
  displaced.forEach((a, i) => { a._ct = 0.2 + i * 0.05; });
  check("the test really did displace some elements", displaced.length > 0, "no idle voice elements found");

  const hide = () => {
    Object.defineProperty(app.doc, "visibilityState", { value: "hidden", configurable: true });
    app.doc.dispatchEvent(new app.window.Event("visibilitychange"));
  };
  const show = () => {
    Object.defineProperty(app.doc, "visibilityState", { value: "visible", configurable: true });
    app.doc.dispatchEvent(new app.window.Event("visibilitychange"));
  };
  hide(); show();
  await app.clock.advance(50);

  const stillDisplaced = displaced.filter((a) => a.currentTime > 0.05 && a.paused && !a._sounding);
  check("coming back rewinds every displaced word to the start",
    stillDisplaced.length === 0,
    `${stillDisplaced.length} still mid-file: ${stillDisplaced.map((a) => `${a.key}@${a.currentTime.toFixed(2)}`).join(", ")}`);

  // The rewind must happen in the QUIET moment, not lazily at play time — the
  // whole point is that the async seek has landed before anything plays.
  const log = app.window.localStorage.getItem("combify.audit") || "";
  app.click("resetBtn");
  await app.clock.advance(50);
  app.restore();

  // Nothing that is actually sounding may ever be yanked back to zero — that
  // was v1.13.0's ghost-words bug, and this fix must not reintroduce it.
  clearStore();
  const app2 = await boot({ duration: 0.6 });
  app2.set("rounds", 1); app2.set("workSec", 30); app2.set("restSec", 5);
  app2.click("startBtn");
  await app2.clock.advance(9000);
  const before = app2.stats.seeksWhilePlaying.length;
  Object.defineProperty(app2.doc, "visibilityState", { value: "hidden", configurable: true });
  app2.doc.dispatchEvent(new app2.window.Event("visibilitychange"));
  Object.defineProperty(app2.doc, "visibilityState", { value: "visible", configurable: true });
  app2.doc.dispatchEvent(new app2.window.Event("visibilitychange"));
  await app2.clock.advance(50);
  check("and never seeks something that is still sounding",
    app2.stats.seeksWhilePlaying.length === before,
    `${app2.stats.seeksWhilePlaying.length - before} mid-sound seeks introduced`);

  // Ending a session is the other quiet moment: "after a few sessions it stops
  // working" is the same displacement accumulating across rounds.
  const idle2 = app2.stats.live.filter((a) => a.isVoice && a.paused && !a._sounding).slice(0, 4);
  idle2.forEach((a, i) => { a._ct = 0.3 + i * 0.02; });
  app2.click("resetBtn");
  await app2.clock.advance(50);
  check("finishing a session parks the pool too",
    idle2.every((a) => a.currentTime <= 0.05),
    idle2.map((a) => `${a.key}@${a.currentTime.toFixed(2)}`).join(", "));
  app2.restore();
  clearStore();
}

// -------------------- 45. Pausing must not add time, or stall the clock
{
  section("45. Pause and resume are instant, and cost the round nothing");
  // "It takes one extra whole second to resume." Not a slow phone: resume
  // rebuilt the deadline from state.secondsLeft, which is what the clock SHOWS
  // — Math.ceil of the real remainder. Pause at 6.5s left, resume at 7.0s. And
  // the restored deadline then sat exactly on a second boundary, so
  // alignedTicker's `% 1000` came out 0 and its `|| 1000` fallback waited a
  // full second before the first tick.
  clearStore();
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 10); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(5000 + 3500);        // countdown done, 6.5s into a 10s work phase
  check("mid-round before pausing", app.doc.getElementById("phase").textContent.trim() === "Work",
    app.doc.getElementById("phase").textContent);
  const leftBefore = app.window.__state ? 0 : null; // state is module-private; measured behaviourally below

  app.click("startBtn");                        // pause, deliberately off a second boundary
  check("it paused", app.doc.getElementById("startBtn").textContent === "Resume",
    app.doc.getElementById("startBtn").textContent);
  await app.clock.advance(4000);                // sit paused
  check("the clock does not move while paused",
    app.doc.getElementById("phase").textContent.trim() === "Work", "phase changed while paused");

  app.click("startBtn");                        // resume
  check("it resumed", app.doc.getElementById("startBtn").textContent === "Pause",
    app.doc.getElementById("startBtn").textContent);

  // 6.5s of work remained. The clock must tick within the first second rather
  // than holding the same number for a whole one.
  const shown = () => app.doc.getElementById("clock").textContent;
  // The ticker must restart immediately and land on the TRUE sub-second
  // boundary — with 6.6s left it ticks 600ms later, not 1000ms later. The
  // margin here is deliberately one full second plus a little: the boundary
  // depends on where in the second the pause happened, so anything tighter
  // would be a test that fails on a pause landing near a whole second.
  const atResume = shown();
  await app.clock.advance(1050);
  check("the ticker restarts on resume", shown() !== atResume, `still showing ${atResume}`);

  // And the phase must end 6.5s after resuming — not 7.0s.
  await app.clock.advance(5350);                // ~6.4s since resuming: not yet
  check("the round has not ended early", app.doc.getElementById("phase").textContent.trim() === "Work",
    app.doc.getElementById("phase").textContent);
  await app.clock.advance(400);                 // ~6.8s: past the real remainder, under a rounded 7.0
  check("and the pause gave the round no free extra second",
    app.doc.getElementById("phase").textContent.trim() !== "Work",
    `still Work ~6.8s after resuming — the old code rounded up and needed 7.0s`);
  app.restore();

  // Repeated pausing must not accumulate. Ten pauses used to buy up to ten
  // extra seconds of round.
  clearStore();
  const app2 = await boot({ duration: 0.6 });
  app2.set("rounds", 1); app2.set("workSec", 20); app2.set("restSec", 5);
  app2.click("startBtn");
  await app2.clock.advance(5000 + 250);
  for (let i = 0; i < 10; i++) {
    app2.click("startBtn");                     // pause
    await app2.clock.advance(120);
    app2.click("startBtn");                     // resume
    await app2.clock.advance(370);              // land off the boundary each time
  }
  await app2.clock.advance(20000 - 250 - 10 * 370 + 400);
  check("ten pauses do not stretch the round",
    app2.doc.getElementById("phase").textContent.trim() !== "Work",
    `still Work after the full 20s of work time elapsed`);
  app2.restore();
  clearStore();
}

// ---------------- 46. Buttons must not do slow work inside the tap
{
  section("46. Taps stay light: no heavy work inside the handler");
  // "It takes an extra second when I press pause, start, exit or restart."
  // A click handler blocks the browser until its last statement finishes, so
  // anything slow inside one is time the button spends looking dead. Two
  // things were: auditPersist stringifies up to 4000 ring-buffer entries AND
  // builds the uniformity report before writing them to localStorage, and
  // pingUsage walks the history for a streak, builds JSON and opens a network
  // request. Neither needs the gesture, so neither belongs in the tap.
  clearStore();
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 20); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(14000);   // a real session, so the audit ring is full

  // Record what is written to storage DURING the click itself.
  const store = app.window.localStorage;
  const realSet = store.setItem.bind(store);
  let duringTap = [];
  let capturing = false;
  store.setItem = (k, v) => { if (capturing) duringTap.push(k); return realSet(k, v); };

  const posts = [];
  const savedFetch = globalThis.fetch;
  let fetchDuringTap = 0;
  globalThis.fetch = async (url, opts) => {
    if (capturing) fetchDuringTap++;
    posts.push({ url, body: String((opts && opts.body) || "") });
    return { ok: true };
  };

  capturing = true;
  app.click("exitBtn");             // the Exit-to-settings tap
  capturing = false;
  check("Exit does not write the audit log inside the tap",
    !duringTap.includes("combify.audit.lastSession"), duringTap.join(", "));

  await app.clock.advance(50);
  check("but the audit log is still persisted, just after the tap",
    !!store.getItem("combify.audit.lastSession"), "log was lost entirely");

  // Restarting fires a usage ping; it must not open the request inside the tap.
  duringTap = []; fetchDuringTap = 0;
  capturing = true;
  app.click("startBtn");            // start a fresh session
  capturing = false;
  check("Start does not open a network request inside the tap",
    fetchDuringTap === 0, `${fetchDuringTap} requests made during the click`);
  await app.clock.advance(50);
  check("but the session start is still reported",
    posts.some((p) => p.body.includes("SESSION_PING")), "the ping was lost");

  store.setItem = realSet;
  globalThis.fetch = savedFetch;
  app.restore();
  clearStore();
}

// ------- 47. Silent sounds, and a lock screen that thinks this is a podcast
{
  section("47. The sfx pipeline, and releasing the lock-screen player");
  // A. THE SILENT TICK. priming mutes an element, plays it, pauses it and
  // unmutes it. playWord has always unmuted again at play time; playSfx never
  // did. So one throw in the middle of priming — iOS rejects a pause racing an
  // unresolved play — left a sound muted for the rest of the session, and
  // nothing ever turned it back on. The voice recovered; the countdown tick
  // did not. That asymmetry is exactly what was reported.
  clearStore();
  const app = await boot({ duration: 0.6 });
  app.set("rounds", 1); app.set("workSec", 12); app.set("restSec", 5);
  app.click("startBtn");
  await app.clock.advance(300);

  // Leave every tick element muted, as a half-failed prime would.
  const ticks = () => app.stats.live.filter((a) => /tick/.test(a.key));
  ticks().forEach((a) => { a.muted = true; });
  check("the test really did mute the ticks", ticks().length > 0 && ticks().every((a) => a.muted),
    `${ticks().length} tick elements`);

  await app.clock.advance(5000);   // the countdown's ticks all fire
  const audible = ticks().filter((a) => !a.muted);
  check("a muted sound is unmuted before it is played",
    audible.length > 0, "every tick element still muted — it would be silent on the phone");
  app.restore();

  // B. THE LOCK SCREEN. iOS builds a Now Playing card from any element that
  // has played, and pausing one keeps it — so the phone showed Combify sitting
  // at 0:00 with transport controls hours after training, like an abandoned
  // podcast. Detaching the source is what actually retires it.
  clearStore();
  const app2 = await boot({ duration: 0.6 });
  app2.set("rounds", 1); app2.set("workSec", 10); app2.set("restSec", 5);
  app2.click("startBtn");
  await app2.clock.advance(2000);
  const keeper = () => app2.stats.live.find((a) => /silence/.test(a.key) || /silence/.test(a.src));
  check("the keeper is holding the audio route during a session", !!keeper(), "no keeper element");

  app2.click("exitBtn");
  await app2.clock.advance(100);
  // THE KEEPER'S SOURCE MUST SURVIVE. A looping media element is what puts the
  // page on iOS's media channel, and that is the only reason Web Audio — every
  // bell, tick, warning and blip — ignores the hardware silent switch. Detach
  // it and the voice keeps playing while everything else goes silent. That bug
  // has now shipped three times; this is the assertion that stops a fourth.
  const k = app2.stats.live.find((a) => /silence/.test(a.src) || a.src === "");
  check("ending a session leaves the keeper's source attached",
    !!k && /silence/.test(k.src),
    `keeper src is "${k && k.src}" — detaching it costs every sfx its silent-switch protection`);
  check("and the keeper is paused, not still looping", !!k && k.paused, "keeper still playing");

  app2.click("startBtn");
  await app2.clock.advance(300);
  const back = app2.stats.live.some((a) => /silence/.test(a.src) && !a.paused);
  check("and the next session starts it again", back, "keeper never restarted");
  app2.restore();
  clearStore();
}

console.log(results.join("\n"));
console.log(`\n${"=".repeat(50)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(50)}`);
process.exit(fail ? 1 : 0);
