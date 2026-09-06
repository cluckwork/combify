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
  flame:     { opacity: 1.00 },                                                // phase 3

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
  const y = H * V.cy - (m.y0 * E + rise) * R + Math.sin(theta) * r * R * tilt;
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
            const a = env * F.opacity * taper * taper * (0.30 + near * 0.70)
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
    const spr = buildSprites();
    for (let i = 0; i < motes.length; i++) {
      const p = moteAt(motes[i], t, W, H, R);
      if (!p) continue;
      // Depth: nearer motes are bigger and brighter. This is the whole reason
      // a 2D canvas reads as a rotating column rather than a flat ring.
      const near = (p.depth + 1) / 2;
      const scale = 0.72 + near * 0.6;
      const nearAxis = clamp01(1 - p.r / FLAME.vortex.radius);
      const a = env * M.opacity * (0.35 + near * 0.65) * (0.5 + nearAxis * 0.5);
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

  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

// ============================================================================
// The clock. One timeline drives everything — visuals now, audio in phase 4.
// ============================================================================
let raf = 0, startedAt = 0, playing = false, scrubbed = null;
let onDone = null;

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
  onDone = opts.onDone || null;
  scrubbed = null;
  playing = true;
  startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
  audit("flame", "play");
  raf = requestAnimationFrame(loop);
  return true;
}

export function stop() {
  playing = false;
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
