// flame.js — the streak celebration: a vortex of light that catches into fire.
//
// Runs once at the end of a session, after the punch count-up has landed, when
// the streak actually went up. Everything it draws lives on ONE full-screen
// canvas mounted outside .app (same reasoning as js/tour.js: focus mode hides
// its own chrome, and this must never be caught by that).
//
// ============================================================================
// THE ONE ARCHITECTURAL RULE: render(t) IS A PURE FUNCTION OF t.
// ============================================================================
// No element carries velocity between frames. Every position is EVALUATED at
// time t from fixed birth parameters plus deterministic noise. Nothing is
// integrated, nothing accumulates.
//
// This is not tidiness for its own sake — three things depend on it:
//   1. The dev scrub slider. You cannot drag a timeline backwards through a
//      simulation that only knows how to step forward.
//   2. Tests. A frame at t=2.6 is the same frame on every machine, every run,
//      so the layout suite can screenshot fixed offsets and compare.
//   3. Dropped frames cost nothing. A phone that misses 200ms picks up at the
//      right place instead of drifting out of sync with the audio, which is
//      exactly how particle systems and their soundtracks come apart.
//
// The cost is that motion has to be expressed in closed form. Where a physics
// sim would integrate acceleration, this integrates ONCE, by hand, into
// spinIntegral() — see the note there.
//
// PHASE 1 OF 5. Present: config, clock, overlay, dim, motes, the full motion
// model, and the dev harness. Not yet: filaments, sheets, glints (phase 2),
// the catch and the flame (phase 3), audio (phase 4), badge handoff (phase 5).

import { audit } from "./audit.js";
import { fxContext, holdAudioSession } from "./audio.js";

// ============================================================================
// CONFIG — everything tunable, nothing tunable anywhere else.
// ============================================================================
// Timings are SECONDS on the sequence clock, where 0.0 is the moment the
// darkness starts closing in. The 500ms beat where the punch total sits fully
// lit happens BEFORE this clock starts, so these numbers read exactly as
// specified rather than being shifted by the lead-in.
export const FLAME = {
  // ---- Sequence timeline (seconds) ----
  //
  // RETIMED FROM THE ORIGINAL SPEC. It ran 5.8s, which a member sees every day
  // they keep a streak — long enough that the gather and the burn were both
  // holding past the point they had said what they had to say. But cutting to
  // the bone kills the feeling: "summoned" needs time to gather or it is just
  // a flash. This lands in the middle at 4.6s (5.0 with the lead) — gather
  // 1.85s, burn 1.25s, travel 0.8s.
  //
  // The original numbers, if it ever wants stretching back out:
  //   dimIn .6  motes .6  current 1.2  tighten 2.0  peak 2.6
  //   katch 2.8  alive 3.0  travel 5.0  done 5.8
  // Drag the dev scrub slider before changing these — pacing is a feel thing
  // and the numbers mean nothing next to watching it.
  t: {
    lead: 0.4,       // punch total sits lit and untouched before anything moves
    dimIn: 0.50,     // darkness + vignette close over this long, from 0.0
    motes: 0.50,     // first motes drift in from the edges
    current: 1.00,   // a current takes hold; orbiting begins
    tighten: 1.65,   // vortex compresses and accelerates
    peak: 2.20,      // maximum compression
    katch: 2.35,     // THE CATCH ("catch" is a reserved word in some tooling)
    alive: 2.55,     // flame burning, streak number fades in
    travel: 3.80,    // flame shrinks and moves to the badge slot
    done: 4.60,      // darkness fully lifted, canvas torn down
  },

  // ---- Vortex geometry ----
  vortex: {
    // Where the column stands, as a fraction of the viewport. The stats sit
    // low on the finish screen, so the vortex gathers above them.
    cx: 0.5,
    cy: 0.42,
    // Orbits are circles seen from slightly above the plane, so they project
    // to ellipses. This is the squash. Lower = more edge-on = more "column".
    tilt: 0.34,
    // Radius of the widest shell in viewport-min units (so it scales with the
    // phone rather than being pixel-tuned to one device).
    radius: 0.40,
    // How far the radius collapses by maximum compression. 0.14 means the
    // spiral ends at 14% of where it started.
    compress: 0.14,

    // DIFFERENTIAL ROTATION — the single most important detail.
    // Angular velocity scales as r^(-falloff) about the reference radius, so
    // the core whips around while the outer edges lag and the whole thing
    // shears instead of turning like a dinner plate. 0 = rigid disc (wrong).
    // At 1.2 the innermost shell runs ~4.8x the outermost, which reads as a
    // fast core inside a lagging body. Past ~1.8 the core outruns everything
    // so far it stops looking connected to the rest.
    falloff: 1.2,

    // ORBITAL SHELLS.
    //
    // `rate` is a small DETUNE, not the differential — that comes from radius
    // via shellOmega. Multiplying both was double-counting: a 2.53x rate on
    // top of a 3.07x radius term sent the inner shell round 8x faster than
    // intended and buried the effect the falloff exponent is supposed to
    // control. These values are deliberately near 1 and mutually irrational,
    // so the shells drift out of phase and never line back up inside the few
    // seconds anyone watches.
    shells: [
      { r: 1.00, rate: 1.000, share: 0.34 },
      { r: 0.72, rate: 1.093, share: 0.28 },
      { r: 0.48, rate: 0.941, share: 0.23 },
      { r: 0.27, rate: 1.127, share: 0.15 },
    ],

    // PEAK angular speed, turns/sec, at the reference radius — the rate
    // reached at the catch, not the average. Because the ramp integrates to
    // baseSpin/(spinEase+1), the average is a fraction of this, which is why
    // the number looks larger than it feels.
    baseSpin: 9.0,

    // SPIN-UP CURVE. The exponent on normalised time. 1 is a linear ramp and
    // reads mechanical. 3.4 was the first try and was too back-loaded to see:
    // the outer shell had turned 2.4 degrees by mid-vortex, so "a current
    // takes hold" simply never happened on screen. 2.2 still starts almost
    // imperceptibly and still arrives with a rush, but the middle of the
    // sequence has visible rotation in it.
    spinEase: 2.2,

    // INFLOW — how the motes ARRIVE.
    //
    // The first version had every mote simply contract inward from its own
    // orbital angle, which reads as a cloud getting smaller: no direction, no
    // current, nothing being drawn anywhere. What it should look like is a few
    // rivers finding the drain — coherent strands entering from the corners,
    // bending harder the closer they get.
    //
    // So motes are dealt into STREAMS. Every mote in a stream enters from
    // roughly the same bearing (`spread` is the width of the strand) and is
    // staggered in time along it, so the strand arrives as a moving line
    // rather than a clump. On the way in each one spirals: radius falls while
    // the angle sweeps `sweep` turns, which is the bend.
    inflow: {
      streams: 5,
      // Bearings in TURNS (0 = right, 0.25 = down). Deliberately uneven — an
      // evenly spaced set reads as a compass rose, not as currents that found
      // their own way in.
      angles: [0.07, 0.28, 0.46, 0.64, 0.87],
      spread: 0.035,      // strand width, in turns
      reach: 1.30,        // entry radius as a multiple of the half-diagonal
      sweep: 1.05,        // turns of bend on the way in — the "drain" curve
      approach: 1.05,     // seconds from entering to being captured by the orbit
      stagger: 0.42,      // spread of arrival times along one strand
    },

    // PRECESSION — the column wobbles off vertical on its own slow period,
    // deliberately unrelated to any orbital rate so the two never sync.
    precess: { period: 4.7, tiltAmp: 0.13, swayAmp: 0.055 },

    // TURBULENCE — curl noise perturbing radius and height so paths breathe
    // and wander instead of tracing perfect circles.
    curl: { scale: 1.9, speed: 0.42, ampR: 0.20, ampY: 0.16 },
    // How much brighter everything gets between the current taking hold and
    // the catch. This is the wind-up: the light has to climb into the moment
    // it releases, or the catch reads as arriving from nowhere.
    charge: 2.6,
    // How often an element gets flung wide before being pulled back.
    flingChance: 0.18,
    flingAmp: 0.42,

    // VERTICAL MOTION — some rise, some sink, some hover. Net drift upward.
    rise: { min: -0.05, max: 0.34, spread: 0.22 },
  },

  // ---- Primitives.
  //
  // Each owns a phase and hands off — never all at full strength at once. The
  // in/peak/fade values are windows WITHIN the timeline above, so if `t` moves
  // these have to move with it (they were left behind once already, and the
  // motes simply failed to appear at their own cue).
  //
  // Each has its own count and opacity so any one can be zeroed to see exactly
  // what it contributes. The dev panel's layer chips do the same thing without
  // editing anything. ----
  motes:     { count: 300, opacity: 1.00, size: [0.8, 2.3], in: 0.50, peak: 1.30, fade: 2.90 },
  // Filaments are the streams made VISIBLE. A trail is the same path sampled
  // at lagging times, so a filament lies exactly on the route its motes take —
  // they are one system, not a curve drawn near some dots.
  filaments: {
    count: 34, opacity: 0.80, in: 0.62, peak: 1.70, fade: 2.85,
    segments: 16,      // sample points per trail; more = smoother, linearly costlier
    // ADAPTIVE TAIL. A fixed time span cannot work here: the core turns ~11
    // times while the rim turns twice, so one constant dt gave inner filaments
    // trails that wrapped the whole vortex and outer ones that barely moved —
    // and at that sample spacing the curve degenerated into straight chords, a
    // wireframe polygon rather than a ribbon. Instead each trail is asked for a
    // fixed ARC LENGTH in pixels, and the time span is derived from the
    // element's actual screen speed. Every filament then reads the same length
    // no matter where it sits, and the segments stay short enough to curve.
    arc: 86,           // target trail length, px
    tailMin: 0.05,
    tailMax: 0.34,
    // Thickness varies a lot on purpose. A set of near-identical lines reads
    // as something generated; real strands in moving air have a few heavy
    // leaders with finer threads braided around them. The range is wide (nearly
    // 7x) and each filament also gets its own arc length, so no two are the
    // same weight OR the same length.
    width: [0.45, 3.10], // px at the head; tapers to nothing at the tail
  },
  sheets:    { count: 3,   opacity: 0.34, in: 1.45, peak: 2.10, fade: 2.90 },  // phase 2
  glints:    { count: 14,  opacity: 0.95, in: 1.40, fade: 2.50 },              // phase 2
  // ---- The flame ----
  //
  // Drawn as CEL BANDS, not per-pixel noise. Each tongue is filled three times
  // at shrinking size — deep rim, amber body, white-hot core — which gives the
  // stepped, graphic look the rest of the app has, keeps the silhouette clean
  // at small sizes, and costs ~40 fills a frame instead of a million pixels.
  // Continuous fbm mush would be both slower and, in a flat minimal UI, more
  // obviously out of place.
  flame: {
    opacity: 1.00,
    tongues: 17,       // overlapping tongues — never one outline (rule 2)
    height: 0.40,      // tallest tongue, in viewport-min units
    width: 0.050,      // half-width at the base
    baseY: 0.455,      // where the flame stands, viewport fraction
    lick: 1.55,        // how fast tongues lick upward
    // Max |dx/dy| of a tongue's centreline. 0.42 is about 23 degrees off
    // vertical at the extreme — a definite lean, never a limb.
    coneSlope: 0.52,
    shear: 0.42,       // lean rotates slowly — it remembers the spin
    wobble: 0.070,     // S-curve amplitude of the centreline
    detachFrom: 0.62,  // above this height a tip can pinch off and rise free
    glow: 1.05,        // additive halo behind the body
    embers: 16,
    steps: 24,         // points sampled up one edge of a tongue — 13 showed as polygon edges
  },

  // Fire ramp, separate from the vortex ramp. Value carries this, not hue:
  // white-hot core against a dim rim (rule 5), with the core allowed to clip
  // (rule 6). The violet appears ONLY in the thinnest dissolving wisps — any
  // more and it reads as rainbow fire, which is the cheap look.
  fire: {
    core:  [255, 253, 246],
    mid:   [255, 201,  98],
    outer: [255, 124,  38],
    rim:   [188,  46,  20],
    base:  [206, 232, 255],   // blue-white, only at the very foot
    wisp:  [132, 120, 205],
  },

  // ---- Colour.
  //
  // HOW THE FLAME GETS DRAWN (phase 3), from how effects animators actually
  // do it. Sources are listed at the bottom of this file.
  //
  //   1. SILHOUETTE FIRST. Block the mass before any detail — a strong base
  //      that thins and tapers as it rises. Start from an S-swoop, which is
  //      what carries wind direction; subtract mass with C-shapes; add sharp
  //      accents with hooks.
  //   2. NOT ONE SHAPE. Fire is dozens of overlapping tongues, each with its
  //      own peak and curve. A single outline is the giveaway.
  //   3. BREAK THE TOP into two or three uneven tips. Symmetry reads as fake
  //      faster than almost anything else.
  //   4. VARY THE HOOKS AND C-SHAPES. Uniform rounded forms are the classic
  //      failure — the tutorial calls it "a glob of toothpaste", which is
  //      exactly what a naive noise-driven blob looks like.
  //   5. VALUE BEATS HUE. Push the brightest pixels toward white and the
  //      dimmest toward deep red: that is the blackbody curve, and it is what
  //      gives a flame depth. The ramp below is built for that, not for
  //      prettiness.
  //   6. LET THE CORE CLIP. Correctly exposed fire in a dark scene looks fake,
  //      because every real image of fire anyone has seen is overexposed. The
  //      core should blow out to white.
  //   7. FLICKER IS BRIGHTNESS AND SHAPE, not just motion. Vary both.
  //   8. THE ROOM MUST REACT. Spill warm light onto the surrounding UI. The
  //      eye accepts a light source as real when the scene responds to it —
  //      this is cheap to do and does a disproportionate amount of the work.
  //
  // Stored as rgb triples so the renderer can interpolate without parsing
  // colour strings every frame. ----
  color: {
    cool:  [188, 214, 255],   // far from the axis — cool white, barely blue
    warm:  [255, 214, 140],   // mid
    hot:   [255, 248, 232],   // near the axis — white-hot
    ember: [255, 138,  46],   // deep rim
  },

  // ---- Darkness ----
  dim: {
    // How far the surrounding UI drops. Not to zero: the shapes staying faintly
    // there is what makes it read as "the lights went down" rather than "the
    // screen changed".
    ui: 0.10,
    vignette: 0.92,   // peak darkness at the edges
  },

  // ---- Performance ----
  perf: {
    maxDpr: 2,          // cap device pixel ratio; above 2 costs frames and shows nothing
    vortexDpr: 1.5,     // drop further while the vortex is dense
  },
};

// ============================================================================
// Deterministic noise. Same input, same output, forever — the scrub slider and
// the test suite both depend on that.
// ============================================================================
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * ux) + ((c - a) + (a - b + d - c) * ux) * uy;
}
// Two octaves is enough at this scale and costs half what three does.
function fbm2(x, y) {
  return noise2(x, y) * 0.65 + noise2(x * 2.17, y * 2.17) * 0.35;
}
// TRUE curl noise, not "some fbm added to the position". The curl of a scalar
// potential is its perpendicular gradient, which is divergence-free: paths
// swirl and fold without elements piling up in sinks or streaming out of
// sources. That divergence-free quality is exactly what makes it read as
// moving air rather than as jitter.
function curl(x, y, eps = 0.0007) {
  const n1 = fbm2(x, y + eps), n2 = fbm2(x, y - eps);
  const n3 = fbm2(x + eps, y), n4 = fbm2(x - eps, y);
  return [(n1 - n2) / (2 * eps), -(n3 - n4) / (2 * eps)];
}

// ============================================================================
// Motion model. Every function here takes t and returns where things are.
// ============================================================================

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Normalised progress across a window, clamped at both ends.
const span = (t, a, b) => clamp01((t - a) / (b - a));
// Smooth 0→1→0 envelope: rises over [a,b], holds, falls over [c,d].
function envelope(t, a, b, c, d) {
  if (t <= a || t >= d) return 0;
  if (t < b) { const u = span(t, a, b); return u * u * (3 - 2 * u); }
  if (t <= c) return 1;
  const u = 1 - span(t, c, d);
  return u * u * (3 - 2 * u);
}

// THE SPIN INTEGRAL — the one place the pure-function rule costs real work.
//
// Angular position is the integral of angular velocity. Velocity here ramps on
// a curve (config spinEase), so rather than accumulating dtheta every frame
// like a simulation would, the ramp is integrated ONCE, analytically:
//
//   omega(u) = baseSpin * u^k        ->      theta(u) = baseSpin * u^(k+1)/(k+1)
//
// so a scrub to any t lands on exactly the angle a real-time playthrough would
// have reached. Getting this wrong is subtle and nasty: the motion looks fine
// playing forward and desyncs the moment you scrub.
function spinIntegral(t) {
  const V = FLAME.vortex;
  const u = span(t, FLAME.t.current, FLAME.t.katch);
  const k = V.spinEase;
  return V.baseSpin * Math.pow(u, k + 1) / (k + 1) * (FLAME.t.katch - FLAME.t.current);
}

// How far the vortex has collapsed: 1 at full width, `compress` at the catch.
function compression(t) {
  const V = FLAME.vortex;
  const u = span(t, FLAME.t.current, FLAME.t.peak);
  const eased = u * u * (3 - 2 * u);
  return 1 - (1 - V.compress) * eased;
}

// The column's axis wobbles off vertical on its own slow period. Returns a
// horizontal offset and an extra squash, both in normalised units.
function precession(t) {
  const P = FLAME.vortex.precess;
  const a = (t / P.period) * Math.PI * 2;
  return {
    ox: Math.sin(a) * P.swayAmp + Math.sin(a * 0.61 + 1.3) * P.swayAmp * 0.45,
    tiltMul: 1 + Math.sin(a * 0.83 + 2.1) * P.tiltAmp,
  };
}

// Differential rotation. Angular speed scales as r^(-falloff) about a mid
// reference radius, so inner shells genuinely outrun outer ones.
function shellOmega(shellR) {
  return Math.pow(Math.max(shellR, 0.06) / 0.62, -FLAME.vortex.falloff);
}

// ============================================================================
// Element birth parameters. Fixed at build time, never mutated.
// ============================================================================
let motes = [];
let filaments = [];

function buildElements(n, seed, sizeRange) {
  const V = FLAME.vortex;
  const out = [];
  // Deal elements into shells by share, so the population matches the config
  // rather than landing wherever a random roll puts it.
  const shellFor = (i) => {
    let acc = 0;
    const u = (i + 0.5) / n;
    for (let s = 0; s < V.shells.length; s++) {
      acc += V.shells[s].share;
      if (u <= acc) return s;
    }
    return V.shells.length - 1;
  };
  const IN = V.inflow;
  for (let i = 0; i < n; i++) {
    const si = shellFor(i);
    const sh = V.shells[si];
    const h1 = hash2(i * 1.7 + seed, 11.3);
    const h2 = hash2(i * 2.3 + seed, 27.9);
    const h3 = hash2(i * 3.1 + seed, 41.1);
    const h4 = hash2(i * 4.9 + seed, 57.7);

    // Which current this one rides in on, and where along the strand it sits.
    const stream = i % IN.streams;
    const perStream = Math.ceil(n / IN.streams);
    // Position along the strand, 0 at the head and 1 at the tail, spread
    // EVENLY. (The first version used `(i / streams) % 1`, which hands every
    // mote in a stream the same value — 5/5 % 1 is 0, so is 10/5 % 1 — so
    // nothing was staggered and the strands never formed.)
    const along = Math.floor(i / IN.streams) / Math.max(1, perStream - 1);

    // Across-strand offset from SMOOTH noise along the strand, not a random
    // roll. Random scatter gives a fuzzy tube; a coherent wander gives the
    // strand a shape, which is what makes it read as hair or a river rather
    // than a line of dots.
    const across = (noise2(along * 3.4, stream * 7.1) - 0.5) * IN.spread
                 + (h2 - 0.5) * IN.spread * 0.25;
    const enterAngle = (IN.angles[stream] + across) * Math.PI * 2;

    const born = FLAME.t.motes + along * IN.stagger;
    const approach = IN.approach * (0.94 + h4 * 0.12);   // tight: a strand must hold formation

    out.push({
      shell: si,
      // Radius jitter inside the shell gives micro-differential: two motes on
      // the same shell still slip past each other.
      r: sh.r * (0.84 + h1 * 0.32),
      rate: sh.rate,
      // The orbital phase is DERIVED from where the mote came in and how far
      // it bent on the way. That is what makes the hand-off from stream to
      // orbit continuous — at the moment of capture the two formulas agree
      // exactly, so there is no jump to hide.
      phase: enterAngle + IN.sweep * Math.PI * 2,
      enterAngle,
      stream,
      born,
      capturedAt: born + approach,
      // How high it sits on the column once captured.
      y0: (h3 - 0.5) * V.rise.spread,
      riseRate: V.rise.min + h4 * (V.rise.max - V.rise.min),
      size: sizeRange[0] + h1 * (sizeRange[1] - sizeRange[0]),
      // Its own slice of the noise field, so no two breathe together.
      seed: h2 * 97.3 + h3 * 13.1,
      // A minority get flung wide and hauled back in.
      fling: h4 < FLAME.vortex.flingChance ? (0.5 + h1) * FLAME.vortex.flingAmp : 0,
    });
  }
  return out;
}

// Where one element is at time t. Returns null when it is not on screen yet.
// The projection: orbits are circles about a vertical axis, seen from slightly
// above, so they draw as ellipses. sin(theta) doubles as DEPTH — it says
// whether the element is passing in front of the column or behind it, which is
// what makes a flat canvas read as a volume.
function moteAt(m, t, W, H, R) {
  const V = FLAME.vortex;
  const IN = V.inflow;
  if (t < m.born) return null;

  const pre = precession(t);
  // Curl turbulence: sampled in the element's own patch of the field, drifting
  // with time so paths breathe rather than sit still.
  const [cu, cv] = curl(m.seed + t * V.curl.speed, m.seed * 0.7 + t * V.curl.speed * 0.6);

  // Orbital angle, once captured. During the approach this is faded in by `ap`
  // so a mote still out on its stream is not yet being whipped around.
  const orbit = shellOmega(m.r) * m.rate * spinIntegral(t) * Math.PI * 2;

  // ---- The approach ----
  // ap runs 0 (just entered, far off-screen on its stream) to 1 (captured).
  // Smoothstepped at BOTH ends so there is no kink in the velocity where the
  // stream becomes an orbit.
  const ap = span(t, m.born, m.capturedAt);
  const E = ap * ap * (3 - 2 * ap);

  // Half the screen diagonal, in the same units as the orbital radius, so a
  // stream genuinely starts beyond the corner on any shape of phone.
  const halfDiag = Math.sqrt(W * W + H * H) / 2 / R;
  const rEnter = halfDiag * IN.reach;
  const rOrbit = m.r * compression(t);

  // Radius falls from off-screen to the orbit; the angle sweeps `sweep` turns
  // on the way. Together those two are the bend — the river finding the drain.
  let r = rEnter + (rOrbit - rEnter) * E;
  const theta = m.enterAngle + IN.sweep * Math.PI * 2 * E + orbit * E;

  // THE CONSUMPTION. After the catch the vortex material does not simply fade
  // out where it stands — it is drawn inward and down into the flame\'s base,
  // so the flame reads as being MADE of what was swirling rather than pasted
  // over the top of it. Radius collapses toward the axis and the height sinks
  // toward the foot of the fire.
  const eaten = span(t, FLAME.t.katch, FLAME.t.katch + 0.55);
  if (eaten > 0) r *= 1 - eaten * 0.92;

  // Turbulence and flings only apply once the current has hold. A mote still
  // out on its stream should read as travelling, not as being buffeted.
  r *= 1 + cu * V.curl.ampR * E;
  if (m.fling) r *= 1 + m.fling * E * Math.sin(span(t, FLAME.t.current, FLAME.t.peak) * Math.PI * 2 + m.seed);

  // Entry is round, the orbit is squashed. Blending the projection means
  // streams come in from the CORNERS and then settle into the flat ellipse of
  // the column — with a fixed squash they could only ever enter from the sides.
  const tilt = 1 + (V.tilt * pre.tiltMul - 1) * E;

  const rise = (m.riseRate * span(t, m.capturedAt, FLAME.t.katch)) + cv * V.curl.ampY * E;

  const x = W * V.cx + pre.ox * R * E + Math.cos(theta) * r * R;
  let y = H * V.cy - (m.y0 * E + rise) * R + Math.sin(theta) * r * R * tilt;
  if (eaten > 0) y += (H * FLAME.flame.baseY - y) * eaten * 0.85;   // sink into the fire
  const depth = Math.sin(theta);          // +1 nearest the viewer, -1 furthest

  return { x, y, r, depth, theta, ap };
}

// ============================================================================
// Canvas overlay
// ============================================================================
let canvas = null, ctx2d = null, dimEl = null;
let W = 0, H = 0, dpr = 1;
let available = null;   // null = untested, false = no 2D context (jsdom)

function mount() {
  if (canvas) return true;
  if (available === false) return false;
  if (typeof document === "undefined") { available = false; return false; }
  const c = document.createElement("canvas");
  c.className = "flamefx";
  c.setAttribute("aria-hidden", "true");
  let g = null;
  try { g = c.getContext && c.getContext("2d"); } catch (e) { g = null; }
  // jsdom has no 2D context. Everything below degrades to a silent no-op
  // rather than throwing through the finish screen.
  if (!g) { available = false; audit("flame", "no 2d context"); return false; }
  const d = document.createElement("div");
  d.className = "flamefx__dim";
  d.setAttribute("aria-hidden", "true");
  document.body.appendChild(d);
  document.body.appendChild(c);
  canvas = c; ctx2d = g; dimEl = d; available = true;
  resize();
  return true;
}

function resize() {
  if (!canvas) return;
  const w = window.innerWidth, h = window.innerHeight;
  dpr = Math.min(FLAME.perf.maxDpr, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  W = w; H = h;
}

function unmount() {
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  if (dimEl && dimEl.parentNode) dimEl.parentNode.removeChild(dimEl);
  canvas = null; ctx2d = null; dimEl = null;
}

// ---- Pre-rendered sprites, one per colour stop.
//
// Building a radial gradient per particle per frame is the classic way to lose
// every frame on a phone: each createRadialGradient allocates, and at 190
// motes that is 190 allocations per frame before a single pixel is filled.
// These are built once. A white sprite drawn under 'lighter' would add white
// light and wash the tint out of everything, so the ramp is baked into a small
// set of sprites and the renderer picks the nearest — three blits' worth of
// setup for correctly coloured glow at zero per-frame cost. ----
const RAMP = 5;
let sprites = null;
const lerp = (a, b, u) => a + (b - a) * u;

function heatColor(u) {
  const C = FLAME.color;
  // rim -> mid -> core. Cool white at the edges, white-hot on the axis.
  const a = u < 0.5 ? C.cool : C.warm;
  const b = u < 0.5 ? C.warm : C.hot;
  const v = u < 0.5 ? u * 2 : (u - 0.5) * 2;
  return [Math.round(lerp(a[0], b[0], v)), Math.round(lerp(a[1], b[1], v)), Math.round(lerp(a[2], b[2], v))];
}

function buildSprites() {
  if (sprites) return sprites;
  const S = 64;
  sprites = [];
  for (let i = 0; i < RAMP; i++) {
    const [r, g_, b] = heatColor(i / (RAMP - 1));
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, `rgba(${r},${g_},${b},1)`);
    grad.addColorStop(0.26, `rgba(${r},${g_},${b},0.5)`);
    grad.addColorStop(1, `rgba(${r},${g_},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    sprites.push(c);
  }
  return sprites;
}

// ============================================================================
// THE FLAME
// ============================================================================
// Shape language, straight off the effects-animation rules in the config:
// a strong base thinning as it rises, a centreline that is an S-swoop rather
// than a straight axis, half-widths pinched by C-shapes and pushed out by
// hooks, and no two tongues the same height or phase — so the crown breaks
// into uneven tips on its own instead of being a symmetrical dome.
let tongues = [];
let embers = [];

function buildFlame(seed = 1) {
  const F = FLAME.flame;
  tongues = [];
  for (let i = 0; i < F.tongues; i++) {
    const h1 = hash2(i * 5.3 + seed, 71.7);
    const h2 = hash2(i * 7.1 + seed, 83.9);
    const h3 = hash2(i * 9.7 + seed, 97.3);
    tongues.push({
      // Spread across the base, densest in the middle so the body reads as one
      // mass with tongues rising out of it rather than a row of candles.
      x: (h1 - 0.5) * 1.15 * (0.35 + h2 * 0.65),
      h: F.height * (0.42 + h2 * 0.58),
      // Thickness spans nearly 4x, not a polite 2x. A set of same-shaped
      // tongues at slightly different scales still reads as one stamp
      // repeated.
      w: F.width * (0.34 + h1 * 1.02),
      // PROFILE. Low values give a blunt, fat tongue; high values give a thin
      // spike. This is what actually makes two tongues different SHAPES rather
      // than the same shape at two sizes. The range starts well above 0.5
      // because a low exponent holds its width almost to the tip, and a body
      // made of those reads as an egg rather than as flame.
      taper: 0.80 + h3 * 1.35,
      // Each tongue carries its bands differently — on some the white core
      // rides high and wide, on others it is a small ember low in the body.
      bandW: 0.80 + h2 * 0.42,
      bandH: 0.78 + h1 * 0.46,
      // Each foot sits at its own height. Without this every closed path
      // ended on the same line and the whole body was cut off by a hard
      // horizontal edge — the single most artificial thing about the first
      // draft. Fire has no bottom edge.
      foot: h2 * 0.018,
      phase: h3 * Math.PI * 2,
      lick: F.lick * (0.78 + h1 * 0.5),
      lean: (h2 - 0.5) * 1.05,
      // BRANCHING. A tongue can fork partway up, the way a trunk throws a
      // limb — the branch carries its own bands and its own lean, so the
      // banding forks with it instead of every tongue being a single stem.
      branch: h1 > 0.45,
      branchAt: 0.26 + h2 * 0.30,
      branchLean: (h3 - 0.5) * 0.95,
      branchScale: 0.42 + h1 * 0.28,
      // Tips above detachFrom can pinch off and rise free. Staggered so they
      // never let go together.
      detach: h3 > 0.68,
      detachPhase: h1 * Math.PI * 2,
      seed: h1 * 53.1 + h3 * 17.9,
      depth: h2,            // back-to-front ordering
    });
  }
  tongues.sort((a, b) => a.depth - b.depth);

  embers = [];
  for (let i = 0; i < F.embers; i++) {
    const e1 = hash2(i * 3.7 + seed, 131.1);
    const e2 = hash2(i * 6.1 + seed, 149.3);
    embers.push({ x: (e1 - 0.5) * 1.2, born: e2, rise: 0.5 + e1 * 0.8,
                  drift: (e2 - 0.5) * 0.5, size: 0.7 + e2 * 1.4, seed: e1 * 31.7 });
  }
}

// One tongue's outline at time t, as a closed path on the context.
// `shrink` nests the cel bands: 1 = full silhouette, smaller = inner band.
// Bands are SCALED, and a band a tongue is too thin to carry is skipped
// outright.
//
// Two wrong turns are recorded here because both looked reasonable. Scaling
// alone gives a slim tongue a hair-thin core — a string down its middle.
// Switching to a fixed INSET fixed the strings and destroyed the flame: with
// most tongues narrower than the largest inset, nearly every one lost all its
// inner bands and became a flat rim-coloured triangle, so the whole body went
// angular and lost its colour structure. Scale for shape, skip for legibility.
function tonguePath(g, tn, t, cx, by, R, shrink, grow, band) {
  const F = FLAME.flame;
  const N = F.steps;
  const wob = F.wobble;
  // Each BAND gets its own phase, its own noise patch and its own lick rate,
  // so the four bands slip against one another instead of being nested copies
  // of one outline. This is the difference between layered fire and a shape
  // with piping: in real flame the white core surges and falls on a different
  // beat from the envelope around it.
  const bs = band ? band.seed : 0;
  const bl = band ? band.lick : 1;
  const bp = band ? band.phase : 0;
  // Rotational shear: the lean direction turns slowly, so the whole body keeps
  // a twist that reads as a memory of the spin.
  const shear = Math.sin(t * F.shear + tn.phase) * 0.6;
  const h = tn.h * grow * (0.86 + 0.14 * noise2(tn.seed, t * tn.lick));

  const pt = (u, side) => {
    // Centreline: an S-swoop, not an axis. Amplitude grows with height so the
    // foot stays planted while the tip swings.
    const scroll = t * tn.lick * bl;
    // Two harmonics plus noise, and a hook that only bites near the tip. One
    // low-amplitude sine gave straight spikes: the shape language (S-swoop in,
    // hook at the end) never appeared, so the tongues read as rigid triangles
    // rather than as flame licking. The tip term is what curls the ends.
    const sway = Math.sin(u * Math.PI * 1.45 + tn.phase + bp + scroll) * wob * u
               + Math.sin(u * Math.PI * 3.10 + tn.phase * 1.7 + scroll * 1.3) * wob * 0.42 * u
               + (noise2(tn.seed + bs + u * 2.6, scroll) - 0.5) * wob * 1.15 * u
               + Math.sin(scroll * 0.9 + tn.phase) * wob * 0.55 * Math.pow(u, 3.0);
    
    // THE RISE CONE. Lateral offset is clamped to a fraction of how far the
    // tongue has already risen, so nothing can ever point sideways — at worst
    // it leans. Without this, lean plus shear plus sway could add up to a
    // near-horizontal limb, and a flame with two of those sticking out looks
    // like it has hands. Fire goes up; it only ever leans on the way.
    const lat = (tn.lean + shear) * u * u * wob * 1.7 + sway;
    const cone = F.coneSlope * u * (h / R);
    const latC = Math.max(-cone, Math.min(cone, lat));
    const cxx = cx + (tn.x * F.width * 2.3 + latC) * R;
    // Half-width: thick through the body, thinning to a point, with C-shape
    // pinches and hook bulges so the edge is never a clean parabola. The
    // extra term near u=0 pulls the very foot back in, so tongues meet the
    // base as a ragged rounded mass instead of a sawn-off block.
    // The foot profile is a QUARTER CIRCLE, not a straight ramp. Width still
    // reaches exactly zero at the very bottom (so no shape closes along a flat
    // line and leaves a sawn-off edge), but it gets there on a curve, so the
    // base of the mass is rounded. A linear ramp makes every shape a V, and a
    // body built from a dozen V's converges to a point — the whole flame read
    // as a kite standing on its tip.
    const fu = Math.min(1, u / 0.30);
    const foot = Math.sqrt(1 - (1 - fu) * (1 - fu));
    const taper = Math.pow(1 - u, tn.taper) * foot;
    // Hook amplitude is per-shape. At +-0.95 a WIDE shape gets notches cut so
    // deep it reads as an angular star rather than a mass of fire; narrow
    // tongues can carry far more variation than the body can.
    const hookAmp = tn.hookAmp != null ? tn.hookAmp : 0.85;
    const hook = 1 + (noise2(tn.seed * 1.7 + bs * 2.3 + u * 3.1, scroll * 0.8) - 0.5) * hookAmp;
    const w = tn.w * shrink * taper * hook * R;
    return [cxx + side * w, by + tn.foot * R - u * h * R];
  };

  // Too thin to read as a band — it would draw as a thread, so it is simply
  // not part of this tongue. Slim tongues end up all rim and outer, which is
  // exactly right: a thin lick of flame has no white core.
  if (tn.w * shrink < 0.011) return false;

  g.beginPath();
  for (let k = 0; k <= N; k++) { const [x, y] = pt(k / N, -1); k ? g.lineTo(x, y) : g.moveTo(x, y); }
  for (let k = N; k >= 0; k--) { const [x, y] = pt(k / N, 1); g.lineTo(x, y); }
  g.closePath();
  return true;
}

function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`; }

function renderFlame(g, t, W, H, R) {
  const F = FLAME.flame, C = FLAME.fire;
  // Grows out of the catch, burns, then shrinks away as it travels.
  const born = envelope(t, FLAME.t.katch, FLAME.t.alive, FLAME.t.travel, FLAME.t.done);
  if (born <= 0.004) return;
  const grow = 0.35 + 0.65 * span(t, FLAME.t.katch, FLAME.t.alive + 0.25);
  // The travel: the body shrinks and slides toward where the badge will sit.
  const tv = span(t, FLAME.t.travel, FLAME.t.done);
  // Ease toward the badge on a curve that starts slow — the flame gathers
  // itself before it goes, rather than sliding off the moment travel begins.
  const tve = tv * tv * (3 - 2 * tv);
  const shrinkAll = 1 - tve * 0.93;

  const tx = target ? target.x : W * 0.5;
  const ty = target ? target.y : H * 0.78;
  const cx = W * FLAME.vortex.cx + (tx - W * FLAME.vortex.cx) * tve;
  const by = H * F.baseY + (ty - H * F.baseY) * tve;
  const a = born * FLAME.flame.opacity;

  // --- Additive glow behind. The room reacting is what sells a light source
  // (rule 8); this also spills onto the stats sitting under it. ---
  const spr = buildSprites();
  const gr = R * 0.42 * grow * shrinkAll * (1 + 0.05 * Math.sin(t * 7.3));
  g.globalAlpha = a * F.glow * 0.42;
  g.drawImage(spr[RAMP - 1], cx - gr, by - gr * 1.5, gr * 2, gr * 2);
  const gr2 = gr * 0.55;
  g.globalAlpha = a * F.glow * 0.5;
  g.drawImage(spr[RAMP - 1], cx - gr2, by - gr2 * 1.5, gr2 * 2, gr2 * 2);

  // THE BODY IS NOT ADDITIVE.
  //
  // Everything else on this canvas composites with 'lighter', which is right
  // for motes and glow — overlapping light should brighten. It is exactly
  // wrong for cel bands: fifteen tongues times four bands stacked additively
  // saturate to flat white wherever they cross, which is what turned the
  // middle of the flame into one featureless blob no matter how the bands
  // were sized. Painted shapes occlude; only light adds.
  g.globalCompositeOperation = "source-over";

  // --- THE BODY MASS ---
  // Tapering every tongue to a point at its foot leaves dark V-shaped gaps
  // between neighbours, and against a near-black screen those read as black
  // triangles cut into the base of the fire. Real flame has a coherent burning
  // body down there that the tongues rise out of. These three wide, low, blunt
  // shapes are that body; everything else stands on them.
  // LOW AND DIM ON PURPOSE. The first version ran to 2.5x the tongue width and
  // 0.30 of the flame height at full opacity, including a white core band —
  // which is not a base, it is a solid cone standing in front of every tongue,
  // and it swallowed the whole body. All this needs to do is close the gaps
  // between the tongue feet in the bottom tenth of the flame.
  for (const [i, wide, high, col, al] of [
    [0, 1.55, 0.115, C.rim, 0.50],
    [1, 1.15, 0.085, C.outer, 0.60],
    [2, 0.70, 0.055, C.mid, 0.55],
  ]) {
    const bodyTn = {
      x: 0, w: F.width * wide, h: F.height * high, foot: 0,
      taper: 1.05, phase: i * 1.9, lick: F.lick * (0.5 + i * 0.14),
      lean: 0, seed: 60 + i * 11, bandW: 1, bandH: 1, hookAmp: 0.30,
    };
    g.globalAlpha = a * al;
    g.fillStyle = rgba(col, 1);
    if (tonguePath(g, bodyTn, t, cx, by, R, 1, grow * shrinkAll,
                   { seed: i * 7.7, lick: 0.8 + i * 0.21, phase: i * 2.1 })) g.fill();
  }

  // --- Body: nested cel bands per tongue, back to front. Rim first so
  // the hotter bands sit inside it. ---
  for (let i = 0; i < tongues.length; i++) {
    const tn = tongues[i];
    const dep = 0.55 + tn.depth * 0.45;
    // Each band is narrower AND SHORTER than the one outside it. Scaling only
    // the width made every band a concentric copy of the same outline, so the
    // body read as a white blob wearing orange piping. Dropping the height too
    // puts the white-hot region low in the flame where it belongs, and lets
    // each colour own a real area instead of a rim.
    // lick and phase are deliberately non-harmonic across the bands: the core
    // runs fastest (hot gas moves), the rim slowest, and none of the rates
    // divide into each other, so the four never fall back into step.
    // Fire is not four flat bands. Outside the rim there are thin wisps
    // dissolving into nothing; inside the body a soft haze sits between the
    // amber and the white; and the core itself is small and low. Six layers,
    // each on its own beat.
    // FOUR bands, drawn solid. The seven-layer version — with extra haze
    // passes and an outsized violet wisp band — composited into something
    // that read as overlapping panes of coloured glass, and the violet came
    // forward as purple flames, which is the exact "rainbow fire looks cheap"
    // failure. Stylised means fewer, more confident shapes.
    for (const [shrink, hscale, col, alpha, band] of [
      [1.00, 1.00, C.rim,   0.72, { seed: 0.0,  lick: 0.71, phase: 0.0 }],
      [0.74, 0.84, C.outer, 0.88, { seed: 4.3,  lick: 0.94, phase: 1.7 }],
      [0.50, 0.68, C.mid,   0.94, { seed: 9.1,  lick: 1.23, phase: 3.4 }],
      [0.26, 0.46, C.core,  0.95, { seed: 15.7, lick: 1.61, phase: 5.2 }],
    ]) {
      g.globalAlpha = a * alpha * dep;
      g.fillStyle = rgba(col, 1);
      const bh = 1 - (1 - hscale) * tn.bandH;
      const bw = 1 - (1 - shrink) * tn.bandW;
      if (tonguePath(g, tn, t, cx, by, R, bw * shrinkAll, grow * shrinkAll * bh, band)) g.fill();
    }
  }

  // --- Branches. A limb thrown off the trunk partway up, with its own bands
  // and its own lean, so the banding forks rather than running as one stem. ---
  for (const tn of tongues) {
    if (!tn.branch) continue;
    const sh = Math.sin(t * F.shear + tn.phase) * 0.6;
    const bu = tn.branchAt;
    const limb = {
      ...tn,
      // Its base sits partway up the parent, offset along the parent's lean.
      x: tn.x + (tn.lean + sh) * bu * bu * F.wobble * 1.7 / (F.width * 1.3) * 0.5,
      foot: tn.foot - bu * tn.h,
      h: tn.h * tn.branchScale,
      w: tn.w * tn.branchScale * 0.85,
      lean: tn.branchLean,
      phase: tn.phase + 2.4,
      seed: tn.seed + 27.3,
      taper: tn.taper * 0.9,
    };
    const dep = 0.55 + tn.depth * 0.45;
    for (const [inset, hscale, col, alpha, band] of [
      [1.00, 1.00, C.rim,   0.50, { seed: 2.2,  lick: 0.77, phase: 0.6 }],
      [0.72, 0.84, C.outer, 0.72, { seed: 5.5,  lick: 1.02, phase: 2.2 }],
      [0.44, 0.58, C.mid,   0.86, { seed: 10.4, lick: 1.31, phase: 3.9 }],
      [0.22, 0.34, C.core,  1.00, { seed: 16.9, lick: 1.7,  phase: 5.6 }],
    ]) {
      g.globalAlpha = a * alpha * dep;
      g.fillStyle = rgba(col, 1);
      if (tonguePath(g, limb, t, cx, by, R, inset * tn.bandW, grow * shrinkAll * hscale, band)) g.fill();
    }
  }

  // --- Detaching tips. A tongue that licks high enough pinches off: the top
  // travels on alone, thinning and dissolving, while the parent falls back.
  // Fire sheds its tips constantly and nothing else in the body says that. ---
  for (const tn of tongues) {
    if (!tn.detach) continue;
    const cyc = ((t * 0.62 + tn.detachPhase) % 1);
    if (cyc < 0.12) continue;
    const k = (cyc - 0.12) / 0.88;
    const lift = k * 0.16 * R;
    const ghost = {
      ...tn,
      // Small, and shrinking as it goes — a shed tip does not hold its size.
      h: tn.h * 0.22 * (1 - k * 0.55),
      w: tn.w * 0.38 * (1 - k * 0.5),
      foot: tn.foot - (F.detachFrom * tn.h + lift / R),
      taper: tn.taper * 1.35,
    };
    for (const [shrink, hscale, col, al, band] of [
      [1.00, 1.00, C.outer, 0.45, { seed: 3.1, lick: 1.1, phase: 1.1 }],
      [0.50, 0.62, C.mid, 0.70, { seed: 8.8, lick: 1.4, phase: 2.9 }],
    ]) {
      g.globalAlpha = a * al * (1 - k) * (1 - k);
      g.fillStyle = rgba(col, 1);
      if (tonguePath(g, ghost, t, cx, by, R, shrink * shrinkAll, grow * shrinkAll * hscale, band)) g.fill();
    }
  }

  // --- Blue-white foot. Only at the very base, only a smear. ---
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = a * 0.5;
  const bw = R * 0.10 * shrinkAll;
  g.drawImage(spr[RAMP - 1], cx - bw, by - bw * 0.5, bw * 2, bw);
  g.fillStyle = rgba(C.base, 1);
  g.globalAlpha = a * 0.22;
  g.beginPath();
  g.ellipse(cx, by - R * 0.012 * shrinkAll, R * 0.055 * shrinkAll, R * 0.022 * shrinkAll, 0, 0, Math.PI * 2);
  g.fill();

  // --- Embers off the tips ---
  g.globalAlpha = 1;
  for (const e of embers) {
    const cyc = ((t - FLAME.t.katch) * 0.55 + e.born) % 1;
    if (cyc < 0.02) continue;
    const ey = by - (F.height * R * 0.9 + cyc * e.rise * R * 0.42) * grow * shrinkAll;
    const ex = cx + (e.x * F.width * 2.4 + e.drift * cyc + (noise2(e.seed, t * 0.8) - 0.5) * 0.06) * R;
    const ea = a * (1 - cyc) * 0.85;
    if (ea <= 0.004) continue;
    const es = e.size * (1 - cyc * 0.5) * shrinkAll;
    g.globalAlpha = ea;
    g.drawImage(spr[RAMP - 2], ex - es * 2.5, ey - es * 2.5, es * 5, es * 5);
  }
}

// THE CATCH — a rounded bloom of warm light expanding fast with soft edges,
// decelerating sharply as the flame resolves out of it. No hard flash frame,
// no ring, no debris: gas igniting, not something detonating.
function renderCatch(g, t, W, H, R) {
  const k = span(t, FLAME.t.katch, FLAME.t.alive + 0.30);
  if (k <= 0 || k >= 1) return;
  // Fast out, hard deceleration — the expansion is nearly over by a third of
  // the way through, which is what makes it read as a whump rather than a ring.
  const e = 1 - Math.pow(1 - k, 3.6);
  const rad = R * (0.10 + 0.46 * e);
  const a = (1 - k) * (1 - k) * 0.85;
  const spr = buildSprites();
  g.globalAlpha = a;
  g.drawImage(spr[RAMP - 1], W * FLAME.vortex.cx - rad, H * FLAME.flame.baseY - rad * 1.15, rad * 2, rad * 2);
  g.globalAlpha = a * 0.6;
  const r2 = rad * 0.55;
  g.drawImage(spr[RAMP - 1], W * FLAME.vortex.cx - r2, H * FLAME.flame.baseY - r2 * 1.15, r2 * 2, r2 * 2);
}

// ============================================================================
// Draw one frame at time t. Pure: same t, same picture.
// ============================================================================
let mask = { motes: true, filaments: true, sheets: true, glints: true, flame: true };

export function renderAt(t) {
  if (!ctx2d) return;
  const g = ctx2d;
  const R = Math.min(W, H);

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  // The dim is CSS, not canvas: the canvas only ever ADDS light, so the stats
  // underneath stay readable and the composite stays honestly additive.
  if (dimEl) {
    const d = envelope(t, 0, FLAME.t.dimIn, FLAME.t.travel, FLAME.t.done);
    dimEl.style.opacity = String(d * FLAME.dim.vignette);
  }

  g.globalCompositeOperation = "lighter";

  // ---- Filaments: back-to-front, so motes and glints sit on top of them ----
  if (mask.filaments && FLAME.filaments.opacity > 0) {
    const F = FLAME.filaments;
    const env = envelope(t, F.in, F.peak, FLAME.t.katch, F.fade);
    if (env > 0.004) {
      const heat = span(t, FLAME.t.current, FLAME.t.peak);
      const charge = 1 + FLAME.vortex.charge * Math.pow(span(t, FLAME.t.current, FLAME.t.katch), 2);
      g.lineCap = "round";
      for (let i = 0; i < filaments.length; i++) {
        const f = filaments[i];
        // Sample the SAME path backwards in time. This is the whole trick: the
        // trail cannot drift off the route because it IS the route, evaluated
        // at t, t-dt, t-2dt...
        // Derive this element's tail from how fast it is actually moving on
        // screen, measured over one frame's worth of time.
        const a0 = moteAt(f, t, W, H, R);
        if (!a0) continue;
        const a1 = moteAt(f, t - 0.016, W, H, R);
        let tail = F.tailMax;
        if (a1) {
          const speed = Math.hypot(a0.x - a1.x, a0.y - a1.y) / 0.016;   // px/sec
          // Each filament asks for a slightly different arc, so the strands
          // are not a set of matched dashes.
          const want = F.arc * (0.62 + (f.seed % 1) * 0.9);
          if (speed > 1) tail = Math.max(F.tailMin, Math.min(F.tailMax, want / speed));
        }
        let prev = null;
        for (let k = 0; k < F.segments; k++) {
          const u = k / (F.segments - 1);
          const p = moteAt(f, t - u * tail, W, H, R);
          if (!p) { prev = null; continue; }
          if (prev) {
            // Taper: bright and wide at the head, gone at the tail. Drawn per
            // segment because a single stroked path can only carry one alpha.
            const taper = 1 - u;
            const near = (p.depth + 1) / 2;
            const nearAxis = clamp01(1 - p.r / FLAME.vortex.radius);
            const a = env * F.opacity * charge * taper * taper * (0.30 + near * 0.70)
                    * (0.55 + (f.size / F.width[1]) * 0.55);
            if (a > 0.004) {
              const c = heatColor(clamp01(nearAxis * 0.7 + heat * 0.55));
              g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
              g.lineWidth = f.size * taper * (0.7 + near * 0.6);
              g.beginPath();
              g.moveTo(prev.x, prev.y);
              g.lineTo(p.x, p.y);
              g.stroke();
            }
          }
          prev = p;
        }
      }
    }
  }

  if (mask.motes && FLAME.motes.opacity > 0) {
    const M = FLAME.motes;
    const env = envelope(t, M.in, M.peak, FLAME.t.katch, M.fade);
    const heat = span(t, FLAME.t.current, FLAME.t.peak);
    // Same charge curve as the filaments: as the spiral tightens it also
    // BRIGHTENS. Without this the gather was almost flat in total light —
    // 53 to 138 over more than a second — so nothing felt like it was
    // building, and there was a dip right before the catch where the vortex
    // had shrunk away before the flame arrived to replace it.
    const charge = 1 + FLAME.vortex.charge * Math.pow(span(t, FLAME.t.current, FLAME.t.katch), 2);
    const spr = buildSprites();
    for (let i = 0; i < motes.length; i++) {
      const p = moteAt(motes[i], t, W, H, R);
      if (!p) continue;
      // Depth: nearer motes are bigger and brighter. This is the whole reason
      // a 2D canvas reads as a rotating column rather than a flat ring.
      const near = (p.depth + 1) / 2;
      const scale = 0.72 + near * 0.6;
      const nearAxis = clamp01(1 - p.r / FLAME.vortex.radius);
      const a = env * M.opacity * charge * (0.35 + near * 0.65) * (0.5 + nearAxis * 0.5);
      if (a <= 0.004) continue;
      // Pick the pre-tinted sprite instead of building a gradient. Colour
      // warms toward the axis and as the vortex tightens.
      const u = clamp01(nearAxis * 0.7 + heat * 0.55);
      const img = spr[Math.round(u * (RAMP - 1))];
      // FINE GRAIN, not blobs. Two draws: a soft halo and a small bright core.
      // A single large sprite draw made every mote a 25px smudge and the
      // vortex read as fog. The halo carries the glow, the core carries the
      // "point of light".
      const s = motes[i].size * scale * (1 + heat * 0.35);
      g.globalAlpha = a * 0.40;
      g.drawImage(img, p.x - s * 3, p.y - s * 3, s * 6, s * 6);
      g.globalAlpha = a;
      g.drawImage(img, p.x - s * 0.8, p.y - s * 0.8, s * 1.6, s * 1.6);
    }
  }

  if (mask.flame && FLAME.flame.opacity > 0) {
    renderCatch(g, t, W, H, R);
    renderFlame(g, t, W, H, R);
  }

  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

// ============================================================================
// AUDIO — synthesised, not sampled.
// ============================================================================
// Every other sound in this app is synthesised (the bell is FM through a
// convolver; tick, warning, blip and land are oscillator plus envelope), so a
// bundle of sample files would be the one exception. Wind, whoosh, fwoomph and
// crackle are also exactly what synthesis is best at — filtered noise with
// moving filters — and doing it this way means no download weight on a phone
// at the gym, no licences to track, and every layer tunable from the config
// below rather than baked into a file.
//
// EVERYTHING IS SCHEDULED IN ONE PASS off a single t0 on the audio clock. No
// setTimeouts: the whole point of scheduling ahead on ctx.currentTime is that
// the fwoomph lands on the frame the flame forms even if the main thread
// stalls, which is exactly where particle systems and their soundtracks
// normally come apart.
const AUDIO = {
  bed:     { gain: 0.030, lp: 420 },
  wind:    { gain: 0.085, f0: 260, f1: 1500, q: 3.2, panDepth: 0.92 },
  suck:    { gain: 0.075 },
  fwoomph: { low: 0.50, air: 0.30, attack: 0.055, sub0: 74, sub1: 34 },
  fire:    { gain: 0.085, lp: 760, crackle: 0.030, crackles: 26 },
  chime:   { gain: 0.16, f: 528 },
};

const MUTE_KEY = "combify.flame.mute";
export function isMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { return false; }
}
export function setMuted(on) {
  try { localStorage.setItem(MUTE_KEY, on ? "1" : "0"); } catch (e) {}
  if (on) stopAudio();
}

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf) return noiseBuf;
  const n = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
let voices = [];
function keep(node) { voices.push(node); return node; }

export function stopAudio() {
  for (const v of voices) { try { v.stop ? v.stop() : v.disconnect(); } catch (e) {} }
  voices = [];
}

// Schedule the whole soundtrack. t0 is "sequence time zero" on the audio clock.
function playAudio() {
  if (isMuted()) return false;
  const ctx = fxContext();
  if (!ctx) { audit("flame:audio", "no context"); return false; }
  holdAudioSession();          // Web Audio is muted by the ring switch without this
  const T = FLAME.t;
  const t0 = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  keep({ stop: () => master.disconnect() });

  const src = (buf, loop) => {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = !!loop;
    return keep(s);
  };

  // ---- 1. Airy bed, as the motes drift in ----
  {
    const n = src(noise(ctx), true);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = AUDIO.bed.lp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + T.motes);
    g.gain.exponentialRampToValueAtTime(AUDIO.bed.gain, t0 + T.current);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + T.katch);
    n.connect(lp).connect(g).connect(master);
    n.start(t0 + T.motes); n.stop(t0 + T.katch + 0.1);
  }

  // ---- 2. The circling wind ----
  // The pan curve is computed from spinIntegral — the SAME function that
  // places the particles — so the sound orbits with the picture and speeds up
  // exactly as the spiral tightens, rather than merely at the same time.
  {
    const n = src(noise(ctx), true);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = AUDIO.wind.q;
    bp.frequency.setValueAtTime(AUDIO.wind.f0, t0 + T.current);
    bp.frequency.exponentialRampToValueAtTime(AUDIO.wind.f1, t0 + T.katch);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + T.current);
    g.gain.exponentialRampToValueAtTime(AUDIO.wind.gain, t0 + T.peak);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + T.katch + 0.14);

    let out = g;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      const dur = T.katch - T.current;
      const N = 256;
      const curve = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const tt = T.current + (i / (N - 1)) * dur;
        const theta = shellOmega(0.72) * 1.093 * spinIntegral(tt) * Math.PI * 2;
        curve[i] = Math.cos(theta) * AUDIO.wind.panDepth;
      }
      pan.pan.setValueCurveAtTime(curve, t0 + T.current, dur);
      g.connect(pan); out = pan;
    }
    n.connect(bp).connect(g);
    out.connect(master);
    n.start(t0 + T.current); n.stop(t0 + T.katch + 0.2);
  }

  // ---- 3. The held breath at maximum compression ----
  {
    const n = src(noise(ctx), false);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 6;
    bp.frequency.setValueAtTime(500, t0 + T.peak);
    bp.frequency.exponentialRampToValueAtTime(2600, t0 + T.katch);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + T.peak);
    g.gain.exponentialRampToValueAtTime(AUDIO.suck.gain, t0 + T.katch - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + T.katch + 0.02);
    n.connect(bp).connect(g).connect(master);
    n.start(t0 + T.peak); n.stop(t0 + T.katch + 0.05);
  }

  // ---- 4. THE FWOOMPH ----
  // A soft-attack whump plus a plume opening outward. Deliberately NOT a hit:
  // the attack is ~55ms, which is far too slow to read as an impact, and there
  // is no click, no crack and no transient spike anywhere in it. Gas igniting.
  {
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(AUDIO.fwoomph.sub0, t0 + T.katch);
    sub.frequency.exponentialRampToValueAtTime(AUDIO.fwoomph.sub1, t0 + T.katch + 0.55);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t0 + T.katch);
    sg.gain.linearRampToValueAtTime(AUDIO.fwoomph.low, t0 + T.katch + AUDIO.fwoomph.attack);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + T.katch + 0.85);
    sub.connect(sg).connect(master);
    keep(sub); sub.start(t0 + T.katch); sub.stop(t0 + T.katch + 0.9);

    const n = src(noise(ctx), false);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.setValueAtTime(300, t0 + T.katch);
    lp.frequency.exponentialRampToValueAtTime(3000, t0 + T.katch + 0.16);
    lp.frequency.exponentialRampToValueAtTime(500, t0 + T.katch + 0.9);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0 + T.katch);
    ng.gain.linearRampToValueAtTime(AUDIO.fwoomph.air, t0 + T.katch + AUDIO.fwoomph.attack * 1.4);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + T.katch + 1.0);
    n.connect(lp).connect(ng).connect(master);
    n.start(t0 + T.katch); n.stop(t0 + T.katch + 1.05);
  }

  // ---- 5. The burn: warm pad plus sparse crackle ----
  {
    const n = src(noise(ctx), true);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = AUDIO.fire.lp; lp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + T.alive - 0.1);
    g.gain.exponentialRampToValueAtTime(AUDIO.fire.gain, t0 + T.alive + 0.25);
    g.gain.setValueAtTime(AUDIO.fire.gain, t0 + T.travel);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + T.done);
    // Slow breathing on the pad so it never sits still.
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.7;
    const lg = ctx.createGain(); lg.gain.value = AUDIO.fire.gain * 0.35;
    lfo.connect(lg).connect(g.gain);
    keep(lfo); lfo.start(t0 + T.alive); lfo.stop(t0 + T.done);
    n.connect(lp).connect(g).connect(master);
    n.start(t0 + T.alive - 0.1); n.stop(t0 + T.done + 0.05);

    for (let i = 0; i < AUDIO.fire.crackles; i++) {
      const at = T.alive + Math.random() * (T.done - T.alive - 0.1);
      const c = src(noise(ctx), false);
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800 + Math.random() * 2200;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0 + at);
      cg.gain.linearRampToValueAtTime(AUDIO.fire.crackle * (0.4 + Math.random()), t0 + at + 0.004);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.05);
      c.connect(hp).connect(cg).connect(master);
      c.start(t0 + at); c.stop(t0 + at + 0.06);
    }
  }

  // ---- 6. The resolving chime, as the badge lands ----
  {
    const at = t0 + T.travel + 0.45;
    for (const [mul, lvl] of [[1, 1], [1.5, 0.42], [2, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = "sine"; o.frequency.value = AUDIO.chime.f * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(AUDIO.chime.gain * lvl, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.5);
      o.connect(g).connect(master);
      keep(o); o.start(at); o.stop(at + 1.55);
    }
  }
  audit("flame:audio", "scheduled");
  return true;
}

// ============================================================================
// The clock. One timeline drives everything.
// ============================================================================
let raf = 0, startedAt = 0, playing = false, scrubbed = null;
let onDone = null;
// Where the flame shrinks to: the badge's real position on screen, measured by
// app.js just before the sequence runs. Guessing this put the hand-off in the
// wrong place on every screen size; the badge sits in a text row whose position
// depends on the streak wording and the phone's width.
let target = null;
export function setTarget(pt) { target = pt; }

function loop(now) {
  if (!playing) return;
  const t = (now - startedAt) / 1000;
  renderAt(t);
  if (t >= FLAME.t.done) { stop(); return; }
  raf = requestAnimationFrame(loop);
}

export function play(opts = {}) {
  if (!mount()) { opts.onDone && opts.onDone(); return false; }
  stop();
  motes = buildElements(FLAME.motes.count, opts.seed || 1, FLAME.motes.size);
  filaments = buildElements(FLAME.filaments.count, (opts.seed || 1) + 37, FLAME.filaments.width);
  buildFlame(opts.seed || 1);
  onDone = opts.onDone || null;
  scrubbed = null;
  playing = true;
  startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
  audit("flame", "play");
  try { playAudio(); } catch (e) { audit("flame:audio", "failed"); }   // visual-only is a fine outcome
  raf = requestAnimationFrame(loop);
  return true;
}

export function stop() {
  playing = false;
  stopAudio();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (ctx2d) { ctx2d.setTransform(1, 0, 0, 1, 0, 0); ctx2d.clearRect(0, 0, canvas.width, canvas.height); }
  if (dimEl) dimEl.style.opacity = "0";
  const cb = onDone; onDone = null;
  if (cb) cb();
}

// Skip straight to the end state — tap anywhere, or reduced motion.
export function skip() {
  if (playing) { renderAt(FLAME.t.done); }
  stop();
  audit("flame", "skip");
}

// ---- Dev: hold the timeline at a hand-picked t ----
export function scrubTo(t) {
  if (!mount()) return;
  if (!motes.length) {
    motes = buildElements(FLAME.motes.count, 1, FLAME.motes.size);
    filaments = buildElements(FLAME.filaments.count, 38, FLAME.filaments.width);
    buildFlame(1);
  }
  playing = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  scrubbed = t;
  renderAt(t);
}
export function isScrubbing() { return scrubbed != null; }
export function setMask(name, on) { if (name in mask) mask[name] = !!on; }
export function getMask() { return { ...mask }; }
export function teardown() { stop(); unmount(); }

// A hidden tab must not burn battery drawing frames nobody sees.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing) skip();
  });
  window.addEventListener("resize", () => { if (canvas) resize(); });
}

// ---------------------------------------------------------------------------
// References for the flame drawing rules in the colour config above:
//   VFX Apprentice, "How to Draw Stylized Fire and Flames for Animation and
//     2D FX" — shape language: S-swoop, C-shapes, hooks, thick-to-thin,
//     varying sizes, the "glob of toothpaste" failure.
//     https://www.vfxapprentice.com/blog/how-to-draw-stylized-fire-flames
//   Tania Rosas Designs, "Mastering 2D Fire Animation: A Universal Process" —
//     overlapping tongues, uneven tips, per-frame shape variation.
//     https://taniarosasdesigns.com/blogs/tutorials-news/2d-fire-animation-universal-process
//   "Why CG fire looks terrible even in high-budget movies" (Boing Boing) —
//     the exposure argument: properly exposed fire reads as fake.
//     https://boingboing.net/2023/10/29/why-cg-fire-looks-terrible-even-in-high-budget-movies.html
//   TextureX, "Fire & Light Textures for VFX" — core temp vs edge temp, the
//     blackbody push (brights to white, darks to deep red), scene tinting.
//     https://www.texturex.com/fire-light-texture-techniques-vfx-motion-graphics-2026
// ---------------------------------------------------------------------------
