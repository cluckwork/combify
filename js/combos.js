// combos.js — the "playbook".
// This is the ONE file Bakr can help edit. Add/remove combos here and the
// whole app updates. No other code needs to change.

// Every move has a display label (shown on screen) and a "say" word
// (what the voice calls out). Boxing numbering: 1 jab, 2 cross, 3 lead hook,
// 4 rear hook, 5 lead uppercut, 6 rear uppercut.
export const MOVES = {
  "1": { label: "1", say: "one" },
  "2": { label: "2", say: "two" },
  "3": { label: "3", say: "three" },
  "4": { label: "4", say: "four" },
  "5": { label: "5", say: "five" },
  "6": { label: "6", say: "six" },
  "7": { label: "7", say: "seven" },
  "8": { label: "8", say: "eight" },
  "slip": { label: "slip", say: "slip" },
  "roll": { label: "roll", say: "roll" },
  "block": { label: "block", say: "block" },
  "pivot": { label: "pivot", say: "pivot" },
};

// Combos grouped by level. Each combo is a list of move keys from MOVES above.
// Swap these for Bakr's actual combos whenever you're ready.
//   beginner     — short, punches only (2-3 moves)
//   intermediate — longer, mixes in slips/rolls and higher numbers (4-6 moves)
//   advanced     — long, heavy defense + pivots + body shots (6-8 moves)
export const COMBOS = {
  beginner: [
    ["1", "2"],
    ["1", "1", "2"],
    ["1", "2", "3"],
    ["2", "3", "2"],
    ["1", "2", "5"],
    ["1", "6", "3"],
    ["3", "4"],
    ["2", "3", "2"],
  ],
  intermediate: [
    ["1", "2", "3", "4"],
    ["1", "2", "5", "2"],
    ["1", "2", "slip", "2", "3"],
    ["2", "3", "2", "roll", "3"],
    ["1", "6", "3", "2", "4"],
    ["1", "2", "7", "8"],
    ["1", "1", "2", "5", "2"],
    ["1", "2", "slip", "2", "5", "2"],
    ["3", "4", "5", "6"],
  ],
  advanced: [
    ["1", "2", "slip", "2", "3", "4", "roll", "2"],
    ["1", "1", "2", "5", "4", "3", "2"],
    ["2", "3", "2", "roll", "3", "6", "pivot"],
    ["1", "2", "5", "2", "slip", "6", "3", "4"],
    ["1", "6", "3", "2", "block", "2", "7", "8"],
    ["1", "2", "3", "2", "pivot", "1", "2", "3"],
    ["1", "2", "7", "8", "5", "2", "slip", "2"],
    ["3", "4", "5", "6", "roll", "2", "3"],
  ],
};

// Pick a random combo for a level. Returns the raw list of move keys.
export function randomCombo(level) {
  const list = COMBOS[level] || COMBOS.beginner;
  return list[Math.floor(Math.random() * list.length)];
}

// Turn a combo into the text shown on screen, e.g. "1 - 2 - slip - 2"
export function comboToText(combo) {
  return combo.map((key) => MOVES[key].label).join(" - ");
}

// Turn a combo into words for the voice, e.g. "one, two, slip, two"
export function comboToSpeech(combo) {
  return combo.map((key) => MOVES[key].say).join(", ");
}
