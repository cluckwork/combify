# Combify — Product Roadmap & Plan

> The single source of truth for this project. If you read one file at the start
> of a session, read this one. It holds the vision, every idea we've had, what's
> built, what's next, and what only you can do.
>
> **Last updated:** 2026-07-23 · **Current version:** v1.13.0 (v1.12.0 live on GitHub Pages; v1.13.0 not yet pushed)
>
> The running version is shown in the app's About section and comes from
> `js/version.js`. Bumping it also renames the service worker cache, which is
> what makes existing installs pick up a new build — see §7.

---

## How to use this document

- **Status legend:** ✅ done · 🔨 in progress · 🟡 needs your decision ·
  ⏳ planned · 💡 idea / not committed · 🚧 blocked
- **Effort sizes:** **S** = under an hour · **M** = a session · **L** = a few
  sessions · **XL** = a mini-project of its own
- Each feature below has **What / Why / How / Tasks / Done-when / Effort /
  Depends on / Open questions** so we can pick it up cold and know exactly what
  "finished" means.
- The **Decision Log** records choices and *why*, so we don't re-argue them.
- Keep this file honest: when something ships, move it to the Changelog; when a
  plan changes, edit it here.

---

## 1. Vision

**Combify** — a round timer + boxing combo caller web app, "by Boxing With Bakr."

**Why it exists (business goal):** keep gym members training *between* classes.
More reps at home → faster progress → members feel it working → they stay and
keep paying. That retention is the value to Bakr's business. Secondary win: it's
a differentiator he can market — most local gyms can't say "we have our own
training app."

**Who it's for:**
1. **Members** (primary) — need structure for the 5 days/week they're not in
   class. Shadowboxing alone is boring and directionless; Combify gives it shape.
2. **Bakr / the business** — retention + a marketing asset + a way to extend his
   coaching beyond gym hours.
3. **Coaches** (minor) — not a target; only the founder personally struggles to
   invent combos, so coach-facing tools are deprioritized.

**Guiding principles:**
- **Usage is the only proof of value.** If nobody opens it, it failed — polish
  and "cool" don't count.
- **Ship the smallest thing real people will use, then watch.** Add features
  only when use justifies them.
- **Validate big bets before building them.** Prototype the risky part first
  (e.g. one animation) before committing weeks.
- **Stay buildable and ownable.** The founder is a beginner; prefer approaches he
  can understand and maintain over maximal tech.

---

## 2. Success metrics (how we'll know it's working)

We have no analytics yet (v1 has no accounts/backend). These are the behaviors to
design toward and, later, to measure:

| Signal | What it tells us | How we'd measure it (later) |
| --- | --- | --- |
| Bakr recommends it to members | The core stakeholder believes in it | Ask him directly |
| A member opens it a 2nd and 3rd time | It's not a one-time novelty | Local streak counter / opt-in analytics |
| Members train on non-class days | It's actually filling the between-class gap | Streak / session log |
| Members ask for it / for features | Real pull, not polite interest | Word of mouth, feature requests |
| Installed to home screen | Treated as a real app, not a link | PWA install event |

**Near-term goal:** get it in front of Bakr and ~3–5 members and learn whether
they reach for it a second time. Everything else is secondary to that answer.

---

## 3. Milestones (the sequence)

Ordered so each step either ships value or de-risks the next. Nothing past M2 is
committed — it depends on what validation tells us.

- ✅ **M0 — Working v1 (local).** Timer + combo caller + settings + natural voice
  + PWA. *Done.*
- 🟡 **M1 — Ship it for real.** Get on GitHub, deploy to a live URL, put Bakr's
  real combos in, show it to Bakr and members. *This is the priority.* Validation
  gate: do people come back?
- 🟡 **M2 — Make the callouts feel pro.** Decide + build the voice upgrade and
  the music approach. These are the two things users will judge first.
- 💡 **M3 — Teach, don't just shout: the "Break it down" animation.** The big
  differentiator. Gated on an approved proof-of-concept.
- 💡 **M4 — Retention loop.** Streaks, saved settings, signature combos — the
  features that directly serve "keep members coming back." Build once we know the
  basics get used.
- 💡 **M5 — Scale / polish.** Full music integration, accounts (only if needed),
  multi-gym support, etc. Far out; listed so we don't forget.

---

## 4. Decisions waiting on YOU 🟡

Short version here; full trade-offs in each feature spec and the Decision Log.

1. ~~**Voice quality**~~ ✅ **DECIDED** — AI voice clips generated via **ElevenLabs**.
   Clip-playback system is built (provider-agnostic); now needs the 12 clips
   generated and dropped into `audio/`. → see **6.1**
2. ~~**Music**~~ ✅ **DECIDED (2026-07-23) — deferred.** Research found iOS
   forces a hard trade-off (see 6.2); founder chose to skip music coexistence
   for now.
3. **Breakdown animation** — green-light the 2D-silhouette proof-of-concept
   (jab + cross) before committing to all moves? → see **6.3**

---

## 5. Things only YOU can do (real-world, no code) 🥊

These are blockers I can't clear for you, and they're high-leverage:

- ⏳ **Show Bakr the live preview and watch him use it.** The single most
  important step. Listen for "I'd tell members to use this" vs. polite nodding.
- ✅ ~~**Ask Bakr what 7 and 8 are**~~ — confirmed: **body shots**. Existing
  combos using them (1-2-7-8 etc.) are correct as written. Which hand is which
  would only matter if we animate them.
- ⏳ **Collect Bakr's real combos** (by level if possible) to replace the
  placeholders in `js/combos.js`. This is what makes it *his gym's* app.
- 💡 **Ask Bakr his single biggest headache running the gym.** May surface a
  higher-value product than anything on this list — worth the question.
- 💡 **Watch a member try it** without coaching them. Where do they get confused?
  That's your real backlog.

---

## 6. Feature specs

### 6.1 — Voice: sound like a real coach 🔨 · M2 · DECIDED

- **What:** replace the robotic text-to-speech callouts with a good AI voice.
- **Why:** it's the first thing users judge; a robotic voice makes a good app
  feel cheap. The founder flagged it as still too robotic even after picking the
  best device voice.
- **Why device TTS can't fix it:** browser TTS quality is **capped by the
  device** — we can't fix a weak voice from inside the app. So the fix is to stop
  relying on device TTS and play our own audio.
- **Decision:** use **pre-generated AI voice clips** made with **ElevenLabs**.
  Because every combo is just a sequence of the same words, we only need
  **12 clips, made once** (`1`–`8`, `slip`, `roll`, `block`, `pivot`); the app
  chains them into any combo. Free at runtime, works offline, no per-combo
  generation.
- **Tried and rejected:**
  - Voice picker (browser TTS) — still robotic on weak devices.
  - VoiceBox "dawg" voice — clips were generated and wired in, but didn't sound
    good enough on listening; reverted.
  - Free Microsoft Edge neural voices (edge-tts) — genuinely natural and
    proven working (5 voices demoed live), but the founder chose to go with
    ElevenLabs instead.
- **Constraint noted:** I can't access ElevenLabs from this environment (no
  account access), so the founder generates the 12 clips and drops them in.
- **How it's built:** app looks for clips in `audio/`; if present, it uses them
  and chains them per combo; if missing, it silently falls back to TTS so nothing
  breaks. Clip playback stays in sync with pace (waits for each callout to end).
  Architecture is provider-agnostic — this is the 2nd voice source plugged into
  the same system.
- **Tasks:**
  - [x] Decide the approach (AI clips) and try providers
  - [x] Build clip playback + chaining + TTS fallback (`js/app.js`)
  - [x] Document the exact 12-file list (`audio/README.md`)
  - [x] **Founder:** generate the 12 words in ElevenLabs — recorded as ONE
        continuous take (more natural flow) instead of 12 separate takes, with
        `<break>` tags between words so it could still be split programmatically
  - [x] Split the single recording into 12 clips (detected silence gaps, added
        small padding + micro-fades to avoid clicks) and dropped into `audio/`
  - [ ] Test on a real phone; confirm clips chain cleanly
  - [x] Preview updated to embed the real clips (data-URIs) for demoing
- **Done when:** combos are called in the ElevenLabs voice, tight and in sync
  with pace, on a normal phone.
- **Effort:** remaining = **S** (real-device listening test)
- **Idea parked:** cycle between several tonal takes of the same word (proven
  feasible with edge-tts in a live demo) to avoid a looped-clip feel. Revisit
  once the base ElevenLabs voice is in and confirmed good.
- **Open questions:** if a word chains awkwardly, we may later add a few
  whole-combo clips for common combos — not needed for now.

### 6.2 — Music while training ✅ DECIDED: deferred (2026-07-23) · M2

- **What:** let people shadowbox to their own music alongside the bell/voice.
- **Why:** people strongly associate shadowboxing with music; its absence feels
  dead.
- **Decision:** **deferred** — founder's call after the research below. Keep
  this section: it documents a REAL platform constraint so we never re-argue
  or re-research it.
- **What the research found (don't relitigate — this is WebKit source, not
  guesswork):** on iPhone, a web app must choose ONE of:
  1. **Always audible (today's behavior).** Our sounds ride the media pipeline
     and ignore the silent switch — but the page's audio session goes to
     Apple's `MediaPlayback` category, which **pauses Spotify/Apple Music** at
     our first sound. Music coexistence is broken on iOS today.
  2. **Mix with music** — set `navigator.audioSession.type = "transient"`
     (Safari 16.4+; verified in WebKit's `DOMAudioSession.cpp` that this maps
     to Apple's `Ambient` category). Music keeps playing under our bells and
     voice, **but the silent switch then mutes ALL of Combify** — the exact
     "bells don't work" failure v1.8.2/v1.8.3 fought, since most phones sit on
     silent. Native apps can have both (`.playback + .mixWithOthers`); web
     apps cannot express that combination. Nothing detects whether music is
     playing or the switch is flipped, so the app can't choose dynamically.
  - Android is fine either way: Chrome ducks short sounds natively and doesn't
    implement the Audio Session API.
- **If we ever revisit:** the sane shape is a "Keep my music playing" toggle in
  More options (off by default; sets `transient` when on, with a hint that the
  silent switch must be off). Effort **S**.

### 6.3 — "Break it down": animated combo breakdown 💡 · M3 · ← the big one

- **What:** a help feature that *teaches* a combo. A blank silhouette figure
  performs the combo against a target, slowly and clearly, so a confused user can
  see how it's actually thrown.
- **Why:** this is the leap from "timer that shouts numbers" to "coach in your
  pocket." It's the most defensible, most valuable idea on the list.
- **UX flow:** a **"Break it down"** button → shows the **last few combos** called
  this round → user taps the one they struggled with → the figure performs it
  move-by-move with coaching cues ("Slip — dip under, weight to lead foot") and
  step-through / replay / slow-mo controls.
- **How it works (the game-engine idea):** you don't animate whole combos — you
  animate **each move once** and **chain** the clips to match any combo, blending
  between them. So "adapts to the round's combo" is the easy part; the work is a
  clean animation per move: **1–8, slip, roll, block, pivot**.
- **Approach A — 2D coded silhouette (recommended):** a figure from a simple
  skeleton (torso, head, arms, legs); each move is a few keyframe poses the app
  tweens between for smooth motion. Self-contained, instant load, matches the
  "blank silhouette" vision, we own every frame, fits the current stack.
- **Approach B — full 3D (Three.js + free Mixamo mocap):** real rigged character,
  most realistic, camera you can orbit. But adds a 3D engine + multi-MB assets,
  the free mocap doesn't map 1:1 to our numbering (cleanup), and it's hard for a
  beginner to maintain.
- **Plan (de-risk first):**
  1. Proof-of-concept: button + combo-history + silhouette animating **jab &
     cross**, chained. Judge the quality.
  2. If good → animate the rest, one move at a time.
  3. If not → pivot to 3D or rethink, having spent an hour not a week.
- **Tasks:**
  - [ ] Log combo history as combos are called (cheap, needed anyway — do this
        even before the animation)
  - [ ] "Break it down" button + recent-combo picker screen
  - [ ] Silhouette rig + tweening engine
  - [ ] Jab + cross animations (the PoC)
  - [ ] Review gate → animate remaining moves (3,4,5,6,7,8, slip, roll, block,
        pivot)
  - [ ] Coaching-cue text per move
  - [ ] Step-through / replay / slow-mo controls
- **Done when:** a user can pick a struggled combo and clearly understand how to
  throw it from the animation alone.
- **Effort:** PoC = **M** · full feature = **XL**
- **Depends on:** which hand 7 & 8 are (they're body shots — lead vs rear only
  matters once a figure has to actually throw them).
- **Open questions:** side-on vs. angled view? auto-play vs. tap-through by
  default? one figure or mirror for orthodox/southpaw?

### 6.4 — Retention loop 🔨 · M4

Directly serves the business goal.

- ✅ **Streaks / session log** — done. Completed work rounds are logged to
  `localStorage` as per-day totals (`js/stats.js`); the ready screen shows
  "N days in a row · N sessions · N punches" and the finish screen summarises
  the session instead of just saying "nice work". Streak survives training late
  at night (local day, not UTC) and doesn't reset until a full day is missed.
  Partial rounds deliberately don't count.
- ✅ **Save favorite settings** — done. Level/pace/rounds/work/rest/voice
  persist per device.
- 💡 **Next for this loop:** nothing prompts a member to come back — the streak
  is only visible if they already opened the app. A reason to return (or, much
  later, a notification) is the missing half.
- ⏳ **Retention measurement (decided 2026-07-23, build BEFORE wide sharing):**
  anonymous device ID + a session-complete ping to a free Cloudflare Worker,
  with an offline queue. The per-device data already exists in localStorage
  (streaks/sessions) — this just makes it visible. Measures the roadmap's own
  success metric (devices that train a 2nd time). Deliberately NOT built yet:
  at 3–5 testers, asking beats dashboards. Page-view analytics can't measure
  retention; don't substitute it. Effort **M**.
- **Signature combos** — named combos from Bakr ("Bakr's Special") as their own
  selectable set; makes the app feel personally his. Effort **S–M**.
- **Shareable gym link** — one link Bakr texts every member; maybe a lightweight
  gym-branded landing. Effort **S** (link) / **M** (landing).

### 6.5 — Difficulty & combo content ⏳ (ongoing)

- ✅ Rebuilt all three levels with real scaling; added 7 & 8.
- ⏳ Swap placeholders for **Bakr's real combos** (needs §5).
- 💡 Per-level tuning as members give feedback ("advanced still too easy," etc.).
- 💡 Optional move-set expansion — see Parking Lot.

---

## 7. Deployment ✅ · M1

- **Goal:** a free public URL to text to Bakr and install on a phone. **Done —
  live on GitHub Pages** (repo: `github.com/cluckwork/combify`), and pushing to
  `main` is how a new build ships. Remember to bump `js/version.js` (+ sw cache
  + package.json) so installed phones pick it up.
- **Remaining:**
  - [ ] Verify PWA install + offline work from the live URL on a real phone.
  - [ ] Put the rest of Bakr's real combos in before wide sharing (the "10
        combo" is in; the other levels are still placeholders).

---

## 8. Technical architecture

- **Stack:** vanilla HTML / CSS / JavaScript. No framework, no build step. Chosen
  for a beginner: readable, nothing to break, deploys as static files.
- **PWA:** `manifest.json` + `sw.js` (service worker) → installable + offline.
- **Audio:** bell is synthesized via the Web Audio API (no files); voice via the
  Web Speech API (`speechSynthesis`). Both free, no network.
- **File map:**
  | File | Role |
  | --- | --- |
  | `index.html` | Page structure |
  | `css/styles.css` | All styling (dark, boxing-red, mobile-first) |
  | `js/app.js` | Timer, phases, settings controls, rendering |
  | `js/audio.js` | Everything that makes sound: bell/sfx, voice clips, pools, priming |
  | `js/combos.js` | **The combo playbook — edit this to change combos** |
  | `manifest.json` | PWA install metadata |
  | `sw.js` | Offline caching |
  | `icons/icon.svg` | App icon |
- **State/data:** currently in-memory only. Streaks/saved-settings (M4) will use
  `localStorage` — still no server, still private to the device.
- **When we might need a backend:** only for cross-device accounts, real
  analytics, or cloud voice. Deliberately avoided until a feature truly requires
  it.

---

## 9. Decision log

Choices made and *why*, so we don't relitigate them.

- **Web app, not a native iOS/Android app** — a beginner-friendly path that still
  installs like an app (PWA) and works everywhere instantly; native means
  Swift/Kotlin, dev accounts, and store reviews — a wall before anything works.
- **Vanilla JS, no framework** — readable and unbreakable for a first project;
  add tooling only if a feature demands it.
- **Members + retention as the target, not coaches** — only the founder struggles
  to invent combos, so coach tools are low value; retention is where business
  value lives.
- **No accounts/database/payments in v1** — ship the smallest usable thing; add
  infrastructure only when usage justifies it.
- **Pace = the gap *after* a callout finishes** — so the voice never talks over
  itself and pace changes apply live (fixed the pace/voice mismatch).
- **No voice on/off toggle (v1.12.0)** — the caller is the whole point of the
  app; nobody trains with it silent on purpose, and the volume rocker covers
  "quieter". One less control on the settings screen. (Note: the iPhone silent
  switch deliberately does NOT mute the voice — see 6.2 — so "silence the
  phone" means the volume buttons.)
- **Music coexistence deferred (v1.12.0)** — iOS makes it a hard either/or
  with silent-switch audibility; audibility wins for now. Full findings in 6.2.
- **Name: "Combify," branded "by Boxing With Bakr"** — product-sounding, not a
  school project; still tied to the gym.

---

## 10. Risks & open questions

- **Voice quality on weak devices** → mitigate with recorded clips (6.1).
- **Nobody uses it** (the core risk) → mitigate by validating with Bakr + members
  at M1 *before* building M3/M4.
- **Breakdown animation is a time sink** → mitigate with the PoC-first plan (6.3).
- **iOS audio quirks** (bell vs. background music, autoplay rules) → needs
  real-device testing.
- **Network-restricted build environment** → may block GitHub; have a
  run-locally fallback ready.
- **Founder is on vacation / limited device access** → keep momentum on things
  that don't need the gym; batch the Bakr-dependent items for when he's back.

---

## 11. Glossary

- **Boxing numbering** (this app): 1 jab · 2 cross · 3 lead hook · 4 rear hook ·
  5 lead uppercut · 6 rear uppercut · **7 & 8 body shots** (confirmed with
  Bakr). Defense/movement: **slip** (dip under a punch),
  **roll** (weave under), **block**, **pivot** (turn on the lead foot).
- **Combo** — an ordered list of moves, e.g. `1-2-slip-2`.
- **Round / work / rest** — a work period (throwing) followed by a rest period,
  repeated for N rounds, bookended by bells.
- **PWA** — Progressive Web App; a website that can be installed to the home
  screen and run offline like a native app.
- **TTS** — text-to-speech; the browser reading text aloud (the current voice).

---

## 12. Parking lot (uncommitted ideas)

Captured so they're not lost; not planned yet.

- Southpaw / orthodox mirroring for combos and animations
- Body-vs-head shot distinction in the numbering
- Feints, footwork (step in/out, angles), level changes, catch/parry as callable
  moves
- Custom combo builder (users/coaches craft and save their own)
- "Freestyle" mode — pure timer, no combos
- Difficulty that ramps within a session (harder each round)
- Multi-gym / white-label version other coaches could brand
- Leaderboards or challenges between members

---

## 13. Changelog

- **2026-07-23 — v1.14.0** — **The audit system: chaos suite + on-device
  flight recorder.** Founder asked for an audit that catches what the harness
  can't. Honest scoping: nothing on this machine can reproduce the real iOS
  media pipeline, so the gap is closed from both sides instead. (1) CHAOS
  SUITE (tests/chaos.mjs, npm run test:chaos): the FakeAudio model now does
  what iOS actually does — currentTime is an async seek with configurable
  latency; "ended" can arrive late, never, or AGAIN in a stale burst spread
  ~4.5s; play() can reject — all driven by a seeded PRNG (mulberry32), with
  cfg.rngSeed also seeding Math.random so combo picks replay (without that,
  failures weren't reproducible — found the hard way). 40 seeded full
  sessions per run assert the invariants that define "sounds right": session
  finishes, ≤1 voice clip audible, no double-speak (<250ms same-key
  restart), no seek on a playing voice element, no play-during-pending-seek,
  no word cut outside a phase boundary, voice never starves. Muted priming
  plays are excluded from "audible" (first sweep flagged all 12 prime
  pauses as cut words). (2) FLIGHT RECORDER (js/audit.js + wiring): 5 taps
  on the footer version arms a ring-buffer event log (word plays with
  element state, ended timing, watchdog/retry/stale events, sfx, phases,
  visibility, primes) on the real phone; "Copy audit log" exports it.
  Off = one boolean per call. Generic module, liftable to future projects.
  (3) THE SUITE'S FIRST CATCH, fixed same day: a stale "ended" delivered
  mid-word during an element's NEXT use either replayed the word
  (elapsed<120 phantom-retry) or advanced the chain early so the next word
  displaced this one — voice.current is null between words, so the overlap
  guard didn't catch it (chaos saw 2 voice clips at once). Guard: onended
  only counts if node.paused || node.ended (a real ended flips state before
  the event; a stale one arrives while the element is audibly playing).
  Unguarded code fails 10/100 chaos seeds; guarded sweeps 200/200. This is
  plausibly a driver of the residual real-phone stutter — same real-device
  verification owed as v1.13.3's fixes. 211 behaviour + 262 layout green.
- **2026-07-23 — v1.13.3** — **The double-seek race named; blips back on the
  media pipeline; ripple scoped to Act 1.** Founder reports after v1.13.2:
  stutter still present but smaller ("p-pivot", "e-eight"), end bells striking
  double (2nd/3rd strike more than the 1st), rising blips GONE, finish ripple
  replaying off-centre twice. One mechanism explains the first two: play() on
  an element that ended rewinds to the start BY ITSELF (spec'd behaviour), and
  the pipeline issued its own currentTime=0 on top — two async seeks racing on
  iOS, heard as attack-jump-attack. Explains the bell pattern exactly: 2nd/3rd
  end-strikes round-robin onto elements left at end position by earlier
  rounds' bells; a primed element (parked at 0, no seek issued) plays clean.
  Fix is the OPPOSITE of v1.13.0's reverted parking: add nothing, seek less —
  the play-time rewind now skips any element with .ended set (property
  reflects state even when iOS drops the event; no listeners, no timers, no
  stale-event surface). Blips: the v1.12.0 Web Audio buffer path is muted by
  the iPhone ring/silent switch — the "deliberate trade" turned out to mute
  the whole count-up on real phones; reverted to the primed-element pipeline
  like every other sound. Ripple: `2` iterations × 1.8s outlived the 1.7s
  finale hold, so bloom two played at the dial's resting spot — and Safari
  restarts pseudo-element animations on ancestor class changes, replaying
  BOTH blooms there at the reveal; the ::after is now scoped
  :not(.is-finale-reveal) so the ripple ends with Act 1. Harness now models
  .ended + play()-from-ended auto-rewind. Per the v1.13.2 rule these are
  audio-pipeline changes shipped harness-green — the stutter and bell fixes
  need a real-phone session before being called closed. 211 behaviour + 262
  layout green.
- **2026-07-23 — v1.13.2** — **v1.13.0's audio "fix" REVERTED after real-device
  failure; entrance rebuilt as a crossfade.** Founder testing on a real phone:
  frequent "ghost words" — "six"→"s", "slip"→"lip", "pivot"→"puh", worse at
  slower paces — beginning with v1.13.x. The v1.13.0 park-on-finish scheme
  (parkOnEnded seek-at-ended, finished-path pause+park, sfx park timers,
  guarded play-time seek, deepPrime work-gate) interacted with iOS's late/
  stale "ended" delivery in ways jsdom cannot model: a stale event could
  PAUSE or SEEK an element mid-word on its next use. js/audio.js was restored
  WHOLESALE to the v1.12.0 pipeline (git show b201b38:js/audio.js) — the
  known state with only the rare stutter. LESSON, recorded also in memory:
  audio-pipeline changes must not ship on harness-green alone; the harness
  cannot see seek races or stale-event timing. Next attempt at the rare
  stutter starts with a real-device reproduction, likely via instrumented
  logging. The entrance became a CROSSFADE (attempt three): the ready screen
  and fullscreen countdown are different layouts and morphing animated some
  properties while others snapped ("appears 3/4 down then slides") — now the
  settings fade out (160ms), the layout swaps while dark (.is-entering
  suspends the fold transition so everything snaps invisibly), the countdown
  fades in (300ms), and the clock starts at +760ms. Watch item (landing ding
  skipping/lagging) CLOSED same day: founder confirmed it works on this
  build — it was v1.13.x fallout, not pre-existing. 211 behaviour + 262
  layout green.
- **2026-07-23 — v1.13.1** — **Centre-stage countdown reverted; entrance is a
  hold, not a move.** Founder feedback on v1.13.0 within hours: the centred
  dial hid "Get ready..." and the dial's normal position was fine — the ask
  was only ever a smoother start. So: the FLIP/fixed-centre machinery is gone
  (armPulse and the pulse-hold survive), the chrome fold slowed from
  0.18s/0.3s to 0.4s/0.6s with a gentler curve, and the countdown paints
  "5" + "Get ready..." on the tap's frame and HOLDS for ENTRANCE_SETTLE_MS
  (750ms, motion only — jsdom/reduced-motion keep 140ms) before the clock
  re-anchors, the first tick plays, and the pulse releases. The two durations
  (CSS fold, JS settle) are cross-referenced in comments and must move
  together. Lesson recorded: when the founder describes a fix ("wait a bit
  after pressing start OR do an animation"), prefer the smallest option
  first — the fancy one was built and pulled same-day. 209 behaviour + 262
  layout green.
- **2026-07-23 — v1.13.0** — **The start intro (finale's mirror) + the rare
  stutter's likely root cause.** Reported: "5" still occasionally eaten at
  start despite the settle beat, and rare residual word-stutter. Start now
  has choreography instead of a delay: the dial FLIPs from the folding
  settings layout to a fixed dead-centre overlay (bigger: min(70vw,66vh,
  320px)), the countdown runs there — pulse waves held until the clock
  actually starts, so wave 1 lands on tick 1 — and enterWork glides it home
  (650ms, inside the 1.6s first-call runway), mirroring the finish finale.
  Fixed positioning means layout churn underneath cannot move it; the
  transform is compositor-only. Reduced-motion/jsdom keep the old settle-beat
  path. The stutter: v1.11.8 parked clips at zero at every PAUSE site but
  missed the NATURAL END — a finished element sits at its end position, and
  the 3rd occurrence of a word in one combo (pool of 2: "2" appears 5× in
  the 10 combo) reused it with a rewind seek issued AT PLAY TIME, the exact
  "t-two" race. Now parkOnEnded rewinds every element the moment it finishes
  (idle-time seek), the watchdog path parks dropped-ended elements, playSfx
  parks after each sound runs its course (sfx have no watchdog), and the
  play-time rewind is guarded to displaced elements only. Also: deepPrime is
  deferred while a work round is live (a ~20-element muted prime burst on the
  speaking pipeline was audible as a mid-word hiccup). Harness now models
  end-position (currentTime=duration at playback end) so un-parked elements
  are test-visible; layout suite waits for the entrance to land before
  steady-state probes (mid-glide the dial legitimately crosses the empty
  combo area). NOTE: stutter fixes address the last mechanisms findable in
  code — confirmation of "zero" must come from real phones. 209 behaviour +
  262 layout green.
- **2026-07-23 — v1.12.0** — **Session length up front, rest-end warning, voice
  toggle removed, audio split into its own module.** The ready screen's clock
  now shows the whole session's length (rounds×work + rests between them,
  updating live as settings change) instead of 00:00 — "how long will this
  take?" was the question the screen wasn't answering. Rest now ends like a
  round begins: the two-beep heads-up at 10s left (skipped when rest ≤ 10s —
  it would land on the rest bell), then the countdown TICK at 3-2-1 — the tick
  already means "get ready" from the pre-round 5-4-3-2-1, so each sound keeps
  one meaning (work keeps its clapper flourish; the two ends sound different
  on purpose). The "Call combos out loud" switch is gone (founder's call: the
  caller IS the app), taking `voiceOn` plumbing and the switch CSS with it.
  The entire audio system (~660 lines: context, sfx, pools, priming, the voice
  chain) moved verbatim from app.js to js/audio.js behind a four-hook
  interface (stillInWork / msLeftInPhase / wordGap / onWord); app.js is now
  1,020 lines of timer/UI. The move surfaced a real harness gap: app.js got a
  fresh module per boot but audio.js resolved to one cached path, so boot 2
  inherited boot 1's audio wired to a dead document — each boot now gets its
  own audio copy. Music coexistence was researched down to WebKit source and
  DEFERRED: on iOS it's a hard either/or against silent-switch audibility
  (full findings + the revisit shape recorded in §6.2). New tests: rest-end
  cues (long and short rests), ready-screen total (boot value, live updates,
  no-rest single round, restored after exit). 199 behaviour + 262 layout
  green, including the count-up blip-sync assertions — the finale audio
  survived the module move untouched.
- **2026-07-23 — v1.11.8** — **The "t-two" stutter root cause + four fixes.**
  The stutter's phonetic signature (word onset, hiccup, word again) pinned it:
  currentTime assignment is an ASYNC seek on iOS, and an element paused
  mid-word (round end, pause, voice-over-bell cut) stayed parked there — its
  next reuse could start audibly from the old position then jump to 0 when the
  lazy seek landed. v1.11.7's prime-seek removal widened that window, which is
  why it "came back". Fix: park at 0 at EVERY pause site (stop, mismatch cut,
  retry, skip) so seeks land during idle gaps, plus a displaced-only rewind in
  primeElement (cheap; skips already-parked elements). Prior real-browser
  traces (Sonnet's) had already exonerated the files (clean PCM tails) and
  ruled out element-vs-element interruption — this was the one mechanism left.
  Also: enterWork clears "Get ready..." to an nbsp (it lingered through the
  1.6s runway and read as a hang); a fullscreenchange listener re-anchors the
  countdown if the OS fullscreen transition lands inside its first 1.2s ("5"
  holds through the repaint storm instead of the first second being eaten);
  "The 10" renamed to "10 combo"; the normal screen's dead Reset is hidden and
  Start fills the row (the same element still serves as the restart icon in
  focus mode). Note on "quiet blips, loud final ding": expected on a
  silent-switched iPhone or during an OS audio interruption — count-up blips
  ride Web Audio (the jitter-free path, muted by the switch) while the landing
  stays on the media pipeline; documented trade from v1.11.4.
  191 behaviour + 262 layout green, three clean runs.
- **2026-07-23 — v1.11.7** — **Settle beat, phase-aligned ticker, halo glow.**
  Start/restart now paint the countdown state on the tap's frame and start the
  clock 140ms later (armCountdownStart) — residual transition jank is absorbed
  in an intentional beat instead of surfacing as "5--4-3-2-1". The first tick
  is phase-aligned (one-shot at the real second boundary, then the interval) so
  a busy tap frame can't offset the whole countdown. Priming lost its
  currentTime seek (its most expensive part) and the blip decode moved off the
  tap. The glow was rebuilt to the founder's arc — builds with the count,
  crests at the pop, fades over 1.4s — via a radial halo layer behind the
  digits whose OPACITY animates (compositor-free) instead of text-shadow
  (per-frame glyph repaints); the pop keeps a brief text flash as the crest
  accent. The countdown pulse element is force-re-armed each countdown
  (animation reset + reflow), closing the "circle expanding stops happening
  after reloads" report — likely mixed-cache states during rapid reload
  testing, now structurally immune either way. 191 behaviour + 262 layout.
- **2026-07-23 — v1.11.6** — **Footer.** Version + release date + What's new
  moved out of the About fold into an always-visible one-line footer (quiet
  mono, folds away in focus mode with the rest of the chrome). Checking "am I
  on the latest?" is now zero taps.
- **2026-07-23 — v1.11.5** — **Bell clearance + first-call runway + glow back.**
  Both reported bell "glitches" were collisions with the voice: at round start
  the first word began during the bell's attack (two full-volume samples at
  once), and at round end the first strike of the bell fired the same instant
  the mid-word clip was cut. Now: a fresh round waits 1.6s after the bell
  before the first call (bell → breathe → hands up → call; resume and
  background-return use a 650ms beat), enterRest stops the voice BEFORE
  ringing, and the chain refuses to start a word inside the round's final
  450ms so the end bell lands in clean air. The pop's glow returned as a
  constant shadow during the 500ms pop (two paints total) rather than a
  keyframed text-shadow (per-frame glyph repaints — the jank that got it
  removed). 191 behaviour + 262 layout green.
- **2026-07-23 — v1.11.4** — **Voice-stutter root cause + count-up butter pass.**
  The stutter on Steady/Relaxed: the between-words setTimeout was anonymous —
  stopComboLoop couldn't cancel it, so a chain cut landing inside a word gap
  (backgrounding, visibility restart, revive) left a zombie timer that revived
  the OLD combo beside the new one; two chains interleaving through the same
  pools is a stutter, and the gap windows are 3-6x wider at slow paces. Every
  chain now carries a generation token that stopComboLoop bumps, deadening all
  stale callbacks (gap timers, watchdogs, late ended events); the gap timer is
  state-owned; priming skips elements that are currently sounding (the deferred
  deep-prime could pause a clip mid-word). Restart is purpose-built in place —
  reset()+start() passed through the ready state for one frame, unfolding and
  refolding the entire chrome (the restart lag spike); it now keeps fullscreen
  and the wake lock. Count-up: blips through a decoded Web Audio buffer
  (sample-accurate; HTMLAudio jitters 10-40ms per play — deliberate trade: the
  silent switch mutes decorative blips, informational sounds stay on media),
  summary DOM built exactly once (was rebuilt at the reveal frame), count
  starts after the glide lands (one thing at a time), hero digits tabular with
  reserved width (no per-step reflow), numPop no longer animates text-shadow
  (per-frame glyph repaints). Tests: zombie-chain regression (10n), wake-lock
  held through restart, buffer-source blips instrumented. 191 behaviour + 262
  layout green.
- **2026-07-23 — v1.11.3** — **Idempotent hot paths.** The per-second render
  rewrote clock/phase/round text and three dataset attributes even when
  identical, and the 60fps ring loop re-set the constant dasharray every frame
  — each no-op write still costs style/layout work. All hot-path DOM writes now
  skip when unchanged (setText/setData helpers, dasharray set once, ready-line
  guarded). Behaviour identical; steady state is now genuinely idle between
  ticks. Note for posterity: headless Chromium's longtask/rAF instruments
  report the countdown as a multi-second "freeze" that is provably not real
  (the clock advances through it; screenshots render) — compositor-driven
  animation starves main-thread BeginFrames in headless only. Real-device lag
  verification belongs on the real device.
- **2026-07-23 — v1.11.2** — **Anti-lag engineering.** Three reported lags, three
  mechanisms: (1) tick/blip/land re-shipped as WAV — LAME puts ~50ms of encoder
  silence at the front of an MP3, stretched further by the 0.7x pitch bend, so
  every blip landed late; PCM has zero decoder delay and exact seeks. (2) The
  ~35-element synchronous prime burst ran on EVERY start/resume tap (since
  v1.8.1), freezing the screen while the timer's real-time catch-up then
  fast-forwarded the countdown. Priming is now tiered: the first tap primes one
  element per sound (unlocks iOS, 17 plays), spare slots top up on the next tap
  anywhere, later starts are free no-ops, and backgrounding costs one 17-play
  repair (tracked by a needsReprime flag). (3) The count-up was re-engineered
  from time-sampled easing (a dropped frame skipped numbers) to a precomputed
  schedule: totals ≤18 count every number, larger ones use uniform strides,
  steps fire strictly in order at most one per frame — lag delays the count,
  it can never skip. New test: a restart adds ≤4 plays where it used to re-prime
  ~35. Test 23's phantom injection switched from per-element to per-play (the
  new prime order could brick both elements of a pool, which no phone does).
  188 behaviour + 262 layout green.
- **2026-07-23 — v1.11.1** — **Count-up audio synced to the count.** Two fixes:
  the summary is built invisibly during the finale's centre-stage hold (so the
  glide can measure final layout), and the count-up ran then — leaking its
  blips ~1.7s before any number was visible. The hidden build now sets the
  final value silently and the reveal's rebuild runs the real count-up. And
  the display now steps at blip cadence when sound is on: a number never
  changes without its blip and every blip belongs to exactly one number
  (~15 audible chunks for a big total instead of a per-frame glide with a
  detached trill). The landing hit replaces the final blip. Layout suite now
  instruments HTMLMediaElement.play and asserts the count-up is silent through
  the hold and blips exactly at the reveal, on every device.
- **2026-07-23 — v1.11.0** — **Audible count-up + 5-second countdown.** The
  finish count-up plays rising blips (one rendered file, pitch bent per step
  via playbackRate with preservesPitch off — 0.7x→1.8x tracking the eased
  progress, rate-limited to 55ms like the haptics) and lands with a rendered
  thump-plus-ping. Both ship as sfx samples through the silent-switch-proof
  pipeline with synth fallbacks, both precached. Countdown extended 3s→5s
  (one COUNTDOWN_SECONDS constant; the dial-pulse wave count follows it, and
  16 countdown-crossing test waits were re-timed).
- **2026-07-23 — v1.10.2** — **Rotating finish headlines.** Ten coach-voice
  lines ("Strong finish.", "Well earned.", "In the bank."…) picked at random,
  never the same twice in a row within a visit. All shorter than "Press start
  to begin", so no new layout risk at display size. Test 33b asserts every
  headline comes from the approved set and that it varies across sessions.
- **2026-07-23 — v1.10.1** — **Fullscreen uses the whole phone.** Reported as
  "the maximum size of my iPhone isn't being utilized" — the body applied
  safe-area padding globally, so in focus mode the stage's surface never
  reached the notch strip or the bottom corners, and the #0d0d0d-on-#010101
  colour difference made the dead bands visible. `body:has(.app[data-focus="1"])
  { padding: 0 }` drops it during sessions; the stage's own env() padding keeps
  CONTENT clear of the notch while the background fills every corner. Also
  measured and fixed: the landscape composition sat ~34px left of centre (the
  72px controls gutter had no left counterweight — now symmetric). Content
  centre now measures exactly 0px off on every device and orientation.
- **2026-07-23 — v1.10.0** — **Staged finish finale; the session is one
  fullscreen thing.** The finish is now three acts: the dial alone at the DEAD
  CENTRE of the screen (a measured FLIP transform — exact in any orientation)
  with the ripple blooming while the end bell rings; a glide back to its
  resting place (up in portrait, left in landscape); then the headline and the
  count-up slide in from below, staggered. Everything-at-once was overloading.
  Under reduced motion the staging is skipped entirely. Fixed en route: the
  done-screen finishRise ANIMATION was beating the finale's opacity in the
  cascade, showing the stats through the centre-stage hold. Focus mode now
  persists from Start until the new EXIT icon (third floating button):
  pausing and restarting stay fullscreen, restart means "run it back"
  (reset+start in place), and exit is the one door back to settings — it also
  releases browser fullscreen. Interaction-model tests rewritten to match;
  layout suite asserts the exit icon is present, icon-sized, on-screen, and
  that exit restores the settings on every device. 185 behaviour + 250 layout.
- **2026-07-23 — v1.9.2** — **Session end reverted to the three-strike bell.**
  The v1.9.1 victory jingle was rejected on listening — founder's call: the
  boxing bell IS the sound of finishing. Jingle code, sample, precache entry
  and tests all removed rather than left dead; a comment at finish() records
  that the jingle was tried so it doesn't get re-proposed. The v1.9.1
  background/return fix is unaffected and stays.
- **2026-07-23 — v1.9.1** — **Victory jingle + clean background/return.**
  finish() plays `audio/sfx/victory.mp3` (rising C-major arpeggio into a held
  chord with the bell's reverb; synth fallback mirrors it) instead of ringBell(3)
  — the bell means "round boundary" all session, the end deserves its own sound.
  Fixed the reported "sound glitches or stops entirely after leaving and
  returning": iOS pauses the playing clip (its ended never fires) and throttles
  timers, so returning released a burst of stale watchdogs at once, or left the
  chain dead until the 20s revive. The callout chain is now cut cleanly on
  visibilitychange→hidden and restarted fresh on →visible (after tick() has
  caught the phase up; a return during rest stays quiet). New test section 10k
  covers backgrounding mid-round, prompt resume, no overlapping words, and the
  rest-phase case. 183 behaviour + 226 layout green.
- **2026-07-23 — v1.9.0** — **The install path, unbroken.** Real PNG icons
  rendered from the BWB wordmark (192/512 "any", 512 maskable with the logo
  inside Android's 80%-circle safe zone, 180 apple-touch-icon — iOS only
  accepts PNG there; the old SVG-only manifest meant Chrome never offered its
  install prompt and iOS fell back to a page-screenshot icon). Added a quiet,
  dismissible install nudge above About: one-tap Install where the browser
  fires beforeinstallprompt, the Share → Add to Home Screen hint on iOS
  (detected incl. iPadOS-as-Macintosh), never shown when already standalone,
  dismissal remembered in localStorage, folds away in focus mode with the rest
  of the chrome. Installed Combify opens with zero browser chrome on every
  platform — the only way to lose the Safari bar on iPhone — and is the
  prerequisite for push notifications later. All four icons precached.
  8 new nudge tests; 179 behaviour + 226 layout green.
- **2026-07-23 — v1.8.3** — **The v1.8.2 bell fix, actually effective on iOS.**
  v1.8.2's sfx flags were off-until-proven (flip on canplaythrough/loadeddata) —
  the exact pattern the voice clips abandoned long ago, for a documented
  reason: mobile Safari frequently never fires those events for preloaded
  audio. So on iPhone the flags stayed false forever, every bell fell back to
  the synth, and the synth is muted by the silent switch — no change from the
  user's point of view. Samples now default ON (the files are committed) and
  only turn off on an actual load error, mirroring `voice.useClips`. Bonus:
  the first countdown tick now plays as a media element too, making it
  independent of the AudioContext entirely. Three tests updated from mechanism
  to intent (a bell may satisfy them via sample OR synth).
- **2026-07-23 — v1.8.2** — **Bells you can hear: sfx became real samples.**
  The bell, countdown tick and 10-second warning were Web-Audio-synth only, and
  iPhones MUTE Web Audio output when the ring/silent switch is on — while
  HTMLAudioElement media (the voice clips) plays regardless. So on a phone set
  to silent, the voice called combos and every bell and tick was dead silence:
  "bells not working". The three cues are now rendered offline to
  `audio/sfx/*.mp3` (same FM synthesis + a Schroeder approximation of the
  reverb tail, loudness matched to the voice clips) and play through the same
  primed-element pipeline as the voice, with the synth kept as a per-sound
  fallback. Also found in the sweep: **no audio file was in the service-worker
  precache** — an installed app opened offline ran the entire session in
  silence (all 15 files now precached, test-enforced); and the bell pool of 2
  couldn't hold the session-end "ding-ding-ding" (3 strikes 650ms apart on a
  ~2.5s ring), so the third strike cut off the first — bell pool is now 3.
  A play() rejection no longer disables a sample for the whole session.
  Tests: new sections for sample-based sfx and for missing-sfx synth fallback;
  spoken-vs-shown assertions now separate voice from sfx. 170 behaviour + 226
  layout green; real-browser run confirms all three samples decode and a full
  session plays 4 bell strikes through the media path.
- **2026-07-23 — v1.8.1** — **Bulletproofed the audio.** Two reported symptoms,
  one shared root cause: `audioCtx.resume()` was called in exactly one place
  (inside `start()`), fire-and-forget. Because `resume()` is async and the first
  countdown tick fired synchronously right after it, that tick was scheduled
  against a still-suspended context and lost — "the countdown bells don't even
  start firing". Worse, an AudioContext is suspended by the OS whenever the
  phone locks, a call arrives, another app takes audio focus or the tab is
  backgrounded, and *nothing* resumed it afterwards: every tick, bell and
  warning was silent for the rest of the session, with no error raised. Now all
  synthesized sound goes through `withAudio()`, which guarantees a running
  context and plays a few ms late rather than never; `armAudio()` re-arms on
  visibilitychange, on any pointerdown/touchstart (some browsers only allow
  resume from a gesture), and on resume(). `unlockAudioForMobile()` now runs on
  every start AND resume (iOS revokes the unlock after an interruption), repairs
  a half-built pool, and sets its flag last so a throw mid-way retries instead
  of breaking playback permanently. Separately, ONE failed clip used to switch
  the whole app to robotic TTS for the session; failures are now tracked per
  word, that word alone is spoken via TTS, a later successful load clears the
  mark, and clips are only abandoned once 4+ have failed. Clip playback itself
  (cloned HTMLAudioElement) is untouched. Four new test sections inject a
  suspended context at Start, mid-round, and across pause/resume, plus a missing
  clip — all previously silent-with-no-error. Also made two randomness-dependent
  tests deterministic; one failed roughly one run in seven.
- **2026-07-23 — v1.8.0** — **A changelog anyone can read, and a versioning
  rule.** Added `changelog.html`, its own page rather than a panel inside About
  because the list only grows and the app screen should stay short enough that
  Start is always the obvious thing to press. It's linked from About, opens
  in-app (not a new tab, which from an installed Combify would throw you out to
  the browser), works offline, and is written for Bakr: each release is labelled
  **New** or **Fixes** and says what he'd notice, so he can point at a version
  and ask for it back. Entries live in `js/changelog.js`; tests fail the build
  if the newest entry doesn't match `VERSION`, so it can't rot. History now
  reaches back past the version stamp — the first two days ship as **Early
  build** entries rather than being given numbers that were never released.
  Also: in portrait the Pause/Reset icons moved to the bottom centre, on the
  same vertical axis as the ring and combo (landscape keeps its right-edge
  column). §14 documents the notation and records the version audit.
- **2026-07-23 — v1.7.1** — **Per-move callout highlight; countdown glides
  again; test suite ~6× faster.** The screen now tracks the voice: the single
  move being called turns BWB teal with a small lift, so you can glance down
  mid-combo and see where you are. It replaces the whole-combo pop, which fired
  when there was nothing new to read. Only the move itself is marked, not its
  "-" separator. The 3-2-1 disc glides between its per-second steps again
  (a 0.45s transition scoped to the countdown) — the hard jumps read as blocky;
  work and rest keep the per-frame sweep. **Testing:** the full suite went from
  ~3m15s to **34s** for 375 checks, with no coverage removed — layout devices
  now run concurrently (`--jobs`, default 6) and the fixed sleeps became
  phase-condition waits, which also return as soon as the app is ready instead
  of always burning the worst case. That change surfaced a dud assertion: the
  rotation section's 35s sleep expired before the session ever finished, so
  "finish screen survives rotation" had been checking a mid-round screen. It
  now genuinely reaches the finish, and asserts it.
- **2026-07-23 — v1.7.0** — **Combo pop, stepped countdown, and four bug fixes.**
  Every new combo now lands with a small pop, so someone watching from across
  the room sees a new one arrived instead of having to re-read the text. The
  3-2-1 countdown disc is back to hard per-second steps (work and rest keep the
  smooth sweep) — three big chunks read as "get ready", a sweep just looked like
  a short round. Fixed: **Resume was a dead button** if you paused during the
  countdown (the click handler had no branch for that phase, so every press just
  paused again — Reset was the only escape); the **finish ripple was centred on
  the stage, not the dial**, so it bloomed off-centre from the very circle it
  comes out of, and drifted further whenever the layout changed height — it is
  now anchored to the dial at exactly the ring's radius; **finishing and
  resetting no longer drop out of fullscreen** (the collapse yanked the layout
  mid-celebration, and Reset dumped you back into browser chrome you then had to
  escape again). Leaving fullscreen is the user's call now. 146 behaviour + 225
  layout checks green.
- **2026-07-23 — v1.6.0** — **True fullscreen sessions.** Starting a session now
  requests real browser fullscreen where the platform allows it (Android
  Chrome, desktops; iPhone Safari has no fullscreen API — there the installed
  PWA covers it), and focus mode is edge-to-edge: no page padding, no card
  border, the stage IS the screen. Pause/Reset shrink to floating glass
  squircle icons (bottom-right in portrait, right-edge centred in landscape/
  desktop) so no pixel band is reserved for buttons, and the clock/combo type
  scaled up ~10% to use the reclaimed space. Countdown now fires a translucent
  teal pulse that fills the dial from the centre out once per "get ready"
  second. Removed the manifest's portrait orientation lock, which contradicted
  the purpose-built landscape layouts on installed phones. Tests: fullscreen
  lifecycle (enters on start, survives pause, exits at finish; clean no-API
  fallback), edge-to-edge stage assertions, icon-sized-controls check; the
  rotation suite now drops out of fullscreen before resizing (Chromium refuses
  to resize a fullscreen window). 225 layout + 136 behaviour checks green.
- **2026-07-22 — v1.5.1** — **Smooth ring drain + landscape ready/finish fix.**
  The progress ring now drains continuously (redrawn every frame from the same
  real-time deadline the timer uses) instead of stepping once a second;
  reduced-motion users keep the per-second steps. Fixed the off-session
  landscape ready/finish screens, where a ~100px ring sat behind a 32px clock
  and the digits burst out of the circle — the ring is now dropped there (it
  was near-invisible anyway) and the text stands alone. The base clock is
  sized with the ring (`min(16vw, 64px)`), which also stops digits poking out
  of the ring on a 320px phone. New layout checks: time-inside-ring on the
  ready and finish screens, and a three-sample probe proving the ring moves
  between second ticks.
- **2026-07-22 — v1.5.0** — **Visual pass, driven by actually looking at
  screenshots.** Added a progress ring around the clock (the screen had no
  centre of gravity — text floating in an empty box). Combo now renders as
  per-move tokens so a wrapped combo never starts a line with a dangling "-",
  and long combos scale down to fit. Finish screen rebuilt around the punch
  total. Warm orange formalised as `--streak` tokens, used ONLY for the streak;
  everything else stays BWB teal. Fixed: clock overlapping the combo in
  landscape and on desktop (flex-basis resolves to content width — now a grid
  with `minmax(0,1fr)`), the ring collapsing to text width (a `100%` resolving
  against a shrink-to-fit parent), "Intermediate" truncated on a normal iPhone,
  a glow halo around the finish text, and the streak printed twice.
  Layout tests gained overlap detection between element pairs — 206 checks
  passed while the screen was visibly broken, because nothing measured whether
  two things occupied the same space. Also `--only <device>` and `--fast`
  flags: a single-device run is ~18s instead of a ~5min sweep.
- **2026-07-22 — v1.4.0** — **Full-screen focus mode.** While a session runs the
  stage takes the whole screen and the chrome folds away, so the combo can be
  read from across the room; pausing brings the settings back, which is how you
  change something mid-session without a new control to learn. Purpose-built
  layouts for portrait, landscape and desktop (a Mac now uses its space instead
  of a phone-width column). Finish screen rebuilt so the punch total is the
  headline at display size. Added `tests/layout.mjs` — a REAL Chromium driving
  six viewports plus mid-round rotation, because jsdom does no layout and can't
  tell you text is clipped or a button is off-screen.
- **2026-07-22 — v1.3.1** — Flame from the first session; 7 & 8 confirmed as
  body shots.
- **2026-07-22 — v1.3.0** — **First real combo from Bakr: the "10 combo"**
  (1-2-3-2-1-1-2-slip-2-3-2-roll, named for its ten punches), added to advanced
  and announced by name on screen via `COMBO_NAMES` in `js/combos.js` — add a
  name there and the app calls it the way Bakr does. Finish screen now counts
  the punch total up, lands with a pop, and shows a CSS flame on a streak of 2+.
  Haptics on landing where supported (not iOS — no Vibration API there).
- **2026-07-22 — v1.2.1** — Hold +/- to run values fast.
- **2026-07-22 — v1.2.0** — Streaks and session logging (§6.4). Completed
  rounds, punches and time are stored per day in `localStorage`; ready screen
  shows the streak and lifetime totals, finish screen shows the session.
- **2026-07-22 — v1.1.0** — Version stamp in About, wired to the service worker
  cache name so a bump forces existing installs to refresh.
- **2026-07-22** — Settings persist between visits (level/pace/rounds/work/rest/
  voice).
- **2026-07-22** — **Test suite added** (`npm test`, 82 checks). Runs the real
  `app.js` in jsdom with a fake clock, injecting the failure modes phones
  actually produce. Written after two bugs reached the gym.
- **2026-07-22** — Mobile audio and timing fixes found via Bakr's testing:
  combo audio no longer dies mid-round (dropped `ended` events on reused
  elements); a clip that fails silently is retried so combos stop dropping a
  punch; the bell no longer reaches for a sample that was deleted; the timer
  keeps real time when the tab is backgrounded (was losing 177s of every 180s);
  screen wake lock; iOS double-tap zoom no longer fights the +/- steppers.
- **2026-07-22** — Combos no longer repeat back-to-back; removed a duplicate
  beginner entry that made one combo twice as likely.
- **2026-07-22** — Settings reordered by importance: Level and Combo pace on the
  first screen, round lengths inside "More options".
- **2026-07-22** — ElevenLabs clips are live. The founder recorded all 12 words
  as one continuous natural take (with `<break>` tags between words) instead of
  12 separate recordings; split programmatically using detected silence gaps
  with padding + micro-fades to avoid clicks. App and the shareable preview
  both now call combos in the real ElevenLabs voice. Remaining: a real-phone
  listening test.
- **2026-07-22** — Voice provider switched to **ElevenLabs**. Reverted the
  VoiceBox "dawg" clips (didn't sound good enough) back to TTS-only, live-tested
  5 free Microsoft Edge neural voices and a tonal-variation concept (both proven
  to work, but founder chose ElevenLabs instead), then restored the
  provider-agnostic clip-playback system pointed at ElevenLabs (`.mp3`).
  Currently back on TTS fallback until the ElevenLabs clips are generated.
- **2026-07-22** — Added the 12 "dawg" voice clips (`.wav`) to `audio/`; app now
  calls combos in the real AI voice instead of TTS. Files transferred from the
  founder's Mac via a terminal upload (tmpfiles.org) since this environment has
  no direct filesystem access to his machine.
- **2026-07-22** — Voice decided: AI clips ("dawg" from VoiceBox). Built the
  clip-playback + chaining system with TTS fallback; added `audio/README.md`
  with the 12-file list. Awaiting the generated clips.
- **2026-07-22** — Expanded this roadmap into a full planning document.
- **2026-07-21** — v1 built: timer + combo caller; app-like swipe/stepper
  settings; natural-voice selection; pace synced to voice; punches 7 & 8 +
  real difficulty scaling; collapsible "More options"; PWA + offline. Live
  preview published as a Claude Artifact. Not yet on GitHub.

---

## 14. Versioning — how the number is chosen

**The notation.** A version is three numbers, `MAJOR.MINOR.PATCH` — so `1.8.0`
is major 1, minor 8, patch 0. This is the industry-standard scheme (semantic
versioning). You only ever *add one* to a single position, and everything to
its right resets to zero:

| Bump | From `1.7.1` you get | When |
| --- | --- | --- |
| **Patch** — add 1 to the last number | `1.7.2` | Fixes, refinements, tweaks to things that already exist. |
| **Minor** — add 1 to the middle, reset the last to 0 | `1.8.0` | Something new you can *see and use*. |
| **Major** — add 1 to the first, reset the rest to 0 | `2.0.0` | A reimagining, or a change that breaks how the app already worked. |

Two habits worth keeping: it's `1.8.0`, never `1.8` (always three numbers), and
the middle number is not a decimal — after `1.9.0` comes `1.10.0`, not `2.0.0`.
"A 0.0.1 change" means a patch; "a 0.1 change" means a minor, written `0.1.0`.

**The rule for this project.** Size the bump to the change, not to how many
things shipped together:

- **Minor** — something new you can see and use. Focus mode, the progress ring,
  streaks, true fullscreen, the changelog page.
- **Patch** — fixes, refinements and tweaks, however many land at once.
- **Major** — not used yet. Combify has been `1.x` since the first working
  build; `2.0.0` would mean something like the breakdown-animation rewrite
  (§6.3), not another round of polish.

Bumping also means moving `VERSION` in `js/version.js`, `CACHE` in `sw.js`, and
`version` in `package.json` together (the suite fails the build if they
disagree), plus adding an entry to `js/changelog.js` (also enforced).

**The audit (2026-07-23).** Reviewing every release against that rule, two were
numbered too generously and one too meanly:

| Shipped as | Should have been | Why |
| --- | --- | --- |
| v1.1.0 | patch | Only showed the build number in About. |
| v1.7.0 | patch | One tweak plus four bug fixes — no new capability. |
| v1.7.1 | minor | The per-move callout highlight is a genuinely new, visible feature. |

Every other release was sized correctly.

**Why the numbers were NOT rewritten.** A version's job is to answer "which
build is my phone running?", which only works if the number matches what was
actually served at the time and never goes backwards. Renumbering would put the
changelog at odds with the git history (commits name their versions) and would
show a *lower* number on a phone that had already displayed a higher one — real
cost, no functional gain. Instead the record is corrected where it's read:
`js/changelog.js` labels each release **New** or **Fixes** by what it actually
was, so `v1.7.0 · Fixes` tells the truth even though the digits don't. From
v1.8.0 on, the digits and the label agree.

**Before version numbers existed.** The first two days (2026-07-21 to 07-22)
predate the version stamp — the real voice, the fixes from Bakr's testing,
combo variety and settings persistence all shipped unnumbered. They're in the
changelog as **Early build** entries with their dates rather than being given
numbers that were never really released.
