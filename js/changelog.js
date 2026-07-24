// changelog.js — what changed in each release, in plain language.
//
// This is the USER-FACING history shown on changelog.html. Keep it short and
// written for a member or for Bakr, not for a developer: what they'd notice,
// not how it was built. The engineering detail belongs in the git log, and the
// planning detail in ROADMAP.md.
//
// WHEN YOU SHIP A VERSION, add an entry here with the same number you put in
// js/version.js — the test suite fails the build if the newest entry and
// VERSION disagree, so this can't silently fall behind.
//
// Fields:
//   v     version, or null for the work done before version numbers existed
//         (the first few days). Those are shown as "Early build".
//   size  "minor" = something new you can see and use · "patch" = fixes and
//         refinements. This is what the page labels New / Fixes, and it is
//         the HONEST description of the release — two early versions were
//         numbered before the rule in ROADMAP §14 existed, so for those the
//         label and the digits disagree. The label is the true one.
//
// Newest first.
export const CHANGELOG = [
  {
    v: "1.19.0",
    date: "2026-07-24",
    size: "minor",
    title: "The app counts its own training days",
    notes: [
      "Combify now keeps an anonymous tally of how much it's being used — sessions started and finished, punches thrown — so the team can see the app earning its keep day by day. Fully anonymous: a random device number, never a name or anything personal.",
    ],
  },
  {
    v: "1.18.0",
    date: "2026-07-24",
    size: "minor",
    title: "Problem reports triage themselves",
    notes: [
      "Behind the scenes, every problem report now also files itself into the team's tracking sheet, where an automated daily check reads new reports, diagnoses the attached logs, and notifies the developer — so issues get looked at even before anyone opens their inbox.",
    ],
  },
  {
    v: "1.17.3",
    date: "2026-07-24",
    size: "patch",
    title: "Report card clears the keyboard",
    notes: [
      "The report card now sits in the upper part of the screen, so the phone keyboard no longer covers it while you type.",
    ],
  },
  {
    v: "1.17.2",
    date: "2026-07-24",
    size: "patch",
    title: "Report card, properly dressed",
    notes: [
      "The report card now looks like Combify: the app's own title style, a quiet Cancel, a compact teal Send, and a smooth entrance — instead of two oversized buttons filling the card.",
    ],
  },
  {
    v: "1.17.1",
    date: "2026-07-24",
    size: "patch",
    title: "Count-up locked to the sound, report card polished",
    notes: [
      "The climbing numbers now track the rising blips exactly: the sound keeps the beat (it can't lag), and the screen follows it frame by frame instead of falling behind when the phone is busy.",
      "The report card now sits properly above the app — blurred, dimmed background and a real shadow — and sending a report no longer leaves the app slightly zoomed in.",
    ],
  },
  {
    v: "1.17.0",
    date: "2026-07-24",
    size: "minor",
    title: "One-tap problem reports",
    notes: [
      "Reporting a problem is now one clean step: a proper in-app card (matching the rest of the app, not a browser popup) where you describe what went wrong and hit Send — it goes straight through, and you just get a thank-you. No copying, no share sheets.",
      "If there's no connection, the app falls back to letting you send the report manually, so nothing gets lost at the gym.",
    ],
  },
  {
    v: "1.16.2",
    date: "2026-07-24",
    size: "patch",
    title: "The count-up scales with your session",
    notes: [
      "The rising blips now match what you actually did: up to two dozen punches, every single one gets its own note — the riff IS your count. Bigger totals climb longer (a 100-punch session earns a proper drumroll, ~2 seconds), small ones stay quick, and the sound still runs on its own clock so nothing on screen can glitch it.",
    ],
  },
  {
    v: "1.16.1",
    date: "2026-07-24",
    size: "patch",
    title: "Footer breathing room",
    notes: [
      "\"Report a problem\" gets its own centred line under the version info instead of squeezing into the corner on phones.",
    ],
  },
  {
    v: "1.16.0",
    date: "2026-07-24",
    size: "minor",
    title: "Report a problem, straight from the app",
    notes: [
      "New \"Report a problem\" link in the footer: describe what went wrong in a sentence, and the report — including a technical log of your last session's sounds — goes out through your phone's share sheet. That log is what lets problems get diagnosed and fixed fast, exactly, instead of guessed at.",
      "The log records automatically in the background (it's tiny and costs nothing), so a problem can be reported after it happens — no setup needed. It also survives closing the app.",
    ],
  },
  {
    v: "1.15.0",
    date: "2026-07-24",
    size: "minor",
    title: "A new sound engine — precise, warm, self-healing",
    notes: [
      "Every bell, tick, warning and blip now plays through a precision audio engine that starts sounds within a couple of milliseconds, no matter how busy the phone is — and it still works with the silent switch on. The count-up riff is scheduled as one piece of music, so it physically cannot stutter.",
      "The phone's speaker is warmed up the moment you tap Start, so the first countdown ticks land on tempo instead of the \"5\" arriving late (the speaker used to wake up ~100ms slow).",
      "Fixed the vanishing \"slip\": one of its players got permanently stuck and silently swallowed the word — with a 2-second dead pause — every other time it appeared, eventually leaving only a robot voice. Stuck players are now detected, reset, and the word retries instantly on its twin.",
      "A corrupted cached sound can no longer blacklist a word for the day — the app now re-downloads a failing file fresh from the network, and this update refreshes every cached sound anyway.",
      "Combo cadence tightened: each word is rewound the moment it finishes, removing the occasional 50-80ms late start that made combos feel loose.",
      "Music apps get their audio back a few seconds after the finish celebration ends.",
    ],
  },
  {
    v: "1.14.1",
    date: "2026-07-23",
    size: "patch",
    title: "Smooth blips, steady ticks, no words into the bell",
    notes: [
      "The rising blips at the finish no longer glitch: their rhythm ran on the screen's drawing cycle, and a phone dropping frames mid-celebration dragged the sound with it. The riff now keeps its own time, and every blip starts from a freshly rewound sound.",
      "The 5-4-3-2-1 countdown clicks keep an even tempo — reused click sounds are rewound during quiet moments instead of at the instant they play.",
      "A combo can no longer start talking right before the bell: if there isn't room for at least its first word, the caller stays quiet and the bell lands clean.",
      "Sounds repaired after switching apps now include every sound, not just unused ones — found by matching the first real-phone audit log against how iPhones actually report a finished sound.",
      "The audit log now also records when each sound actually reached the speaker, and ends with a per-sound uniformity report — glitchy rhythm shows up as numbers now.",
      "Text on the app can no longer be selected/highlighted by long-pressing — it behaves like an app, not a web page. (The What's-new page stays selectable.)",
    ],
  },
  {
    v: "1.14.0",
    date: "2026-07-23",
    size: "minor",
    title: "A flight recorder, and a torture chamber for the sound",
    notes: [
      "The app can now record its own black-box log on a real phone: tap the version number below five times, run a session, then tap \"Copy audit log\" and send it in. Sound problems become an exact timeline instead of a memory.",
      "A new torture-test suite hammers the app with the misbehavior real iPhones produce — sound events arriving late, twice, or never — across hundreds of simulated sessions, and proves the words never overlap, repeat, or get cut off mid-round.",
      "That suite immediately earned its keep: it found (and we fixed) a lurking flaw where a late-arriving sound event could make a word play twice or cut the next one short — very likely a driver of the remaining rare stutter.",
    ],
  },
  {
    v: "1.13.3",
    date: "2026-07-23",
    size: "patch",
    title: "Stutter root cause, blips back, ripple stays centred",
    notes: [
      "The word stutter (\"p-pivot\", \"e-eight\") and the end bells striking double: when a sound is replayed, the phone rewinds it to the start by itself — and the app was issuing its own rewind at the same instant. The two raced, and you heard the start twice. The app now leaves the rewind to the phone. (Needs a real-phone session to call it closed.)",
      "The rising blips are back under the punch count. They had been moved onto a sound path the iPhone's silent switch mutes; they now play the same way as the bell and the voice, which the switch never touches.",
      "The finish ripple blooms only while the ring is at the centre of the screen — it no longer replays off to the side a moment after the numbers arrive.",
    ],
  },
  {
    v: "1.13.2",
    date: "2026-07-23",
    size: "patch",
    title: "Ghost words fixed, start truly seamless",
    notes: [
      "Fixed words collapsing to a ghost of themselves (\"six\" → \"s\", \"slip\" → \"lip\") — this morning's stutter fix backfired on real phones, so the voice is back on the proven pipeline. The old rare stutter may occasionally return until it can be diagnosed properly on a real device.",
      "The start is now one clean crossfade: the settings screen fades out and the countdown fades in — no more layout jumping partway and then sliding the rest.",
    ],
  },
  {
    v: "1.13.1",
    date: "2026-07-23",
    size: "patch",
    title: "A calmer start",
    notes: [
      "The start is one smooth motion again: the ring stays where it lives, \"Get ready\" stays on screen, the settings fold away gently, and the countdown begins only once the screen has settled — so the 5 always gets its full second.",
      "(This replaces the centre-stage countdown from v1.13.0, pulled on feedback the same day.)",
    ],
  },
  {
    v: "1.13.0",
    date: "2026-07-23",
    size: "minor",
    title: "A proper entrance, and the last stutter hunted",
    notes: [
      "Starting a session now has a real entrance: the ring drifts to the centre of the screen and grows, the countdown happens there — big, centre stage — and the bell glides it back as round 1 begins. No more \"5\" getting eaten while the screen sorts itself out.",
      "Found and fixed the likely cause of the rare word-stutter: a repeated word in one combo (like the 2s in the 10 combo) could reuse a clip that was still sitting at its end, forcing a last-instant rewind that iOS sometimes played over. Every clip now rewinds the moment it finishes.",
      "Tapping the screen mid-round can no longer trigger a burst of background audio work that could hiccup the word being spoken.",
    ],
  },
  {
    v: "1.12.0",
    date: "2026-07-23",
    size: "minor",
    title: "Know your session, never miss the bell",
    notes: [
      "The main screen now shows how long your whole session will take with your current settings — rounds plus rests — instead of a dead 00:00.",
      "Rest now warns you before it ends: the two-beep heads-up with 10 seconds left, then the same 3-2-1 ticks as the pre-round countdown — so the bell never catches you with your hands down.",
      "The \"Call combos out loud\" switch is gone. The voice is always on — it's the whole point of Combify — and the volume buttons cover the rest.",
    ],
  },
  {
    v: "1.11.8",
    date: "2026-07-23",
    size: "patch",
    title: "The stutter, hunted down",
    notes: [
      "Fixed words occasionally starting twice (\"t-two\", \"1-one\") — an interrupted callout could leave a clip parked mid-word, and its next use raced an audio seek. Every clip is now rewound the moment it's stopped.",
      "\"Get ready\" now clears the moment the round starts instead of lingering until the first call.",
      "Starting a session holds the 5 steady while the screen transitions, so the countdown never eats its first second.",
      "Bakr's combo is now announced as \"10 combo\", and the useless Reset button on the main screen is gone — Start has the room now.",
    ],
  },
  {
    v: "1.11.7",
    date: "2026-07-23",
    size: "patch",
    title: "The last of the stutters",
    notes: [
      "The countdown now starts on a perfectly clean beat — no more \"5... then rushing\" when starting or restarting.",
      "The glow behind the punch total now builds as the number climbs, peaks with the pop, and fades away naturally — without costing any smoothness.",
      "The countdown's expanding pulse can no longer silently go missing.",
    ],
  },
  {
    v: "1.11.6",
    date: "2026-07-23",
    size: "patch",
    title: "Version at a glance",
    notes: [
      "The version number and the What's new link now sit at the bottom of the main screen — no need to open About to find them.",
    ],
  },
  {
    v: "1.11.5",
    date: "2026-07-23",
    size: "patch",
    title: "Clean bells, calm starts",
    notes: [
      "The bell no longer fights the voice: the round-start bell rings clean before the first callout, and the end-of-round bell lands in silence instead of cutting a word off mid-syllable.",
      "After the bell, you now get a moment to get your hands up before the first combo is called.",
      "The glow is back on the punch total's pop — rebuilt so it stays smooth.",
    ],
  },
  {
    v: "1.11.4",
    date: "2026-07-23",
    size: "patch",
    title: "Smooth like butter",
    notes: [
      "Fixed the voice stuttering on Steady and Relaxed pace — a leftover timer could make two combo callouts talk over each other after leaving and returning to the app.",
      "The finish count-up was rebuilt for total smoothness: the circle glides, then the numbers count, each with the screen to itself — and the digits no longer nudge the layout as they climb.",
      "Count-up blips now use a jitter-free audio path, so the rising rhythm is even.",
      "Restarting a session no longer flashes through the settings screen — it restarts in place, instantly.",
    ],
  },
  {
    v: "1.11.3",
    date: "2026-07-23",
    size: "patch",
    title: "Leaner under the hood",
    notes: [
      "The app now does strictly nothing between timer ticks — screen updates only happen when something actually changed. Same look, less work for the phone.",
    ],
  },
  {
    v: "1.11.2",
    date: "2026-07-23",
    size: "patch",
    title: "Anti-lag",
    notes: [
      "Fixed the freeze-then-fast-forward at the start of the countdown when restarting, unpausing, or re-entering fullscreen — the heavy audio setup now happens once, not on every tap.",
      "The count-up no longer skips numbers under lag: every number arrives in order with its blip, just slightly later if the phone is busy.",
      "Blips, ticks and the landing hit respond noticeably quicker.",
    ],
  },
  {
    v: "1.11.1",
    date: "2026-07-23",
    size: "patch",
    title: "Count-up timing fixes",
    notes: [
      "Fixed the count-up blips playing early, before the numbers were even on screen.",
      "Every number you see now lands together with its own blip — sound and count move as one.",
    ],
  },
  {
    v: "1.11.0",
    date: "2026-07-23",
    size: "minor",
    title: "Hear your total climb",
    notes: [
      "The punch count now sounds like it feels: rising blips as your total climbs, and a solid landing hit when it arrives.",
      "The get-ready countdown is now 5 seconds instead of 3 — time to actually get your hands up.",
    ],
  },
  {
    v: "1.10.2",
    date: "2026-07-23",
    size: "patch",
    title: "Ten ways to say well done",
    notes: [
      "The finish screen now congratulates you differently each time — \"Strong finish.\", \"Round's yours.\", \"In the bank.\" and more — instead of the same \"Nice work.\" every session.",
    ],
  },
  {
    v: "1.10.1",
    date: "2026-07-23",
    size: "patch",
    title: "Every last pixel",
    notes: [
      "During a session the app now truly fills the phone — the strips at the notch and the bottom corners that stayed empty are used now.",
      "The timer and combo sit properly centred on the screen when the phone is on its side (they sat slightly left before).",
    ],
  },
  {
    v: "1.10.0",
    date: "2026-07-23",
    size: "minor",
    title: "A finish worth watching",
    notes: [
      "Finishing a session is now a moment: the timer circle holds the centre of the screen while the ripple plays, then drifts aside and your numbers slide in one by one — instead of everything appearing at once.",
      "The whole session stays fullscreen now, including the finish screen and while paused. A new exit button (next to pause and restart) is how you leave and get back to settings.",
      "The restart icon now restarts the session on the spot instead of dropping you back to the settings screen.",
    ],
  },
  {
    v: "1.9.2",
    date: "2026-07-23",
    size: "patch",
    title: "The bell is back",
    notes: [
      "The session now ends with the classic three bell strikes again — the victory jingle didn't feel right, and nothing says the fight's over like the bell.",
    ],
  },
  {
    v: "1.9.1",
    date: "2026-07-23",
    size: "patch",
    title: "A proper finish",
    notes: [
      "Finishing a session now plays a short victory jingle instead of three more bell rings — the bell keeps meaning \"round\", the jingle only ever means \"you did it\".",
      "Fixed the sound glitching or dying after you left the app mid-round and came back — the callouts now stop cleanly when you leave and pick up fresh when you return.",
    ],
  },
  {
    v: "1.9.0",
    date: "2026-07-23",
    size: "minor",
    title: "Make it an app",
    notes: [
      "Combify can now be put on your home screen properly: a real BWB logo icon, and it opens fullscreen with no browser bar at all — including on iPhone.",
      "The app offers this once: one tap on Android, and on iPhone it shows where Apple hid the option (Share → Add to Home Screen). Dismiss it and it won't ask again.",
      "Nothing changes if you'd rather keep using the link — it works the same as always.",
    ],
  },
  {
    v: "1.8.3",
    date: "2026-07-23",
    size: "patch",
    title: "The bell fix, actually working on iPhone",
    notes: [
      "The previous update's bell fix worked everywhere except the phones it was for: iPhones never told the app the bell file had loaded, so it kept using the old muted route. The app now assumes its own sound files are there.",
    ],
  },
  {
    v: "1.8.2",
    date: "2026-07-23",
    size: "patch",
    title: "Bells you can actually hear",
    notes: [
      "The bell, countdown ticks and 10-second warning now play even with your iPhone's silent switch on — they were muted along with it before, while the voice kept going.",
      "All sounds now work offline in the installed app; previously an offline session ran completely silent.",
      "The end-of-session bell rings all three strikes cleanly instead of cutting itself off.",
    ],
  },
  {
    v: "1.8.1",
    date: "2026-07-23",
    size: "patch",
    title: "Sound that doesn't drop out",
    notes: [
      "Fixed the countdown beeps sometimes not playing at all when you pressed Start.",
      "Fixed all sound going dead for the rest of a session after your phone locked, a call came in, or you switched apps — it now comes back the moment you return.",
      "If one voice clip ever fails to load, only that word falls back to the phone's voice instead of the whole app switching over.",
    ],
  },
  {
    v: "1.8.0",
    date: "2026-07-23",
    size: "minor",
    title: "This page",
    notes: [
      "Added this list of updates, so you can see what changed and when. It's linked from About at the bottom of the app.",
      "If one of these changes made something worse, note the version next to it — going back is easy.",
    ],
  },
  {
    v: "1.7.1",
    date: "2026-07-23",
    size: "patch",
    title: "The screen follows the voice",
    notes: [
      "The move being called now lights up as you hear it, so you can glance down mid-combo and see exactly where you are.",
      "The 3-2-1 countdown circle moves smoothly between each second again instead of jumping.",
    ],
  },
  {
    v: "1.7.0",
    date: "2026-07-23",
    size: "patch",
    title: "Fullscreen fixes",
    notes: [
      "Fixed Resume doing nothing if you paused during the 3-2-1.",
      "The celebration ring at the end now comes out of the timer circle properly instead of off to one side.",
      "Finishing a session or hitting Reset no longer kicks you out of fullscreen.",
    ],
  },
  {
    v: "1.6.0",
    date: "2026-07-23",
    size: "minor",
    title: "True fullscreen training",
    notes: [
      "Starting a session now takes over the whole screen, so there's no browser bar while you train.",
      "Pause and Reset became small icons in the corner, giving the combo more room.",
      "The countdown pulses so you know the round is about to start.",
    ],
  },
  {
    v: "1.5.1",
    date: "2026-07-22",
    size: "patch",
    title: "Smoother timer",
    notes: [
      "The timer ring now drains smoothly instead of ticking once a second.",
      "Fixed the clock spilling out of its circle when the phone was on its side.",
    ],
  },
  {
    v: "1.5.0",
    date: "2026-07-22",
    size: "minor",
    title: "A proper look",
    notes: [
      "Added the ring around the clock that empties as the round runs down.",
      "Long combos now wrap neatly and scale to fit any screen.",
      "Rebuilt the finish screen around your punch total.",
    ],
  },
  {
    v: "1.4.0",
    date: "2026-07-22",
    size: "minor",
    title: "Focus mode",
    notes: [
      "While a session runs, everything but the combo folds away so it can be read from across the room.",
      "Proper layouts for holding the phone upright, on its side, or using a laptop.",
    ],
  },
  {
    v: "1.3.1",
    date: "2026-07-22",
    size: "patch",
    title: "Flame from day one",
    notes: [
      "The streak flame now shows from your very first session instead of waiting.",
      "Confirmed with Bakr that 7 and 8 mean body shots.",
    ],
  },
  {
    v: "1.3.0",
    date: "2026-07-22",
    size: "minor",
    title: "Bakr's 10 combo",
    notes: [
      "Added Bakr's \"10 combo\" and it's announced by name on screen.",
      "The finish screen counts your punches up and shows a flame for your streak.",
    ],
  },
  {
    v: "1.2.1",
    date: "2026-07-22",
    size: "patch",
    title: "Quicker setup",
    notes: [
      "Hold the + or - buttons to run the number up or down instead of tapping repeatedly.",
    ],
  },
  {
    v: "1.2.0",
    date: "2026-07-22",
    size: "minor",
    title: "Streaks",
    notes: [
      "Your rounds, punches and days in a row are now saved on your phone.",
      "The finish screen tells you what you just did, not just \"nice work\".",
    ],
  },
  {
    v: "1.1.0",
    date: "2026-07-22",
    size: "patch",
    title: "Version shown in About",
    notes: [
      "The app now shows which build it's running, so you can tell whether your phone has the latest one.",
    ],
  },
  // ---- Before version numbers existed (the first two days) ----
  {
    v: null,
    date: "2026-07-22",
    size: "minor",
    title: "A real voice",
    notes: [
      "Combos are now called out in a real recorded voice instead of the robotic one built into the phone.",
    ],
  },
  {
    v: null,
    date: "2026-07-22",
    size: "patch",
    title: "Fixes from Bakr's testing",
    notes: [
      "The callouts no longer go silent partway through a round.",
      "The timer keeps proper time if you switch to another app mid-round.",
      "The bell works again, and the screen stays awake while you train.",
      "Tapping + and - no longer zooms the page on an iPhone.",
    ],
  },
  {
    v: null,
    date: "2026-07-22",
    size: "patch",
    title: "Better variety, simpler setup",
    notes: [
      "The same combo can't come up twice in a row any more.",
      "Your settings are remembered between visits.",
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
