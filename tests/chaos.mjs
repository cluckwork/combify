// chaos.mjs — seeded misbehavior testing: does the app stay correct when the
// audio pipeline behaves like a real iPhone on a bad day?
//
// The main suite (run.mjs) proves the app works when events arrive on time.
// Real iOS delivers "ended" late, again ("stale"), or never; runs seeks
// asynchronously; and rejects play() calls. Every one of those has caused a
// shipped bug ("t-two", ghost words, "p-pivot"). This suite throws seeded
// random combinations of all of them at full virtual sessions and asserts
// the INVARIANTS that define "sounds right":
//
//   1. the session always finishes
//   2. never two voice clips audible at once
//   3. no word audibly started twice back-to-back (double-speak / "p-pivot")
//   4. no seek issued while a voice element is audibly playing (mid-word jump)
//   5. no play() while a seek is still in flight (the double-seek race)
//   6. no word cut off mid-round (ghost words) — cuts are legal only at
//      phase boundaries, where the bell is supposed to win
//   7. the voice never starves — combos keep coming through every round
//
// Each run is one seed. A failure prints the seed and its chaos recipe;
// reproduce it exactly with:  node tests/chaos.mjs --seed <n>
// Usage:  node tests/chaos.mjs [--runs N] [--seed N]
import { boot, clearStore, mulberry32 } from "./harness.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 ? +process.argv[i + 1] : dflt; };
const RUNS = arg("--runs", 40);
const ONE_SEED = arg("--seed", null);
const BASE = 1000;

async function chaosRun(seed) {
  clearStore();
  const rng = mulberry32(seed);
  // The chaos recipe for this seed. Probabilities are drawn per-seed so the
  // sweep covers everything from "mildly flaky" to "hostile".
  const params = {
    seekLatencyMax: Math.round(rng() * 250),      // ms an iOS seek can take
    dropP: rng() * 0.25,                          // ended never delivered
    lateP: rng() * 0.30,                          // ended delivered late
    staleP: rng() * 0.35,                         // ended delivered AGAIN later
    rejectP: rng() * 0.08,                        // play() rejects
    phantomP: rng() * 0.12,                       // "ended" instantly, no sound
  };
  const settings = {
    rounds: 1 + Math.floor(rng() * 2),
    work: 15 + 5 * Math.floor(rng() * 3),
    rest: 5 + 5 * Math.floor(rng() * 2),
    pace: ["3000", "1500", "500"][Math.floor(rng() * 3)],
    level: ["beginner", "intermediate", "advanced"][Math.floor(rng() * 3)],
  };
  const chaosRng = mulberry32(seed ^ 0x9e3779b9);
  const app = await boot({
    duration: 0.6,
    rngSeed: seed ^ 0x5bd1e995, // the app's own randomness (combo picks) replays too
    chaos: {
      rng: chaosRng,
      seekLatency: () => Math.round(chaosRng() * params.seekLatencyMax),
      dropP: params.dropP, lateP: params.lateP, staleP: params.staleP, rejectP: params.rejectP,
    },
    phantomEnded: (el) => el.isVoice && chaosRng() < params.phantomP,
  });
  app.set("rounds", settings.rounds); app.set("workSec", settings.work); app.set("restSec", settings.rest);
  app.setSeg("pace", settings.pace); app.setSeg("level", settings.level);
  app.click("startBtn");

  // Drive the whole session, sampling the phase so cut-words can be judged
  // against where the phase boundaries actually fell.
  const totalMs = 8000 + settings.rounds * settings.work * 1000 + (settings.rounds - 1) * settings.rest * 1000 + 20000;
  const phaseLog = [];
  let lastPhase = "";
  for (let t = 0; t < totalMs; t += 250) {
    await app.clock.advance(250);
    const p = app.phase();
    if (p !== lastPhase) { phaseLog.push({ t: app.clock.now, phase: p }); lastPhase = p; }
  }

  const v = [];
  if (app.phase() !== "Done") v.push(`session never finished (stuck at "${app.phase()}")`);
  if (app.stats.maxVoiceConcurrent > 1) v.push(`two voice clips audible at once (max ${app.stats.maxVoiceConcurrent})`);

  const voicePlays = app.stats.audible.filter((a) => a.voice && !a.muted);
  for (let i = 1; i < voicePlays.length; i++) {
    const a = voicePlays[i - 1], b = voicePlays[i];
    if (a.key === b.key && b.t - a.t < 250) { v.push(`double-speak: "${b.key}" audibly started twice ${b.t - a.t}ms apart`); break; }
  }

  const voiceSeekPlaying = app.stats.seeksWhilePlaying.filter((s) => s.voice);
  if (voiceSeekPlaying.length) v.push(`${voiceSeekPlaying.length} seek(s) on an audibly playing voice element (first: "${voiceSeekPlaying[0].key}")`);
  const voiceRaces = app.stats.seekRaces.filter((s) => s.voice);
  if (voiceRaces.length) v.push(`${voiceRaces.length} play-during-pending-seek race(s) on voice (first: "${voiceRaces[0].key}")`);

  // A word cut short is legal only where the design says the bell wins:
  // within ~1.5s of a work→rest / work→done boundary (stopComboLoop) —
  // anywhere else it's the ghost-word artifact.
  const boundaries = phaseLog.filter((p) => p.phase === "Rest" || p.phase === "Done").map((p) => p.t);
  const badCuts = app.stats.cutShort.filter((c) => !boundaries.some((b) => Math.abs(c.t - b) < 1500));
  if (badCuts.length) v.push(`${badCuts.length} word(s) cut off mid-round (first: "${badCuts[0].key}" at t=${badCuts[0].t})`);

  const workSecTotal = settings.rounds * settings.work;
  const floor = Math.max(2, Math.floor(workSecTotal / 15));
  if (voicePlays.length < floor) v.push(`voice starved: only ${voicePlays.length} audible word(s) across ${workSecTotal}s of work`);

  app.restore();
  return { violations: v, params, settings, app };
}

function recipe(p, s) {
  return `seekLat≤${p.seekLatencyMax}ms drop=${p.dropP.toFixed(2)} late=${p.lateP.toFixed(2)} stale=${p.staleP.toFixed(2)} reject=${p.rejectP.toFixed(2)} phantom=${p.phantomP.toFixed(2)} | ${s.rounds}r×${s.work}s/${s.rest}s pace=${s.pace} ${s.level}`;
}

(async () => {
  let failed = 0;
  if (ONE_SEED != null) {
    // Single-seed forensic mode: the full event timeline, then the verdict.
    const { violations, params, settings, app } = await chaosRun(ONE_SEED);
    console.log(`seed ${ONE_SEED}: ${recipe(params, settings)}\n`);
    console.log("chaos injected:");
    for (const c of app.stats.chaosLog) console.log(`  t=${c.t} ${c.ev} ${c.key}${c.by ? " +" + c.by + "ms" : ""}`);
    console.log("\naudible plays:");
    for (const a of app.stats.audible) console.log(`  t=${a.t} ${a.voice ? "voice" : "sfx  "} ${a.key}`);
    console.log(violations.length ? `\n❌ ${violations.join("\n❌ ")}` : "\n✅ all invariants held");
    process.exit(violations.length ? 1 : 0);
  }

  console.log(`chaos: ${RUNS} seeded sessions\n`);
  for (let i = 0; i < RUNS; i++) {
    const seed = BASE + i * 7;
    const { violations, params, settings } = await chaosRun(seed);
    if (violations.length) {
      failed++;
      console.log(`  ❌ seed ${seed} — ${recipe(params, settings)}`);
      for (const viol of violations) console.log(`       ${viol}`);
      console.log(`       repro: node tests/chaos.mjs --seed ${seed}`);
    } else {
      console.log(`  ✅ seed ${seed}`);
    }
  }
  console.log(`\n${"=".repeat(50)}\n  chaos: ${RUNS - failed}/${RUNS} sessions clean\n${"=".repeat(50)}`);
  process.exit(failed ? 1 : 0);
})();
