# Ouranais

A Next.js player that puts a **selectable, multi-language subtitle track on top of a
YouTube video that only has burned-in ("hard") subtitles** — plus the pipeline that
extracts those subtitles off the picture in the first place.

Some videos carry subtitles that are painted into the frames themselves. You cannot
turn them off, restyle them, translate them, or search them. This project reads them
back out and re-renders them as real, switchable cues.

## What's here

| | |
|---|---|
| `src/` | The player: YouTube IFrame embed, subtitle overlay, language switcher, and an opaque strip that hides the burned-in original so the two don't collide. |
| `pipeline/extract_subtitles.py` | Detects subtitle appear/disappear times from pixel evidence, then OCRs one clean frame per cue. |
| `pipeline/translate_cues.py` | Translates an extracted cue track into further languages. |

## How the timing works

Timing is the interesting half of the problem. Running OCR on a fixed grid of frames
gives ragged, guessed boundaries. Instead the detector finds the boundaries directly
from pixels and only *then* OCRs, using three signals:

1. **Colour** — glyphs are near-white and desaturated.
2. **Outline** — glyphs carry a dark border, so a subtitle pixel always has a very dark
   pixel a few rows above or below it. Sky, walls and headlights do not.
3. **Persistence** — a subtitle is pixel-identical across consecutive samples while the
   picture behind it keeps moving. This is the strongest signal and it is what makes
   the boundaries crisp.

Cues are then split by comparing a per-frame column signature, so two consecutive
subtitles with no blank frame between them still separate correctly. At the default
10 fps sampling the boundaries land within 0.1 s.

## Usage

Requires `ffmpeg`, `tesseract`, and Python with `numpy` + `Pillow`.

```bash
pip install -r pipeline/requirements.txt

# 1. Locate the band the subtitles occupy in your video
python pipeline/extract_subtitles.py --video film.mp4 --calibrate

# 2. Extract timings + text
python pipeline/extract_subtitles.py --video film.mp4 \
    --top 525 --height 105 --lang fra \
    --out public/subtitles/fr.json

# 3. Translate into other languages
python pipeline/translate_cues.py --in public/subtitles/fr.json \
    --from French --to English --out public/subtitles/en.json
```

Then point `src/lib/config.ts` at your video id and list the tracks you generated.

```bash
npm install
npm run dev
```

## Status — read this before you rely on it

Honest state of the code:

- **Player — working.** Embed, overlay, language switcher, hardsub masking, keyboard
  shortcuts.
- **Cue detection — working.** It reliably segments a film into cues with clean
  boundaries. Verified against a real hardsubbed feature.
- **OCR — not yet good.** The glyph mask still lets through enough high-contrast image
  edges that tesseract returns noise on busy backgrounds. The mask needs tightening
  (stroke-width filtering, and a per-video threshold sweep) before the text is
  trustworthy. `--calibrate` is the right place to start.

So: the timing half is solid, the reading half needs more work. Don't ship a track
from this without checking it.

## Subtitle data is not included

`public/subtitles/*.json` is gitignored and no cue data is committed.

The tooling here is general-purpose — it works on any video with burned-in subtitles,
including your own footage, lecture recordings, and public-domain film. But a complete
translated cue track for a commercial film is that film's entire screenplay in another
language, and publishing one is the thing that gets subtitle repositories taken down.
Run the pipeline against your own copy and keep the output local.

## License

MIT — see [LICENSE](LICENSE). Applies to the code in this repository. It does not grant
any rights in whatever video you point it at.
