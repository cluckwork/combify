// changelog.js — what changed in each release, in plain language.
//
// This is the USER-FACING history shown on changelog.html. Keep it short and
// written for a member or for Bakr, not for a developer: what they'd notice,
// not how it was built. The engineering detail belongs in the git log, and the
// planning detail in ROADMAP.md.
//
// HOUSE STYLE — every line is a claim, not a paragraph.
//
// Short phrases. Say WHAT changed, never how or why; the mechanism belongs in
// the git log. A note over ~25 words is doing too much and should be split or
// cut. Read the list back and ask whether a member skimming it would learn
// anything from each line — if not, delete the line.
//
// ONE ENTRY IS ONE THEME, NOT ONE DEPLOY.
//
// The version number still moves on EVERY deploy — that is how the founder
// confirms a build actually reached his phone, and sw.js keys its cache on it,
// so it can never be skipped. But a run of deploys refining the same thing is
// ONE entry, carrying the highest version of that run. Sixteen deploys in one
// day became seven entries; the whole history collapsed from 59 to 21. A
// version with no entry is not an error, it is a deploy that had nothing worth
// telling a member.
//
// A four-part version was considered for the noise and rejected: it would just
// move the same problem down a digit. The fix is not a finer number, it is
// fewer entries.
//
// THE NEWEST ENTRY MUST MATCH js/version.js — the test suite fails the build if
// they disagree, so this can't silently fall behind. When a deploy joins the
// theme above it, move that entry's `v` up to the new version rather than
// adding another.
//
// Fields:
//   v     version, or null for the work done before version numbers existed
//         (the first few days). Those are shown as "Early build".
//   from  optional. The FIRST build of a run when one entry covers several.
//         The version moves on every deploy, so finishing a theme over five
//         builds leaves four numbers with no entry of their own; `from` shows
//         the span — "v1.14.0 ~ 1.14.4" — so the gap reads as one piece of
//         work rather than as missing releases. Omit it for a single build.
//   size  "minor" = something new you can see and use · "patch" = fixes and
//         refinements. This is what the page labels New / Fixes, and it is
//         the HONEST description of the release — two early versions were
//         numbered before the rule in ROADMAP §14 existed, so for those the
//         label and the digits disagree. The label is the true one.
//
// Newest first.
export const CHANGELOG = [
  {
    v: "2.1.0",
    date: "2026-09-06",
    size: "minor",
    title: "A new icon",
    notes: [
      "Combify has its own mark: the countdown ring, opened into a C, cooling teal to a warm tip.",
      "The old teal square with a letter in it read as a sibling of the BWB logo. This does not.",
      "You may need to remove and re-add it to your home screen to see the new one.",
    ],
  },
  {
    v: "2.0.1",
    date: "2026-09-06",
    size: "patch",
    title: "Sound effects are back",
    notes: [
      "Fixed every sound except the voice going silent with the iPhone silent switch on. Yesterday's lock-screen tidy-up removed the thing that was protecting them.",
      "The lock-screen player may reappear after a session. That is the trade: a tidy lock screen is cosmetic, silent bells are not.",
      "Fixed the countdown playing only its first tick.",
    ],
  },
  {
    v: "2.0.0",
    date: "2026-09-05",
    size: "minor",
    title: "Version numbers, reset",
    notes: [
      "Renumbered. Combify shipped 36 numbered builds in six weeks, which said more about how often it deployed than about what changed.",
      "One number is now one real change. Everything below has been renumbered to match, so an old screenshot will show a number that no longer exists.",
      "A number's middle digit now means something new to use; the last digit means fixes. So the number tells you how big the change was.",
      "Where one change took several builds, the entry shows the span, like v1.14.0 ~ 1.14.4.",
      "This page rewritten with it: short lines, merged releases, no boxes. 59 entries became 22.",
    ],
  },
  {
    v: "1.12.7",
    from: "1.12.0",
    date: "2026-09-05",
    size: "minor",
    title: "Putting Combify on your home screen",
    notes: [
      "Install steps now match your phone and your browser. iPhone, iPad and Android all differ, and so does where each browser hides its Share button.",
      "Steps draw the icons you are looking for instead of naming them.",
      "An arrow points at the button you need. No arrow where we cannot be sure.",
      "Fixed impossible steps in Chrome on iPhone. Any browser can do this, not just Safari.",
      "Saying no is remembered, but the card returns after a few more sessions, less often each time. Added Don't ask again.",
      "Computers are never asked. There is no home screen there.",
      "Added Add to home screen to the footer.",
    ],
  },
  {
    v: "1.11.2",
    from: "1.11.0",
    date: "2026-09-05",
    size: "minor",
    title: "The countdown hits, the finish lands",
    notes: [
      "New countdown: each second drops in hard and throws a ring across the dial.",
      "Bigger countdown number. Get ready no longer appears twice.",
      "Countdown ring starts full instead of drawing itself in.",
      "Punch total grows as it counts up, then pops.",
      "Fixed lag on the climbing count, worst on big totals.",
    ],
  },
  {
    v: "1.10.9",
    from: "1.10.6",
    date: "2026-09-05",
    size: "patch",
    title: "Sound fixes",
    notes: [
      "Fixed words starting mid-syllable after locking your phone. Pivot as vot, slip as lip.",
      "Fixed the countdown tick going silent.",
      "Fixed sound effects staying muted for the rest of a session.",
      "Fixed the countdown shockwave never appearing.",
      "No more player left sitting on your lock screen after you finish.",
    ],
  },
  {
    v: "1.10.5",
    from: "1.10.3",
    date: "2026-09-05",
    size: "patch",
    title: "Nothing waits on the app",
    notes: [
      "Pausing no longer adds up to a second to your round.",
      "Start, pause, exit and restart respond immediately.",
      "New versions arrive on their own, and never mid-session.",
    ],
  },
  {
    v: "1.10.2",
    from: "1.10.0",
    date: "2026-09-05",
    size: "minor",
    title: "A walkthrough on your first visit",
    notes: [
      "Five stops: the timer, the combos, your level, More options, and start.",
      "Points out that More options holds rounds and work and rest times.",
      "Mentions that turning your phone sideways gives a bigger view.",
      "Shown once. Skippable.",
    ],
  },
  {
    v: "1.9.5",
    date: "2026-09-05",
    size: "patch",
    title: "Honest usage numbers",
    notes: [
      "Development traffic no longer counts as members.",
    ],
  },
  {
    v: "1.9.4",
    from: "1.9.3",
    date: "2026-09-05",
    size: "patch",
    title: "Developer tools",
    notes: [
      "Hidden panel: jump to the finish screen, replay the walkthrough, preview a streak, or see any platform's install card.",
      "Nothing changes for members.",
    ],
  },
  {
    v: "1.9.2",
    date: "2026-08-30",
    size: "patch",
    title: "The home-screen tip waits until you have trained",
    notes: [
      "Waits until you have finished a session before mentioning the home screen.",
      "On iPhone the tip shows the steps with Safari's Share icon drawn in.",
      "Dismissing hides it for a week rather than forever.",
    ],
  },
  {
    v: "1.9.1",
    from: "1.9.0",
    date: "2026-07-24",
    size: "minor",
    title: "The app counts its own training days",
    notes: [
      "Anonymous tally of sessions and punches, so the team can see the app being used. A random device number, never a name.",
      "Problem reports also file into the team sheet, where a daily check reads and diagnoses them.",
    ],
  },
  {
    v: "1.8.6",
    from: "1.8.0",
    date: "2026-07-24",
    size: "minor",
    title: "Report a problem, from inside the app",
    notes: [
      "New Report a problem link in the footer. Sends a sentence plus a technical sound log.",
      "One step: describe it, hit Send, get a thank-you. No copying, no share sheets.",
      "The log records in the background and survives closing the app, so problems can be reported after they happen.",
      "Falls back to sending manually if there is no connection, so nothing is lost at the gym.",
      "Card restyled to match the app, and it clears the keyboard while you type.",
      "Rising blips match your count: one note per punch up to two dozen. Bigger totals climb longer.",
      "Climbing numbers track the rising blips exactly, even when the phone is busy.",
    ],
  },
  {
    v: "1.7.0",
    date: "2026-07-24",
    size: "minor",
    title: "A new sound engine",
    notes: [
      "Sounds now start within a couple of milliseconds however busy the phone is, and work with the silent switch on.",
      "Speaker warmed up on Start, so the first countdown ticks land on tempo.",
      "Fixed slip vanishing: a stuck player silently swallowed the word. Stuck players are detected and reset.",
      "A corrupted cached sound no longer blacklists a word for the day.",
      "Combo cadence tightened. Music apps get their audio back after the finish.",
    ],
  },
  {
    v: "1.6.8",
    from: "1.6.1",
    date: "2026-07-23",
    size: "patch",
    title: "Chasing the stutter",
    notes: [
      "Fixed the word stutter and double bell strikes: the app and the phone were both rewinding a sound at once.",
      "Fixed words collapsing to a ghost of themselves after an earlier attempt at the same bug.",
      "Fixed the finish blips glitching when the phone dropped frames. The riff keeps its own time now.",
      "A combo no longer starts talking right before the bell.",
      "Countdown clicks keep an even tempo, and the countdown starts on a clean beat.",
      "The app can record its own black-box log: five taps on the version, run a session, Copy audit log.",
      "New torture-test suite runs hundreds of sessions against the misbehaviour real iPhones produce.",
      "Starting a session has a real entrance, settling before the countdown begins.",
      "Text can no longer be selected by long-pressing. It behaves like an app, not a web page.",
    ],
  },
  {
    v: "1.6.0",
    date: "2026-07-23",
    size: "minor",
    title: "Know your session, never miss the bell",
    notes: [
      "The main screen shows how long your whole session will take, rounds plus rests.",
      "Rest warns you before it ends: a heads-up at 10 seconds, then 3-2-1 ticks.",
      "The Call combos out loud switch is gone. The voice is always on.",
    ],
  },
  {
    v: "1.5.9",
    from: "1.5.0",
    date: "2026-07-23",
    size: "minor",
    title: "A finish worth watching",
    notes: [
      "Finishing is a moment now: the ring holds centre stage, then your numbers slide in one by one.",
      "The punch count sounds like it feels: rising blips as your total climbs, and a landing hit when it arrives.",
      "Every number lands together with its own blip, and none are skipped when the phone is busy.",
      "A glow builds behind the total, peaks with the pop, and fades.",
      "The finish screen congratulates you differently each time.",
      "The whole session stays fullscreen. A new exit button leaves it, and restart restarts in place.",
      "The countdown is 5 seconds instead of 3, and the app fills the whole phone.",
      "Version and What's new moved to the bottom of the main screen.",
    ],
  },
  {
    v: "1.4.5",
    from: "1.4.0",
    date: "2026-07-23",
    size: "minor",
    title: "Sound that stays on",
    notes: [
      "Fixed all sound dying for the rest of a session after a lock, a call, or switching apps.",
      "Bell, ticks and warnings now play with the iPhone silent switch on.",
      "All sounds work offline in the installed app.",
      "The session ends with the classic three bell strikes.",
      "Combify can be put on your home screen properly, with a real BWB logo icon.",
      "If one voice clip fails to load, only that word falls back to the phone's voice.",
    ],
  },
  {
    v: "1.3.3",
    date: "2026-07-23",
    size: "patch",
    title: "This page",
    notes: [
      "Added this list of updates, so you can see what changed and when.",
      "If a change made something worse, note the version next to it. Going back is easy.",
    ],
  },
  {
    v: "1.3.2",
    from: "1.3.0",
    date: "2026-07-23",
    size: "minor",
    title: "True fullscreen training",
    notes: [
      "A session takes over the whole screen, so there is no browser bar while you train.",
      "Pause and Reset became small corner icons, giving the combo more room.",
      "The move being called lights up as you hear it.",
      "Fixed Resume doing nothing if you paused during the countdown.",
    ],
  },
  {
    v: "1.2.2",
    from: "1.2.0",
    date: "2026-07-22",
    size: "minor",
    title: "A proper look",
    notes: [
      "Added the ring around the clock that empties as the round runs down, draining smoothly.",
      "While a session runs, everything but the combo folds away so it reads from across the room.",
      "Proper layouts for upright, on its side, and on a laptop.",
      "Long combos wrap neatly and scale to any screen.",
    ],
  },
  {
    v: "1.1.4",
    from: "1.1.0",
    date: "2026-07-22",
    size: "minor",
    title: "Streaks, and Bakr's 10 combo",
    notes: [
      "Your rounds, punches and days in a row are saved on your phone.",
      "The finish screen tells you what you just did, with a flame for your streak from day one.",
      "Added Bakr's 10 combo, announced by name on screen.",
      "Hold + or - to run a number up or down instead of tapping repeatedly.",
      "The app shows which build it is running, so you can tell if your phone has the latest.",
    ],
  },
  {
    v: null,
    date: "2026-07-22",
    size: "minor",
    title: "A real voice, and Bakr's first testing",
    notes: [
      "Combos are called out in a real recorded voice instead of the phone's robotic one.",
      "Fixed callouts going silent partway through a round.",
      "The timer keeps proper time if you switch apps mid-round, and the screen stays awake.",
      "The same combo cannot come up twice in a row, and your settings are remembered.",
      "Level and Combo pace moved to the top; round lengths tucked into More options.",
    ],
  },
  {
    v: "1.0.0",
    date: "2026-07-21",
    size: "minor",
    title: "Combify",
    notes: [
      "Round timer that calls out real boxing combos out loud, with three levels and adjustable pace.",
      "Works offline and can be added to your home screen like an app.",
    ],
  },
];

export const LATEST = CHANGELOG[0];
