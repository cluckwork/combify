# Voice clips

Combify calls out combos using the audio files in this folder. Every combo is
just a sequence of these words, so **you only need to create each word once** —
the app chains them into any combo automatically.

## What to add

Generated with the "dawg" voice from VoiceBox, one short word each, named with
these **exact names** (already in place as of 2026-07-22):

| Say this word | File name |
| --- | --- |
| "one"   | `1.wav` |
| "two"   | `2.wav` |
| "three" | `3.wav` |
| "four"  | `4.wav` |
| "five"  | `5.wav` |
| "six"   | `6.wav` |
| "seven" | `7.wav` |
| "eight" | `8.wav` |
| "slip"  | `slip.wav` |
| "roll"  | `roll.wav` |
| "block" | `block.wav` |
| "pivot" | `pivot.wav` |

That's it — 12 files, made once. They cover every combo the app will ever call.

## Tips for clips that chain well

- Keep each clip **tight** — trim silence at the start and end so words don't
  drag. Boxing callouts are punchy ("one! two! slip!"), which is exactly how
  chained clips sound best.
- Say each word on its own, at a consistent volume and energy.
- **`.wav`** is what `js/app.js` expects (`CLIP_EXT`). If you regenerate clips in
  a different format, update `CLIP_EXT` to match.

## How it works

- On load, the app checks whether these clips exist.
- If they do → it uses your voice and ignores the robotic built-in one.
- If they're missing → it quietly falls back to the browser's text-to-speech, so
  the app still works before you've added the clips.

No code changes needed once the files are named correctly and placed here.
