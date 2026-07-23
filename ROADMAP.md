# Combify — Product Roadmap & Plan

> The single source of truth for this project. If you read one file at the start
> of a session, read this one. It holds the vision, every idea we've had, what's
> built, what's next, and what only you can do.
>
> **Last updated:** 2026-07-22 · **Current version:** v1.5.1 (live on GitHub Pages)
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
2. **Music** — play-your-own in the background *(recommended)* / full Spotify
   integration / skip? → see **6.2**
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

### 6.2 — Music while training 🟡 · M2

- **What:** let people shadowbox to their own music alongside the bell/voice.
- **Why:** people strongly associate shadowboxing with music; its absence feels
  dead.
- **Reality check:** a phone already plays background music from Spotify/Apple
  Music while another app runs. So "connecting" may be unnecessary — we mainly
  need our audio to coexist and not kill their music.
- **Options:**
  - **A) Play-your-own — recommended.** User starts their music app, then opens
    Combify; music continues under the bell/voice. Add "Open Spotify / Apple
    Music" shortcut buttons. Works today, no logins, no cost.
  - **B) Full Spotify integration.** Pick playlists / control playback in-app via
    the Web Playback SDK. Requires **every user** to have Spotify **Premium**, log
    in through Spotify, plus app registration. Apple Music is a separate SDK. Big
    build. Later milestone.
- **Tasks:**
  - [ ] Decide the option
  - [ ] (A) Add quick-launch buttons; verify our audio ducks/coexists on iOS +
        Android without stopping background playback
  - [ ] (B) — deferred; scope separately if we ever commit
- **Done when:** a user can have their playlist going and hear both the music and
  the callouts comfortably.
- **Effort:** A = **S** · B = **XL**
- **Open questions:** does our WebAudio bell interrupt background music on iOS?
  (Needs a real-device test — may require configuring the audio session.)

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
  | `js/app.js` | Timer, bell, voice, settings controls |
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
