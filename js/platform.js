// platform.js — what device and browser is this, and what does "install it"
// actually mean here?
//
// WHY THIS EXISTS. Adding Combify to the home screen is the only way to lose
// the browser's address bar on a phone, and the app used to give everyone on
// iOS the same instruction: "tap Share, then Add to Home Screen". That
// instruction is impossible to follow in Chrome on iPhone — Apple only gives
// the real install path to Safari — so anyone who opened the link from
// Google, Instagram or a text message was being told to do something their
// browser cannot do. They aren't confused; they're stuck.
//
// So detection has to answer three separate questions, not one:
//   1. Is installing even worth asking about?  (no, on a computer)
//   2. Which steps are the TRUE steps here?    (Safari vs Chrome vs Android)
//   3. Can we skip the steps entirely?         (Android fires a real prompt)
//
// Deliberately UA-based. Feature detection is the better habit in general, but
// there is no feature to detect for "this browser has an Add to Home Screen
// item buried in its share sheet" — the platforms simply don't expose it.

// Read fresh on every call rather than once at import. Two reasons: a module
// is evaluated once per page but the answers are cheap to recompute, and
// caching them makes the module untestable — the test harness boots many
// simulated devices against one loaded copy of this file, and a UA captured at
// import time would answer every one of them with the first device's answer.
// ---------- Developer override ----------
// The panel in js/dev.js can pin the answers to a device the founder is not
// holding, so all five install cards can be reviewed from one laptop instead
// of borrowing an iPhone, an iPad and an Android phone. Gated twice: the key
// is only ever written by the dev panel, AND dev mode itself must be on, so a
// member cannot end up pinned to somebody else's platform.
const OVERRIDES = {
  "ios-safari":  { device: "phone",   os: "ios",     browser: "safari",    tablet: false },
  "ios-other":   { device: "phone",   os: "ios",     browser: "ios-other", tablet: false },
  "ipad":        { device: "tablet",  os: "ios",     browser: "safari",    tablet: true },
  "android":     { device: "phone",   os: "android", browser: "chromium",  tablet: false },
  "desktop":     { device: "desktop", os: "desktop", browser: "desktop",   tablet: false },
};
export const OVERRIDE_NAMES = Object.keys(OVERRIDES);

function overrideEnv() {
  try {
    if (localStorage.getItem("combify.dev") !== "1") return null;
    return OVERRIDES[localStorage.getItem("combify.dev.platform")] || null;
  } catch (e) { return null; }
}

// Whether the dev panel is pretending the browser handed us a one-tap install
// prompt — the one branch that cannot be reached by faking a user-agent.
export function devForcesPrompt() {
  try {
    return localStorage.getItem("combify.dev") === "1"
      && localStorage.getItem("combify.dev.prompt") === "1";
  } catch (e) { return false; }
}

function read() {
  const forced = overrideEnv();
  if (forced) return forced;
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  const touchPoints = (typeof navigator !== "undefined" && navigator.maxTouchPoints) || 0;

  // iPadOS 13+ deliberately lies and calls itself "Macintosh" so sites serve
  // it the desktop layout. Touch points are what give it away — a real Mac
  // reports 0. Without this test every iPad is treated as a computer and never
  // offered the install it would genuinely benefit from.
  const isIPadOS = /Macintosh/.test(ua) && touchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || isIPadOS;
  const android = /Android/.test(ua);

  // Tablet vs phone changes ONE thing that matters: where Safari's share
  // button is. On iPhone the toolbar sits at the bottom of the screen; on iPad
  // it is up in the top bar. Pointing someone at the wrong end of their screen
  // is the same failure as giving them the wrong steps.
  const tablet = isIPadOS || /iPad/.test(ua) || (android && !/Mobile/.test(ua));

  // Every iOS browser is WebKit underneath, so they all say "Safari" somewhere
  // in the UA. The only reliable signal is each wrapper's own token — CriOS is
  // Chrome, FxiOS Firefox, EdgiOS Edge, OPiOS/OPT Opera. If none are present
  // it really is Safari.
  const browser = ios
    ? (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(ua) ? "ios-other" : "safari")
    : android
      ? (/SamsungBrowser/.test(ua) ? "samsung" : /Firefox/.test(ua) ? "firefox" : "chromium")
      : "desktop";

  return {
    // Anything that isn't a touch platform we know by name is a computer, and
    // that includes Windows touch laptops — they have a keyboard, a real
    // window, and no home screen to add anything to.
    device: ios || android ? (tablet ? "tablet" : "phone") : "desktop",
    os: ios ? "ios" : android ? "android" : "desktop",
    browser,
    tablet,
  };
}

export function deviceOS() { return read().os; }
export function deviceClass() { return read().device; }
export function deviceBrowser() { return read().browser; }

// Can this device meaningfully put Combify on a home screen at all? A computer
// cannot, so it is never asked — that ask is pure noise on a laptop, and the
// browser tab there is already a perfectly good way to use the app.
export function canInstall() { return read().device !== "desktop"; }

// True when the app is already running from the home screen — no bar, no
// tabs. Nothing about installing should ever be shown to these people; they
// have already done it. Read live rather than cached: an installed app and a
// browser tab are the same code, and only this call tells them apart.
export function isStandalone() {
  try {
    return (typeof window !== "undefined" && window.matchMedia
        && window.matchMedia("(display-mode: standalone)").matches)
      || (typeof navigator !== "undefined" && navigator.standalone === true); // old-iOS spelling
  } catch (e) { return false; }
}

// ---------- The instructions themselves ----------
// Each returns a plain object the UI renders; no DOM, no styling decisions
// here. `steps` entries may contain the literal token {share}, which the UI
// swaps for the drawn Share glyph — naming that icon in words is exactly the
// instruction people fail to follow, because almost nobody has consciously
// looked at it.
//
// `action` is what the one button does:
//   "prompt" — the browser gave us a real install prompt to fire
//   "copy"   — wrong browser on iOS; copy the link so Safari can be opened
//   null     — nothing to automate, the steps are the whole answer
export function installGuide(hasPrompt) {
  const env = read();
  const WHERE = env.tablet ? "(top of Safari)" : "(bottom of Safari)";
  // Android and desktop Chromium hand us a real prompt when the app qualifies.
  // One tap beats any instruction we could write, so it always wins.
  if (hasPrompt) {
    return {
      mode: "prompt",
      sub: "Opens fullscreen, works offline.",
      steps: [],
      action: "prompt",
      actionLabel: "Add to home screen",
    };
  }
  if (env.os === "ios" && env.browser === "safari") {
    return {
      mode: "ios-safari",
      sub: "One time. Then it opens fullscreen — no address bar — and works offline.",
      steps: [
        `Tap {share} <strong>Share</strong> ${WHERE}`,
        "Scroll down, tap <strong>Add to Home Screen</strong>",
        "Tap <strong>Add</strong>",
      ],
      action: null,
      actionLabel: null,
    };
  }
  // THE CASE THAT WAS BROKEN. Chrome/Firefox/Edge on iPhone cannot install
  // anything: Apple exposes the home-screen path to Safari alone. Telling
  // these members to "tap Share" sends them hunting for a menu item that does
  // not exist in their browser. The only honest instruction is to move them to
  // Safari first, and the least annoying way to do that is to hand them the
  // link on their clipboard so there is nothing to type.
  if (env.os === "ios") {
    return {
      mode: "ios-wrong-browser",
      sub: "Only Safari can add apps to an iPhone home screen. Takes three taps once you're there.",
      steps: [
        "Tap <strong>Open in Safari</strong> below",
        `Tap {share} <strong>Share</strong> ${WHERE}`,
        "Scroll down, tap <strong>Add to Home Screen</strong>",
      ],
      action: "copy",
      actionLabel: "Open in Safari",
    };
  }
  // Android without a prompt event: Firefox, or Chrome that hasn't decided the
  // app qualifies yet. The menu is where it lives in all of them; the wording
  // on the item differs by browser, hence both names.
  if (env.os === "android") {
    return {
      mode: "android-manual",
      sub: "Opens fullscreen, works offline.",
      steps: [
        "Open the browser menu (<strong>⋮</strong>, top right)",
        "Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>",
      ],
      action: null,
      actionLabel: null,
    };
  }
  // Desktop. canInstall() is false so this is never shown; returned only so
  // every caller gets a well-formed object instead of null to guard against.
  return { mode: "none", sub: "", steps: [], action: null, actionLabel: null };
}

// One short token for the usage ping, so the daily digest can say which
// platforms members are actually training on. No UA string is ever sent —
// that is close enough to a fingerprint to be worth avoiding, and the digest
// only needs the shape of the device.
export function platformTag() {
  const env = read();
  return `${env.os}-${env.device}${isStandalone() ? "-app" : ""}`;
}
