# Combify — Roadmap

The single source of truth for where this project is and what's next. Read this
first each session. Last updated: **2026-07-21**.

---

## The vision

**Combify** — a round timer + boxing combo caller web app, "by Boxing With Bakr."

**Why it exists (the business goal):** keep gym members training *between*
classes. More reps at home → more progress → members stay and keep paying. Good
for the boxer, good for Bakr's business. It's also a marketing differentiator —
"our gym has its own training app."

**Guiding principle:** real usage is the only measure of value. Ship the
smallest thing real people will open, watch if they use it, then build more.
Validate before going all-in on big features.

---

## ✅ Done so far (v1)

- Round timer — rounds, work/rest periods, synthesized bell
- Combo caller — combos shown on screen **and** called out loud
- Three difficulty levels (beginner / intermediate / advanced) with real
  difficulty scaling
- Full move set: punches **1–8**, plus **slip, roll, block, pivot**
- App-like settings: swipe segmented controls, drag/tap steppers, toggle switch
- "More options" dropdown hides pace + voice; Level and round setup stay up front
- Natural-voice selection (picks the best voice on the device)
- Pace is synced to the voice — the next combo waits for the callout to finish
- Installable as a phone app (PWA) + works offline
- Combos live in one editable file: `js/combos.js`
- Live preview published as a Claude Artifact for sharing/testing

---

## 🟡 Decisions waiting on YOU

These need your call before I can build them. (Details for each are in the
Backlog below.)

- [ ] **Voice quality** — record real coach clips (recommended) / voice picker /
      cloud AI voice?
- [ ] **Music** — let users play their own in the background + quick-launch
      buttons (recommended) / full Spotify integration / skip for now?
- [ ] **Breakdown animation** — green-light the 2D silhouette proof-of-concept
      (jab + cross demo) before committing to all moves?

---

## 🥊 Things only YOU can do (real-world, no code)

- [ ] **Show Bakr the preview** and watch his reaction — would he actually tell
      members to use it? This is the most important validation step.
- [ ] **Ask Bakr what 7 and 8 mean** in his numbering system (gyms differ — body
      hooks? overhands?). Needed for correct combos + the breakdown feature.
- [ ] **Get Bakr's real combos** to replace the placeholder combos in
      `js/combos.js`. This makes it *his* gym's app, not a generic timer.
- [ ] (Optional) Ask Bakr his biggest headache running the gym — may reveal an
      even higher-value feature.

---

## 📋 Feature backlog (ideas, roughly prioritized)

### 1. Voice — make it sound like a real coach
The robotic voice is a device-TTS limitation. Options:
- **Recorded coach clips (recommended):** you/Bakr record ~12 short punchy
  callouts ("one", "two"… "slip", "roll"). App plays those. Sounds authentic,
  offline, free, on-brand.
- **Voice picker (TTS):** let users choose the best device voice. Free, no
  recording, still robotic on weak devices.
- **Cloud AI voice:** truly natural, but costs money + needs internet/backend.
  Overkill for now.

### 2. Music while training
People like to shadowbox to their own music. Options:
- **Play-your-own (recommended):** users start Spotify/Apple Music, then open
  Combify; music keeps playing under the bell/voice. Add "Open Spotify / Apple
  Music" quick buttons. Works today, no logins.
- **Full Spotify integration:** pick playlists in-app. Needs Premium + login for
  every user + app registration. Big build — later milestone.

### 3. "Break it down" — animated combo breakdown  ← the big one
A help feature that *teaches* the combo, turning Combify from a shouting timer
into a coach.
- **Button** ("Break it down") → shows the **last few combos** called this round
  → user taps the one they struggled with → a **blank silhouette figure**
  performs it slowly, move by move, with coaching cues and step-through controls.
- **How it works:** animate each move once (like a video game), then chain the
  clips to match any combo. The work is creating a clean animation per move
  (1–8, slip, roll, block, pivot).
- **Approach:** 2D coded silhouette (recommended — self-contained, matches the
  silhouette vision, smooth via tweening) vs. full 3D (Three.js + Mixamo mocap;
  most realistic but heavy and hard to maintain).
- **Plan:** build proof-of-concept (button + combo history + jab & cross
  animated) FIRST → judge quality → then animate the rest. Don't build all 12
  animations on spec.
- **Prep that's cheap and needed anyway:** start logging combo history as combos
  are called.

### 4. Retention features (serve the core business goal)
- Session tracking / a simple streak ("you trained 4 days this week")
- Save your favorite settings so they persist
- Named "signature" combos from Bakr
- A single shareable gym link Bakr hands to every member

---

## 🚀 Deployment (get it onto a real URL)

- [ ] Get the code onto the user's **GitHub** account
      - Blocker: `gh` CLI isn't logged in, and this environment may block
        outbound network to GitHub.
      - Next step: test whether GitHub is reachable from here. If yes →
        `gh auth login`, push, done. If no → hand over the exact git commands to
        run on the user's own laptop.
- [ ] Turn on **GitHub Pages** for a free live URL (e.g.
      `username.github.io/combify`) to text to Bakr and install on a phone

---

## Project facts (quick reference)

- **Repo:** `/home/joe/git/BWB-combo` (git initialized locally)
- **Stack:** vanilla HTML / CSS / JavaScript, no framework, installable PWA
- **Edit combos here:** `js/combos.js`
- **No accounts / database / payments in v1** — deliberately. Add only if used.
- **Numbering:** 1 jab, 2 cross, 3 lead hook, 4 rear hook, 5 lead uppercut,
  6 rear uppercut, 7 & 8 = TBD (confirm with Bakr), plus slip/roll/block/pivot
