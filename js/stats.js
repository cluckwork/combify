// stats.js — the training history behind streaks and session summaries.
//
// Everything lives in localStorage on the member's own device: no account, no
// server, nothing leaves the phone. Stored as per-day totals rather than a list
// of every session, so the record stays small no matter how long someone trains.
//
// All times come from Date.now() (never `new Date()` with no argument) so tests
// can control the clock and check streak logic across day boundaries.

const KEY = "combify.history.v1";

const emptyHistory = () => ({ days: {}, totals: { sessions: 0, rounds: 0, punches: 0, seconds: 0 } });

export function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || typeof raw !== "object" || !raw.days) return emptyHistory();
    return { ...emptyHistory(), ...raw, totals: { ...emptyHistory().totals, ...raw.totals } };
  } catch (e) {
    return emptyHistory(); // unreadable or storage blocked — start fresh rather than break
  }
}

export function saveHistory(h) {
  try { localStorage.setItem(KEY, JSON.stringify(h)); } catch (e) { /* storage unavailable */ }
}

// Local calendar day, not UTC — a session at 11pm should count for that evening,
// not tomorrow.
const pad = (n) => String(n).padStart(2, "0");
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const DAY_MS = 86400000;

// Record one COMPLETED work round. Partial rounds aren't counted — the numbers
// should be ones the member would agree they actually earned.
export function recordRound(h, { punches, seconds, firstOfSession }, ts = Date.now()) {
  const key = dayKey(ts);
  const day = h.days[key] || { sessions: 0, rounds: 0, punches: 0, seconds: 0 };
  day.rounds += 1;
  day.punches += punches;
  day.seconds += seconds;
  h.totals.rounds += 1;
  h.totals.punches += punches;
  h.totals.seconds += seconds;
  if (firstOfSession) { day.sessions += 1; h.totals.sessions += 1; }
  h.days[key] = day;
  h.lastTrainedAt = ts;
  return h;
}

// Consecutive days trained, counting back from today. Training yesterday but
// not yet today still counts — the streak is only broken once a full day has
// been missed, so opening the app in the morning doesn't show a scary zero.
export function currentStreak(h, ts = Date.now()) {
  const trained = (t) => {
    const d = h.days[dayKey(t)];
    return !!d && d.rounds > 0;
  };
  let cursor = ts;
  if (!trained(cursor)) {
    cursor -= DAY_MS;
    if (!trained(cursor)) return 0;
  }
  let streak = 0;
  while (trained(cursor)) { streak += 1; cursor -= DAY_MS; }
  return streak;
}

export function trainedToday(h, ts = Date.now()) {
  const d = h.days[dayKey(ts)];
  return !!d && d.rounds > 0;
}

// "6:00", "12:30" — session length reads better than raw seconds.
export function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return `${m}:${pad(s)}`;
}
