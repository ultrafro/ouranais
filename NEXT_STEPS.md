# What to do once `fr.json` exists

The extraction writes two files:

```
public/subtitles/fr.json    # what the player reads
public/subtitles/fr.vtt     # same cues, standard WebVTT
```

Both are gitignored. Everything below assumes they are there.

---

## 1. See it running

```bash
npm install
npm run dev
```

Open http://localhost:3000. The language dropdown will offer **Français**; the other
entries are listed in `src/lib/config.ts` but have no data behind them yet, so picking
one shows a "no track" warning rather than failing silently.

Two things worth checking immediately:

- **Sync.** Scrub to a few different points. Our overlay should appear and disappear in
  step with the burned-in text underneath. If it is consistently early or late, the
  band or the sample rate is off, not the timing logic.
- **"Hide burned-in subtitles".** Leave it on. It paints an opaque strip over rows
  544–625 of the source so the original French does not show through beneath ours. If
  you see a sliver of the original peeking out, adjust `hardsubBand` in
  `src/lib/config.ts`.

---

## 2. Judge the French before building on it

This matters more than it sounds. Every error here propagates into every language you
generate afterwards, and they are much harder to spot once translated.

```bash
python -c "
import json,io,sys
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
d=json.load(open('public/subtitles/fr.json',encoding='utf-8'))
print(len(d),'cues')
for c in d[::40]: print(f\"{c['s']:8.1f}  {c['t']!r}\")
"
```

Sampling every 40th cue walks the whole film instead of one stretch. Read for:

- **Letter-level corruption** — real words with wrong letters. This is the known failure
  and it clusters on bright, textured backgrounds. Daylight exteriors are the worst
  case; night interiors are usually verbatim.
- **Phantom lines** — a cue with a second line of nonsense under a good first line.
  Mostly suppressed, not entirely.
- **Missing commas.** Still inconsistent.

A rough rule: if fewer than ~1 in 20 sampled cues is corrupted, it is a reasonable base.
Much worse than that and the OCR is worth another pass first (see §4).

### Measured on the first full run

511 cues, 17.9 min of subtitled time across a 123.2 min film.

| | |
|---|---|
| vowel-less tokens (letter-scramble signature) | 2 of 2519 — 0.08% |
| cues that are pure garbage | 0 |
| overlapping cues | 2 of 511 |
| median cue duration | 1.90 s |
| missed subtitles, 24 uncovered points checked | 0 |

Text quality is good and coverage looks sound.

### How not to measure recall

A first pass at this reported ~81% recall and it was wrong, in a way worth recording
because the mistake is easy to repeat.

The proxy was "single-frame `glyph_mask()` over `MIN_PIXELS` means a subtitle is present
here", compared against the track. That fires on two things that are not subtitles:

- **bright scenery** — a sunlit table or a white wall clears the pixel threshold easily;
- **the end credits** — genuinely text, genuinely not subtitles.

Every one of the nine "missed" cues it flagged turned out to be one of those. Sampling in
the other direction instead — take points the track calls unsubtitled, render the band,
and look — found no misses at all in 24 samples.

If you need a recall number, verify against the pixels. A pixel-count heuristic cannot
distinguish subtitle text from a bright background, which is the whole difficulty of the
problem and precisely what it is being asked to adjudicate.

---

## 3. Fix what is wrong

Cue text is plain JSON — `s` and `e` are seconds, `t` is the text, `\n` splits lines.
Editing by hand is completely reasonable for a few dozen bad cues.

To see what tesseract actually saw for a bad cue, re-run just that window with `--dump`:

```bash
python pipeline/extract_subtitles.py --video film.mp4 \
    --top 544 --height 82 --start 2600 --duration 60 \
    --lang fra --dump /tmp/cues
```

Every image handed to tesseract lands in `/tmp/cues`. If the image is clean and the
text is wrong, that is a tesseract problem. If the image is speckled or missing
letters, that is the mask, and §4 is where to look.

---

## 4. If the OCR needs to be better

Where I would start, in order:

1. **Stop hand-binarising.** The single most promising change. Instead of feeding
   tesseract our own black-and-white mask, hand it a contrast-stretched greyscale crop
   of the band and let its adaptive thresholding do the work. Our mask is what fails on
   busy backgrounds; tesseract's own binarisation is better at exactly that.
2. **Per-cue threshold sweep.** Run the mask at several values of `WHITE_MIN` and keep
   whichever result tesseract reports the highest mean confidence for
   (`tesseract ... tsv` gives per-word confidence).
3. **A dictionary pass.** These are ordinary French sentences; a spellchecker restricted
   to edit-distance-1 corrections would catch most letter-level corruption without
   inventing text.

Two things that look right and measurably hurt — both tried, both reverted:

- An overlap guard rejecting loose-mask blobs already covered by the strict mask. A
  cedilla touches its letter, so the guard drops exactly what it was added to recover.
- Widening the band without the two-threshold split. Drags in scenery faster than it
  recovers marks.

---

## 5. Other languages

`pipeline/translate_cues.py` takes the French track and writes another language,
timings untouched:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python pipeline/translate_cues.py \
    --in public/subtitles/fr.json \
    --from French --to English \
    --out public/subtitles/en.json
```

Then the same for `--to Spanish --out public/subtitles/es.json`, and so on. The codes in
`src/lib/config.ts` (`en`, `es`, `ar`, `de`) are what the player looks for, so the output
filename has to match.

Caveats worth knowing before you run it:

- **This script has never been executed.** I never had a key to run it against. Expect to
  shake out a bug on first contact; run it against a 20-cue slice before the full file.
- It sends cues in batches of 40 and keeps the source text for any batch that comes back
  the wrong length, so a failed batch degrades to French rather than silently dropping
  lines. Grep the output for French if a batch misbehaves.
- Garbage in, garbage out. A corrupted French cue becomes a confidently wrong English
  one, which is harder to notice. Clean §2 up first.

---

## 6. Scope note

`public/subtitles/` is gitignored and should stay that way. The tooling in this repo is
general-purpose and MIT; a finished cue track for a specific commercial film is a
different kind of artifact, and publishing one is what gets subtitle repositories taken
down. Keep generated tracks local to your own copy.
