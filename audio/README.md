# Voice clips

Combify calls out combos using the audio files in this folder. Every combo is
just a sequence of these words, so **you only need to create each word once** —
the app chains them into any combo automatically.

## What to add

Generate these **12 clips** in ElevenLabs with your chosen voice, one short
word each, and drop them in this folder with these **exact names**:

| Say this word | File name |
| --- | --- |
| "one"   | `1.mp3` |
| "two"   | `2.mp3` |
| "three" | `3.mp3` |
| "four"  | `4.mp3` |
| "five"  | `5.mp3` |
| "six"   | `6.mp3` |
| "seven" | `7.mp3` |
| "eight" | `8.mp3` |
| "slip"  | `slip.mp3` |
| "roll"  | `roll.mp3` |
| "block" | `block.mp3` |
| "pivot" | `pivot.mp3` |

That's it — 12 files, made once. They cover every combo the app will ever call.

## Tips for clips that chain well

- Keep each clip **tight** — trim silence at the start and end so words don't
  drag. Boxing callouts are punchy ("one! two! slip!"), which is exactly how
  chained clips sound best.
- Say each word on its own, at a consistent volume and energy.
- **`.mp3`** is what `js/app.js` expects (`CLIP_EXT`). If you export a different
  format, update `CLIP_EXT` to match.

## How it works

- On load, the app checks whether these clips exist.
- If they do → it uses your ElevenLabs voice and ignores the robotic built-in one.
- If they're missing → it quietly falls back to the browser's text-to-speech, so
  the app still works before you've added the clips.

No code changes needed once the files are named correctly and placed here.

## Getting the files here

This project runs in an environment with no direct access to your computer's
files. To transfer clips over:

```bash
cd ~/Desktop/"your-folder-name"
zip -r combify-audio.zip . -x ".*"
curl -s -w "\n%{http_code}\n" -F "file=@combify-audio.zip" https://tmpfiles.org/api/v1/upload
```

Paste the resulting link back in chat and it'll be pulled straight into this
folder.
