# Combify

A round timer and combo caller for **Boxing With Bakr**. Set your rounds, hit
start, and Combify calls out boxing combos out loud while you shadowbox — at the
gym or at home, on a phone or a laptop.

> **Goal:** keep members training between classes. More reps at home → more
> progress → members stick around. Good for the boxer, good for the gym.

## What it does (v1)

- ⏱️ Round timer with work/rest periods and a bell
- 🥊 Calls out combos by voice and on screen
- 📈 Three levels: beginner, intermediate, advanced
- 📱 Works on phone and laptop; can be "added to home screen" like a real app
- ⚡ Works offline after the first visit

## Run it locally

It's plain HTML/CSS/JavaScript — no build step. But because it uses JavaScript
modules, open it through a tiny local server (not by double-clicking the file):

```bash
# from inside the project folder
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

## Where to edit the combos

Everything Bakr might want to change lives in one file: **`js/combos.js`**.
Add, remove, or reorder combos there and the whole app updates. Boxing
numbering used: 1 jab, 2 cross, 3 lead hook, 4 rear hook, 5 lead uppercut,
6 rear uppercut (plus `slip`, `roll`, `block`, `pivot`).

## Project layout

```
index.html        the page
css/styles.css    the look
js/app.js         the timer + bell + voice logic
js/combos.js      the combo playbook  ← edit this one
manifest.json     makes it installable as an app
sw.js             offline caching
icons/icon.svg    app icon
```

## Roadmap (ideas, not promises)

- Bakr's real combos and named "signature" combos
- Save your favorite settings
- Track sessions / a simple streak, to drive the retention goal
- A shareable gym link Bakr can hand to every member

---

Built by an assistant coach at Boxing With Bakr. First project — being built in
the open.
