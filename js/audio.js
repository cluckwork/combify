// audio.js — everything Combify plays out loud: the shared audio context, the
// bell/tick/warning/count-up sound effects, and the voice that calls combos.
//
// Split out of app.js once the audio system grew to half the file. The rules
// that made it reliable are unchanged and documented inline — in particular:
// voice playback stays cloned-HTMLAudioElement (see the note above CLIP_DIR),
// and every synthesized sound goes through withAudio().
//
// The interface app.js uses:
//   configureVoice(hooks)  — wire in the bits of app state the voice chain
//                            needs (is the round still running, time left,
//                            pace-derived word gap, per-word highlight)
//   speakCombo(combo, onDone) / stopVoice()
//   ringBell(n), playTick(), playWarning(), playBlip(p), playLand()
//   armAudio(), unlockAudioForMobile(), markNeedsReprime()

import { MOVES, comboToSpeech } from "./combos.js";
import { audit } from "./audit.js";

// ---------- Hooks into app state ----------
// The voice chain must stop the instant the round does, and refuses to start a
// word into the bell — both need live app state. app.js provides it here so
// this module never reaches into the timer's internals.
let hooks = {
  stillInWork: () => true,   // is a work round still running?
  msLeftInPhase: () => Infinity, // ms until the current phase ends
  wordGap: () => 150,        // pace-derived gap between words in a combo
  onWord: () => {},          // called with the index of the move being spoken
};
export function configureVoice(h) { hooks = { ...hooks, ...h }; }

// ---------- Shared audio context (bell + voice clips both use this) ----------
//
// EVERY synthesized sound goes through withAudio(). Nothing may call
// ctx.createOscillator() directly, because an AudioContext does not stay
// running by itself: the OS suspends it whenever the phone locks, a call
// arrives, another app takes audio focus, or the tab is backgrounded. It used
// to be resumed in exactly one place — inside start() — so after any of those
// interruptions the ticks, bells and warnings were silent for the REST OF THE
// SESSION with nothing to bring them back.
//
// The second half of that bug: resume() is asynchronous. start() called it and
// then immediately played the first countdown tick, which got scheduled against
// a context that was still suspended, so the tick was simply lost. That is why
// the countdown sometimes "never started firing".
let audioCtx = null;
function getAudioCtx() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = audioCtx || new Ctor();
    return audioCtx;
  } catch (e) { return null; }
}

// Nudge the context back to running. Safe to call as often as you like — from a
// tap, on visibilitychange, before any sound. Never throws.
export function armAudio() {
  const ctx = getAudioCtx();
  if (!ctx || ctx.state === "running") return ctx;
  try {
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
  return ctx;
}

// Play something through the audio context, guaranteeing it is running first.
// If the context is suspended we resume and play when it actually starts, so a
// sound arrives a few milliseconds late instead of never arriving at all.
function withAudio(play) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const go = () => { try { play(ctx); } catch (e) {} };
  if (ctx.state === "running") { go(); return; }
  try {
    const p = ctx.resume();
    if (p && p.then) p.then(go, go); // play even if resume() reports failure
    else go();
  } catch (e) { go(); }
}

// Re-arm on every plausible "the user is back" signal. A suspended context can
// only be resumed from a user gesture on some browsers, so any tap anywhere
// counts — this is why it listens on the document in the capture phase rather
// than on the buttons. (app.js additionally calls markNeedsReprime() when the
// tab is hidden — backgrounding is the one event after which iOS may have
// revoked the element unlock.)
document.addEventListener("pointerdown", () => { armAudio(); deepPrime(); }, { capture: true, passive: true });
document.addEventListener("touchstart", armAudio, { capture: true, passive: true });

// ---------- Sound effects: real samples first, synthesis as fallback ----------
// The bell, tick and warning are all shipped as real audio files
// (audio/sfx/*.mp3, rendered from the exact synthesis below) and played
// through the same primed-HTMLAudioElement pipeline as the voice clips. This
// is not a cosmetic choice: on iPhone, Web Audio output is MUTED by the
// ring/silent switch while media elements are not — so with the switch on
// silent (most phones, most of the time) the voice clips played and every
// synthesized bell and tick was dead silence. The synthesis stays as the
// fallback so a missing or unloadable file still makes a sound.
// Samples default ON — the files are committed to the repo — and a sample only
// turns off on an actual load error. This mirrors the voice clips, and for the
// same hard-won reason (see the note above `voice` below): mobile Safari
// frequently never fires canplaythrough/loadeddata for preloaded audio, so an
// off-until-proven flag stays off forever on exactly the phones that need the
// sample most. That mistake shipped once here: the flags defaulted to false,
// iOS never delivered the "proof", every bell fell back to the synth, and the
// synth is muted by the silent switch — "bells still don't work" while the
// voice played fine. Off-until-proven was only right in the era when
// audio/sfx/ had no files at all.
const SFX_DIR = "audio/sfx/";
// tick/blip/land are WAV, not MP3: LAME padding puts ~50ms of silence at the
// front of an MP3, and at a 0.7x pitch bend that stretches longer — every blip
// landed audibly late ("the blips lag"). PCM has zero decoder delay and
// sample-exact seeks. The long sounds stay MP3; 50ms on a bell is invisible.
const SFX_FILES = { bell: "bell.mp3", tick: "tick.wav", warning: "warning.mp3", blip: "blip.wav", land: "land.wav" };
const SFX_KEYS = Object.keys(SFX_FILES);
const sfxCache = {};
const sfx = { bell: true, tick: true, warning: true, blip: true, land: true };
function preloadSfx() {
  SFX_KEYS.forEach((key) => {
    const a = new Audio(SFX_DIR + SFX_FILES[key]);
    a.preload = "auto";
    sfxCache[key] = a;
    a.addEventListener("error", () => { sfx[key] = false; }, { once: true });
  });
}
preloadSfx();

// A synthetic reverb "room" — an algorithmically generated impulse response
// (exponentially decaying noise) fed through a ConvolverNode. This is what
// gives the bell an actual reverberating tail (reflections), on top of the
// tone's own long decay. Built once per AudioContext and reused.
let reverbNode = null;
function getReverb(ctx) {
  if (reverbNode) return reverbNode;
  const duration = 2.2, decayPower = 2.5;
  const length = Math.floor(ctx.sampleRate * duration);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decayPower);
    }
  }
  reverbNode = ctx.createConvolver();
  reverbNode.buffer = impulse;
  return reverbNode;
}

// Synthesized fallback tone — an FM "bell" (carrier + inharmonic modulator,
// the classic Chowning technique), not a plain sine wave. The modulation
// depth decays fast (bright clang settling into a purer ring) while the
// output decays slow (long natural ring-out), which is what makes it read
// as a struck metal bell instead of a beep. A parallel reverb send adds the
// reflected "in a room" tail on top of the tone's own decay.
function bellStrike(ctx, t) {
  const carrierFreq = 600;   // a bright, mid-pitched brass bell — not a tiny jingle-bell tinkle
  const modFreq = carrierFreq * 1.4; // inharmonic ratio is what makes it sound metallic, not musical

  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.setValueAtTime(carrierFreq, t);

  const modulator = ctx.createOscillator();
  modulator.type = "sine";
  modulator.frequency.setValueAtTime(modFreq, t);

  const modGain = ctx.createGain(); // modulation depth in Hz — starts wide (clang), narrows (settles)
  modGain.gain.setValueAtTime(carrierFreq * 3, t);
  modGain.gain.exponentialRampToValueAtTime(carrierFreq * 0.15, t + 0.8);
  modulator.connect(modGain).connect(carrier.frequency);

  const outGain = ctx.createGain(); // sharp strike, long ring-out
  outGain.gain.setValueAtTime(0.0001, t);
  outGain.gain.exponentialRampToValueAtTime(0.6, t + 0.008);
  outGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  carrier.connect(outGain);
  outGain.connect(ctx.destination); // dry signal

  const wetGain = ctx.createGain(); // reverb send level
  wetGain.gain.setValueAtTime(0.55, t);
  outGain.connect(getReverb(ctx)).connect(wetGain).connect(ctx.destination);

  modulator.start(t); carrier.start(t);
  modulator.stop(t + 2.5); carrier.stop(t + 2.5);
}
function synthBell(times = 1) {
  withAudio((ctx) => {
    for (let i = 0; i < times; i++) bellStrike(ctx, ctx.currentTime + i * 0.65);
  });
}

// Play one sfx sample, or run its synth fallback. A play() rejection runs the
// fallback for THIS sound but doesn't disable the sample — a one-off rejection
// (momentary focus loss) shouldn't cost the whole session its real bell.
function playSfx(key, fallback, rate = 1) {
  if (!sfx[key]) { fallback(); return; }
  const node = getPooledSfx(key);
  if (!node) { fallback(); return; }
  // Rewind only an element genuinely left mid-file (a missed park site). An
  // element that ENDED on its own needs no seek from us — play() rewinds to
  // the start itself, as part of the spec'd play algorithm. Issuing our own
  // currentTime=0 on top of that was a SECOND async seek racing the internal
  // one: attack, jump, attack again — the end bells striking double on their
  // 2nd/3rd ring (those reuse pool elements sitting at end position; a
  // freshly-primed element plays clean, which is why the first strike mostly
  // didn't). NOT fixed by parking on "ended" — v1.13.0 tried that and iOS's
  // stale/late event delivery seeked elements mid-use: ghost words.
  try { audit("sfx", `${key}${rate !== 1 ? " r=" + rate.toFixed(2) : ""} ct=${node.currentTime.toFixed(2)}${node.ended ? " ended" : ""}${node.paused ? "" : " PLAYING"}`); } catch (e) {}
  try { if (!node.ended && node.currentTime > 0.05) node.currentTime = 0; } catch (e) {}
  // playbackRate with preservesPitch off is a pitch bend — one blip file
  // becomes the whole rising scale of the count-up.
  try {
    node.preservesPitch = false;
    node.webkitPreservesPitch = false;
    node.playbackRate = rate;
  } catch (e) {}
  const p = node.play();
  if (p && p.catch) p.catch(() => { audit("sfx:reject", key); fallback(); });
}

// Ring the bell `times` in a row (1 = round start, 3 = session over).
export function ringBell(times = 1) {
  const gap = 650; // ms between successive strikes — a natural "ding-ding" rhythm
  for (let i = 0; i < times; i++) {
    setTimeout(() => playSfx("bell", () => synthBell(1)), i * gap);
  }
}

// Short dry tick for the pre-round "3, 2, 1" countdown — deliberately NOT
// bell-like, so it can never be mistaken for "go."
function synthTick() {
  withAudio((ctx) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "square"; osc.frequency.setValueAtTime(1500, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.07);
  });
}
export function playTick() { playSfx("tick", synthTick); }

// Two-beep "10 seconds left" cue — distinct from both the tick and the bell.
function synthWarning() {
  withAudio((ctx) => {
    for (let i = 0; i < 2; i++) {
      const t = ctx.currentTime + i * 0.18;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "triangle"; osc.frequency.setValueAtTime(1100, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.65, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.15);
    }
  });
}
export function playWarning() { playSfx("warning", synthWarning); }

// Count-up sounds: rising blips while the punch total climbs, and a landing
// hit when it arrives.
function synthBlip(rate) {
  withAudio((ctx) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(1000 * rate, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.06);
  });
}
// Blips ride the same media-element pipeline as every other sound. A Web
// Audio decoded-buffer path was tried here (v1.12-v1.13) for sample-accurate
// starts — but Web Audio is muted by the iPhone ring/silent switch while
// media elements are not, so on most phones the entire count-up went silent:
// "the rising blips are completely gone". The same lesson the bells already
// taught (see the note above SFX_DIR), relearned once more. The blip stays a
// WAV, so the only jitter left is HTMLAudio scheduling (~10-40ms), and at the
// count-up's 50ms+ step spacing audible-but-loose beats sample-accurate
// silence.
export function playBlip(progress) {
  const rate = 0.7 + progress * 1.1; // ~0.7x → 1.8x: a clear low-to-high climb
  playSfx("blip", () => synthBlip(rate), rate);
}
function synthLand() {
  withAudio((ctx) => {
    const t = ctx.currentTime;
    const thump = ctx.createOscillator(), tg = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(180, t);
    thump.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.7, t + 0.006);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    thump.connect(tg).connect(ctx.destination);
    thump.start(t); thump.stop(t + 0.4);
    const ping = ctx.createOscillator(), pg = ctx.createGain();
    ping.type = "sine"; ping.frequency.setValueAtTime(1568, t + 0.02);
    pg.gain.setValueAtTime(0.0001, t + 0.02);
    pg.gain.exponentialRampToValueAtTime(0.3, t + 0.025);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    ping.connect(pg).connect(ctx.destination);
    ping.start(t + 0.02); ping.stop(t + 0.5);
  });
}
export function playLand() { playSfx("land", synthLand); }

// ---------- Voice ----------
// The app calls combos two ways, in order of preference:
//   1. Audio CLIPS in the /audio folder — one short file per move (audio/1.mp3,
//      audio/slip.mp3, ...). Generate these once with your ElevenLabs voice and
//      the app chains them into any combo. This is the good-sounding path.
//      See audio/README.md for the exact file list.
//   2. The browser's built-in TEXT-TO-SPEECH as a fallback, used automatically
//      when the clips aren't present (e.g. before you've added them).

// -- Clip playback (HTMLAudioElement) --
// One cached <audio> per word; each combo clones a fresh element to play so
// repeated/rapid words never fight over one element's state. This is the
// original approach that worked — its only past failure was silent source
// files, now fixed. (A reuse-with-unlock variant and a Web Audio variant were
// both tried and broke playback, so we're back to this.)
const CLIP_DIR = "audio/";
const CLIP_EXT = ".mp3"; // match whatever your voice tool exports
const CLIP_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "slip", "roll", "block", "pivot"];
const clipCache = {};
// Assume the clip set is present (it's committed to the repo) and only fall
// back to TTS on an actual load error. Waiting for "canplaythrough" (the old
// approach) left phones stuck: mobile Safari frequently never fires it for
// preloaded audio, so useClips stayed false and every combo fell through to
// browser text-to-speech — whose "onend" also frequently never fires on iOS,
// so combos only advanced via the 10s safety timeout in speakCombo(). That's
// the "silent + 10-20 seconds per combo" bug on phones.
const voice = { useClips: true, current: null };

// Clips that failed to load. ONE bad file used to switch the whole app to
// robotic text-to-speech for the rest of the session — a single flaky request
// for, say, audio/7.mp3 cost you all twelve voices. Now a failure is recorded
// per word: that word alone falls back (see playWord), and clips are only
// abandoned wholesale when enough have failed that the set is clearly not
// there at all, which is the case this fallback actually exists for.
const failedClips = new Set();
const CLIPS_GIVE_UP_AT = 4;
function preloadClips() {
  CLIP_KEYS.forEach((key) => {
    const a = new Audio(CLIP_DIR + key + CLIP_EXT);
    a.preload = "auto";
    clipCache[key] = a;
    a.addEventListener("error", () => {
      failedClips.add(key);
      if (failedClips.size >= CLIPS_GIVE_UP_AT) voice.useClips = false;
    }, { once: true });
    // A file that later loads fine clears its own black mark, so one bad
    // moment on a phone's connection isn't permanent.
    a.addEventListener("canplaythrough", () => failedClips.delete(key), { once: true });
  });
}
preloadClips();

// -- Mobile unlock pool --
// iOS (and some Android WebViews) only allow an <audio> element to play
// programmatically if THAT SPECIFIC element already had .play() called on it
// from inside a real tap. Cloning a fresh element later (inside a setTimeout,
// as combos are called during a round) makes a brand-new element that was
// never touched by a tap, so iOS silently blocks it. Desktop has no such
// restriction, which is why this only ever showed up on phones.
// Fix: at Start-tap time, pre-create a small pool of clones per word (and for
// the bell) and "prime" each one with a play()+pause() inside the gesture.
// Playback later reuses those primed elements round-robin instead of cloning
// fresh ones — same cloned-HTMLAudioElement architecture, just created (and
// unlocked) at the right time.
// 2 per word, not 3: combo playback is strictly sequential (each word waits for
// the previous to end), so a word never needs more than one spare. Holding
// dozens of live <audio> elements makes iOS drop media events, which is what
// killed the chain mid-round.
const UNLOCK_POOL_SIZE = 2;
// The bell is the exception: the session-end "ding-ding-ding" is three strikes
// 650ms apart on a sample that rings for ~2.5s, so three are genuinely sounding
// at once. With two elements the third strike stole the first one's element and
// cut its ring dead.
// blip gets 3: the count-up fires them ~60ms apart while each rings ~70ms.
const SFX_POOL_SIZE = { bell: 3, tick: 2, warning: 2, blip: 3, land: 1 };
const clipPool = {};
const sfxPool = {};
const poolIndex = {};
let audioUnlocked = false;
// Set when the app is backgrounded: the only event after which iOS may have
// revoked the element unlock. Anything else makes re-priming pure waste.
let needsReprime = false;
export function markNeedsReprime() { needsReprime = true; }

function primeElement(a) {
  if (!a || a.paused === false) return; // never pause something mid-sound
  a.muted = true;
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
  a.pause();
  // Park at 0 — but only when displaced. An element left mid-word (a paused
  // round, a cut) MUST be rewound: currentTime assignment is an async seek on
  // iOS, and seeking lazily at play time raced playback — the start of the
  // word from the old position, an audible jump, the word again: "t-two".
  // Rewinding here (and at every pause site) lets seeks land during idle
  // time. Skipping already-parked elements keeps the tap cheap.
  try { if (a.currentTime > 0.05) a.currentTime = 0; } catch (e) {}
  a.muted = false;
}

// Anti-lag priming. Playing ~35 muted elements synchronously inside the Start
// tap froze the screen for a beat — and the timer's real-time catch-up then
// FAST-FORWARDED the countdown to make up the lost time. So priming is now
// tiered:
//   - the tap that needs it primes ONE element per sound (enough to unlock
//     the pipeline on iOS — 17 quick plays, half the old burst),
//   - the spare pool slots are topped up on the NEXT tap anywhere (any tap is
//     a gesture; the capture-phase listener above picks it up), and until
//     then a blocked spare is absorbed by the playback layer's retry, which
//     round-robins back onto the primed element.
//   - starts that need nothing (already unlocked, never backgrounded) are a
//     free no-op, and backgrounding only costs the 17-play repair once.
let deepPrimePending = false;
function eachPool(fn) {
  CLIP_KEYS.forEach((key) => {
    const pool = clipPool[key] && clipPool[key].length
      ? clipPool[key]
      : (clipCache[key] ? [clipCache[key]] : []);
    while (pool.length < UNLOCK_POOL_SIZE) pool.push(new Audio(CLIP_DIR + key + CLIP_EXT));
    clipPool[key] = pool;
    fn(pool);
  });
  SFX_KEYS.forEach((key) => {
    if (!sfx[key]) return;
    const pool = sfxPool[key] && sfxPool[key].length
      ? sfxPool[key]
      : (sfxCache[key] ? [sfxCache[key]] : []);
    while (pool.length < SFX_POOL_SIZE[key]) pool.push(new Audio(SFX_DIR + SFX_FILES[key]));
    sfxPool[key] = pool;
    fn(pool);
  });
}
export function unlockAudioForMobile() {
  if (audioUnlocked && !needsReprime) return;
  audit("audio:prime", needsReprime ? "reprime" : "first");
  try {
    eachPool((pool) => primeElement(pool[0]));
    deepPrimePending = true;
    audioUnlocked = true;
    needsReprime = false;
  } catch (e) { /* retry on the next tap */ }
}
// Top up the spare slots inside a later gesture, spreading the cost away from
// the Start tap. One shot per pending request.
function deepPrime() {
  if (!deepPrimePending) return;
  audit("audio:deepPrime");
  deepPrimePending = false;
  try {
    eachPool((pool) => { for (let i = 1; i < pool.length; i++) primeElement(pool[i]); });
  } catch (e) { deepPrimePending = true; }
}

// Round-robin a primed element for `key`, falling back to a plain clone if
// the pool isn't ready yet (e.g. the very first sound before Start was tapped).
function getPooledClip(key) {
  // A word whose file is known bad has a pool like any other — the elements
  // exist, they just have nothing to play. Returning null here is what routes
  // it to the spoken fallback instead of burning a retry on silence.
  if (failedClips.has(key)) return null;
  const pool = clipPool[key];
  if (!pool || !pool.length) {
    const src = clipCache[key];
    return src ? src.cloneNode() : null;
  }
  const i = (poolIndex[key] || 0) % pool.length;
  poolIndex[key] = i + 1;
  return pool[i];
}
function getPooledSfx(key) {
  const pool = sfxPool[key];
  if (!pool || !pool.length) return sfxCache[key] ? sfxCache[key].cloneNode() : null;
  const i = (poolIndex["__sfx_" + key] || 0) % pool.length;
  poolIndex["__sfx_" + key] = i + 1;
  return pool[i];
}

// Timers owned by the voice chain. stopVoice() clears them all — an anonymous,
// unowned timer here was once a zombie that interleaved two chains.
let clipWatchdog = null;
let wordGapTimer = null;
let ttsFallback = null;

// Play a combo's clips one after another, then call onDone().
//
// Every step is guarded by a watchdog timer. Previously the chain advanced ONLY
// on the "ended" event, so if iOS dropped a single one (it does this on reused
// elements) playNext() was never called again, onDone() never fired, and
// nextCombo() never rescheduled — the combo loop died permanently for the rest
// of the round. That's the "sound stops after a few combos" bug. Now a missing
// event just means we advance slightly late instead of stopping forever.
// Every live playback chain carries a generation token. stopVoice bumps
// it, which instantly deadens EVERY pending callback of the old chain — gap
// timers, watchdogs, late "ended" events. Before this, the between-words
// setTimeout was anonymous and unowned: a chain cut landing inside a word gap
// (backgrounding, the visibility restart, a revive) left a zombie timer that
// revived the OLD combo next to the new one — two chains interleaving through
// the same pools, heard as the voice stuttering. The gap windows are 3-6x
// wider at Steady/Relaxed pace, which is why it showed there.
let voiceChain = 0;
function playClips(keys, onDone) {
  let i = 0;
  const chain = ++voiceChain;
  const chainAlive = () => chain === voiceChain;
  const playNext = () => {
    if (!chainAlive()) return; // a newer chain owns the pools now
    clearTimeout(clipWatchdog);
    voice.current = null;
    if (!hooks.stillInWork() || i >= keys.length) { onDone(); return; }
    // Round's nearly over: starting one more word now means it gets cut by the
    // bell mid-syllable — the reported end-bell "glitch". Go quiet instead;
    // the bell's first strike lands in clean air.
    if (i > 0 && hooks.msLeftInPhase() < 450) { onDone(); return; }
    // Highlight here, not inside playWord: this runs exactly once per move,
    // whereas playWord re-enters on a retry and would re-pop the same word.
    hooks.onWord(i);
    playWord(keys[i++], 0);
  };

  // One word, with one retry. A clip sometimes reports "ended" almost instantly
  // without having made a sound (a decode that quietly failed on a reused
  // element). The chain treated that as spoken, so a combo shown as 1-2-3-4 was
  // heard as "1 _ 3 4" — a silent hole where a punch should be. We now notice
  // an impossibly-short playback and try the word once more on the pool's other
  // element before moving on.
  const playWord = (key, attempt) => {
    const node = getPooledClip(key); // round-robin: a retry lands on a different element
    // No element for this word — its file is missing or failed. Say it with
    // text-to-speech rather than leaving a silent hole where a punch should
    // be. The chain continues either way; a missing clip must never stop it.
    if (!node) { audit("word:tts", key); sayOneWord(key, playNext); return; }
    try { audit("word", `${key} a${attempt} ct=${node.currentTime.toFixed(2)}${node.ended ? " ended" : ""}${node.paused ? "" : " PLAYING"}`); } catch (e) {}
    // Never let two clips sound at once. Without this a retry (or a late
    // event) could start the next word on top of one still playing, which is
    // heard as words cutting each other off and the cadence going ragged.
    if (voice.current && voice.current !== node) {
      try { voice.current.pause(); voice.current.currentTime = 0; } catch (e) {}
    }
    // Clear handlers from this element's previous use so a late event from an
    // earlier combo can't advance the current one.
    node.onended = null;
    node.onerror = null;
    node.muted = false; // priming mutes elements; never inherit that into playback
    // Same rule as playSfx: never seek an element that ended on its own —
    // play() performs that rewind internally, and doubling it was the race
    // heard as "p-pivot" / "e-eight" on a word's 2nd+ use of a pool element.
    try { if (!node.ended && node.currentTime > 0.05) node.currentTime = 0; } catch (e) {}
    voice.current = node;

    const startedAt = Date.now();
    let moved = false;
    const once = (fn) => () => {
      if (moved || !chainAlive()) return; // ended/error/watchdog — first one wins, dead chains never
      moved = true;
      clearTimeout(clipWatchdog);
      fn();
    };
    const retryOr = (fallback) => {
      if (attempt < 1) { playWord(key, attempt + 1); return; }
      fallback();
    };
    const afterWord = () => {
      if (!chainAlive()) return;
      if (!hooks.stillInWork()) { onDone(); return; }
      // Owned by the module so stopVoice can cancel it — an anonymous timer
      // here was the zombie that interleaved two chains.
      wordGapTimer = setTimeout(playNext, hooks.wordGap());
    };
    const finished = once(() => {
      // Did it actually play, or just claim to? Deliberately a small ABSOLUTE
      // threshold rather than a fraction of the clip's length: the shortest
      // clip in audio/ is ~390ms, while a clip that never reached the speaker
      // reports back in a handful of milliseconds. Judging this as a fraction
      // of duration was too eager — it retried words that had played fine,
      // so they were spoken twice and the cadence went out.
      const elapsed = Date.now() - startedAt;
      audit("word:end", `${key} ${elapsed}ms${elapsed < 120 ? " phantom-retry" : ""}`);
      if (elapsed < 120) { try { node.pause(); node.currentTime = 0; } catch (e) {} retryOr(afterWord); return; }
      afterWord();
    });
    const skip = once(() => { audit("word:error", key); try { node.pause(); node.currentTime = 0; } catch (e) {} retryOr(playNext); });

    // Stale-event guard. A REAL ended has already flipped the element to
    // paused with .ended set before the event fires. iOS also delivers
    // "ended" events from an element's PREVIOUS use, late — arriving while
    // the element is audibly mid-way through its CURRENT word (the very
    // delivery quirk that made v1.13.0's parking cut words to ghosts).
    // Unguarded, a stale event either replayed a word that was playing fine
    // (elapsed < 120 read it as a phantom → retry) or advanced the chain
    // early so the next word displaced this one mid-syllable. An element
    // that's genuinely wedged is still covered by the watchdog.
    node.onended = () => {
      if (node.paused || node.ended) { finished(); return; }
      audit("word:stale-ignored", key);
    };
    node.onerror = skip;
    const p = node.play();
    if (p && p.catch) p.catch(() => { audit("word:reject", key); skip(); });

    // Fall forward once the clip's own length has elapsed (plus slack). Falls
    // back to a fixed guess when duration isn't known yet — common on iOS,
    // where metadata often hasn't loaded at first play.
    const durMs = node.duration && isFinite(node.duration) ? node.duration * 1000 : 1200;
    clipWatchdog = setTimeout(() => { audit("word:watchdog", key); finished(); }, durMs + 800);
  };

  playNext();
}

// Speak a SINGLE move, used only when that word's clip is unavailable. Always
// calls back exactly once — on end, on error, or on a watchdog — because the
// combo chain is waiting on it and must never be left hanging.
function sayOneWord(key, done) {
  let finished = false;
  const finish = () => { if (finished) return; finished = true; done(); };
  const move = MOVES[key];
  if (!move || !window.speechSynthesis) { finish(); return; }
  try {
    const u = new SpeechSynthesisUtterance(move.say);
    if (chosenVoice) u.voice = chosenVoice;
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
    setTimeout(finish, 1600); // iOS drops onend often enough to need this
  } catch (e) { finish(); }
}

// -- Text-to-speech fallback --
// Browsers ship a robotic default AND better "neural/natural" voices; pick the
// most natural English voice available on the device.
let chosenVoice = null;
function pickVoice() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (!voices.length) return;
  const en = voices.filter((v) => /^en/i.test(v.lang) || /english/i.test(v.name));
  const pool = en.length ? en : voices;
  const prefer = [/natural/i, /neural/i, /online/i, /google/i, /samantha/i, /aria/i, /jenny/i, /siri/i, /daniel/i, /alex/i];
  for (const rx of prefer) {
    const hit = pool.find((v) => rx.test(v.name));
    if (hit) { chosenVoice = hit; return; }
  }
  chosenVoice = pool.find((v) => v.default) || pool[0];
}
if ("speechSynthesis" in window) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice; // voices load async
}

// Speak a combo, then call onDone() when it finishes — so the NEXT combo waits
// for this one to finish and then applies the pace gap. This keeps the callout
// in sync with the pace setting instead of talking over itself.
export function speakCombo(combo, onDone) {
  if (voice.useClips) { playClips(combo, onDone); return; }
  if (!("speechSynthesis" in window)) { onDone(); return; }
  const u = new SpeechSynthesisUtterance(comboToSpeech(combo));
  if (chosenVoice) u.voice = chosenVoice;
  u.rate = 1.0;
  u.pitch = 1.0;
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(ttsFallback); onDone(); };
  u.onend = finish;
  u.onerror = finish;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  ttsFallback = setTimeout(finish, 10000); // safety if onend never fires
}

// Cut the voice dead: bump the generation token (deadening every pending
// callback of the current chain — gap timers, watchdogs, late "ended" events),
// clear the owned timers, and silence whatever is mid-word.
export function stopVoice() {
  audit("voice:stop", "chain " + voiceChain);
  voiceChain++;
  clearTimeout(clipWatchdog);
  clearTimeout(wordGapTimer);
  clearTimeout(ttsFallback);
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (voice.current) {
    try { voice.current.pause(); voice.current.currentTime = 0; } catch (e) {}
    voice.current = null;
  }
}
