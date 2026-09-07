#!/usr/bin/env python3
"""
Extract burned-in ("hard") subtitles from a video into a timed cue track.

The hard part of hardsub extraction is not the OCR, it is the timing. Running OCR
on a fixed grid of frames gives you ragged, guessed boundaries. Instead this
detects when a subtitle appears and disappears directly from the pixels, to
within one sampling step, and only then OCRs one clean frame per cue.

Detection combines three signals that together separate subtitle glyphs from
ordinary bright scenery:

  1. Colour     - glyphs are near-white and desaturated.
  2. Outline    - glyphs carry a dark border, so a subtitle pixel always has a
                  very dark pixel a few rows above or below it. Sky, walls and
                  headlights do not.
  3. Persistence- a subtitle is pixel-identical across consecutive samples while
                  the picture behind it keeps moving. This is the strongest cue
                  and it is what makes the boundaries crisp.

Cue boundaries are then refined by comparing a per-frame column signature, so two
consecutive subtitles with no blank frame between them still split correctly.

Usage
-----
  # find the band the subtitles live in, and sanity-check thresholds
  python extract_subtitles.py --video film.mp4 --calibrate

  # full extraction
  python extract_subtitles.py --video film.mp4 --lang fra \
      --out ../public/subtitles/fr.json --vtt ../public/subtitles/fr.vtt

Requires: ffmpeg on PATH, tesseract on PATH, numpy, Pillow.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

# ---------------------------------------------------------------- tunables ---

WHITE_MIN = 190        # min channel value for a glyph pixel
WHITE_SAT = 35         # max (max-min) channel spread; glyphs are grey/white
DARK_MAX = 100         # max channel value that counts as "outline dark"
OUTLINE_R = 3          # rows to look up/down for that outline
MIN_PIXELS = 220       # stable glyph pixels needed to call a frame "subtitled"
SIG_BINS = 64          # column-signature resolution
SIG_SPLIT = 0.86       # cosine similarity below this starts a new cue
MIN_DUR = 0.40         # discard cues shorter than this (seconds)
MERGE_GAP = 0.20       # bridge blank gaps up to this long (seconds)


@dataclass
class Cue:
    s: float
    e: float
    t: str = ""
    frames: list[int] = field(default_factory=list, repr=False)


# ------------------------------------------------------------------ ffmpeg ---

def probe(video: str) -> tuple[int, int, float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height:format=duration",
         "-of", "json", video],
        capture_output=True, text=True, check=True,
    ).stdout
    d = json.loads(out)
    st = d["streams"][0]
    return int(st["width"]), int(st["height"]), float(d["format"]["duration"])


def stream_band(video: str, top: int, height: int, width: int, fps: float,
                start: float = 0.0, dur: float | None = None):
    """Yield (timestamp, RGB ndarray) for the subtitle band, at `fps`."""
    cmd = ["ffmpeg", "-v", "error"]
    if start:
        cmd += ["-ss", str(start)]
    cmd += ["-i", video]
    if dur:
        cmd += ["-t", str(dur)]
    cmd += ["-vf", f"fps={fps},crop={width}:{height}:0:{top}",
            "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    nbytes = width * height * 3
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=nbytes * 8)
    i = 0
    try:
        while True:
            buf = p.stdout.read(nbytes)
            if len(buf) < nbytes:
                break
            yield start + i / fps, np.frombuffer(buf, np.uint8).reshape(height, width, 3)
            i += 1
    finally:
        p.stdout.close()
        p.wait()


# --------------------------------------------------------------- detection ---

def _dilate_rows(mask: np.ndarray, r: int) -> np.ndarray:
    """True where `mask` is True within r rows above or below."""
    out = mask.copy()
    for k in range(1, r + 1):
        out[:-k] |= mask[k:]
        out[k:] |= mask[:-k]
    return out


def glyph_mask(img: np.ndarray) -> np.ndarray:
    """Near-white, desaturated pixels that sit against a dark outline."""
    a = img.astype(np.int16)
    lo = a.min(2)
    hi = a.max(2)
    white = (lo >= WHITE_MIN) & ((hi - lo) <= WHITE_SAT)
    dark = hi <= DARK_MAX
    return white & _dilate_rows(dark, OUTLINE_R)


def signature(mask: np.ndarray) -> np.ndarray:
    """Normalised column profile — a cheap fingerprint of the rendered line."""
    cols = mask.sum(0).astype(np.float32)
    binned = cols.reshape(SIG_BINS, -1).sum(1)
    n = np.linalg.norm(binned)
    return binned / n if n else binned


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    if not a.any() or not b.any():
        return 0.0
    return float(np.dot(a, b))


def detect(video: str, top: int, height: int, width: int, fps: float,
           start: float = 0.0, dur: float | None = None,
           progress: bool = True) -> list[Cue]:
    """Find subtitle cue boundaries from pixel evidence alone."""
    times: list[float] = []
    counts: list[int] = []
    sigs: list[np.ndarray] = []

    prev: np.ndarray | None = None
    for n, (t, img) in enumerate(stream_band(video, top, height, width, fps, start, dur)):
        m = glyph_mask(img)
        # Persistence: only pixels that held still since the last sample count.
        stable = m & prev if prev is not None else np.zeros_like(m)
        prev = m
        times.append(t)
        counts.append(int(stable.sum()))
        sigs.append(signature(stable))
        if progress and n % 2000 == 0 and n:
            print(f"  ...{t/60:6.1f} min", file=sys.stderr)

    # Runs of "subtitle present", split where the rendered line changes.
    cues: list[Cue] = []
    step = 1.0 / fps
    i = 0
    while i < len(counts):
        if counts[i] < MIN_PIXELS:
            i += 1
            continue
        j = i
        frames = [i]
        while j + 1 < len(counts) and counts[j + 1] >= MIN_PIXELS:
            if cosine(sigs[j], sigs[j + 1]) < SIG_SPLIT:
                break
            j += 1
            frames.append(j)
        # The mask lags one sample (it needs two frames to become "stable"),
        # so the true appearance is one step earlier.
        cues.append(Cue(s=max(0.0, times[i] - step), e=times[j] + step, frames=frames))
        i = j + 1

    # Bridge sub-sample blanks, then drop flickers.
    merged: list[Cue] = []
    for c in cues:
        if merged and c.s - merged[-1].e <= MERGE_GAP and \
           cosine(sigs[merged[-1].frames[-1]], sigs[c.frames[0]]) >= SIG_SPLIT:
            merged[-1].e = c.e
            merged[-1].frames += c.frames
        else:
            merged.append(c)
    return [c for c in merged if c.e - c.s >= MIN_DUR]


# --------------------------------------------------------------------- OCR ---

def ocr_cues(video: str, cues: list[Cue], top: int, height: int, width: int,
             fps: float, lang: str, tessdata: str | None, progress: bool = True) -> None:
    """OCR the single cleanest frame of each cue."""
    if not shutil.which("tesseract"):
        raise SystemExit("tesseract not found on PATH")
    env = dict(os.environ)
    if tessdata:
        env["TESSDATA_PREFIX"] = os.path.abspath(tessdata)

    tmp = tempfile.mkdtemp(prefix="hardsub_")
    try:
        for n, c in enumerate(cues):
            # Middle of the cue: past any fade-in, before any fade-out.
            t = (c.s + c.e) / 2
            png = os.path.join(tmp, "f.png")
            subprocess.run(
                ["ffmpeg", "-v", "error", "-ss", str(t), "-i", video, "-frames:v", "1",
                 "-vf", f"crop={width}:{height}:0:{top}", "-y", png],
                check=True,
            )
            img = np.asarray(Image.open(png).convert("RGB"))
            m = glyph_mask(img)
            rows = np.where(m.sum(1) > 2)[0]
            cols = np.where(m.sum(0) > 0)[0]
            if not len(rows) or not len(cols):
                continue
            # Black text on white, padded and upscaled 3x — what tesseract likes.
            crop = ~m[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
            pil = Image.fromarray((crop * 255).astype(np.uint8), "L")
            pil = pil.resize((pil.width * 3, pil.height * 3), Image.LANCZOS)
            padded = Image.new("L", (pil.width + 40, pil.height + 40), 255)
            padded.paste(pil, (20, 20))
            shot = os.path.join(tmp, "ocr.png")
            padded.save(shot)

            res = subprocess.run(
                ["tesseract", shot, "stdout", "-l", lang, "--psm", "6"],
                capture_output=True, text=True, env=env,
                encoding="utf-8", errors="replace",
            )
            if res.returncode != 0:
                print(f"  tesseract failed on cue {n}: {res.stderr.strip()}", file=sys.stderr)
                continue
            lines = [ln.strip() for ln in res.stdout.splitlines() if ln.strip()]
            c.t = "\n".join(lines)
            if progress and n % 50 == 0:
                print(f"  OCR {n}/{len(cues)}", file=sys.stderr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------ output ---

def ts(sec: float) -> str:
    h, rem = divmod(max(0.0, sec), 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def write_vtt(cues: list[Cue], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for i, c in enumerate(cues, 1):
            if not c.t:
                continue
            f.write(f"{i}\n{ts(c.s)} --> {ts(c.e)}\n{c.t}\n\n")


def write_json(cues: list[Cue], path: str) -> None:
    data = [{"s": round(c.s, 3), "e": round(c.e, 3), "t": c.t} for c in cues if c.t]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=0)


# ------------------------------------------------------------------- modes ---

def calibrate(video: str, width: int, vh: float) -> None:
    """Report which rows actually hold subtitle glyphs, sampling the whole film."""
    top, height = int(vh * 0.60), int(vh * 0.40)
    acc = np.zeros(height)
    hits = 0
    print("Scanning for the subtitle band (1 frame / 4 s)...", file=sys.stderr)
    prev = None
    for t, img in stream_band(video, top, height, width, 0.25):
        m = glyph_mask(img)
        stable = m & prev if prev is not None else np.zeros_like(m)
        prev = m
        if stable.sum() >= MIN_PIXELS:
            acc += stable.sum(1)
            hits += 1
    if not hits:
        print("No subtitle-like rows found. Loosen WHITE_MIN / MIN_PIXELS.", file=sys.stderr)
        return
    acc /= hits
    rows = np.where(acc > acc.max() * 0.08)[0]
    print(f"\nFrames with subtitles: {hits}")
    print(f"Band (source rows):    {top + rows.min()} - {top + rows.max()}")
    print(f"Suggested config:      top={top + rows.min()}, "
          f"height={rows.max() - rows.min() + 1}, videoHeight={int(vh)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--calibrate", action="store_true",
                    help="locate the subtitle band and exit")
    ap.add_argument("--top", type=int, help="band top row (default: lower 22%%)")
    ap.add_argument("--height", type=int, help="band height in rows")
    ap.add_argument("--fps", type=float, default=10.0,
                    help="sampling rate; 10 gives 0.1 s boundary precision")
    ap.add_argument("--lang", default="fra", help="tesseract language (default fra)")
    ap.add_argument("--tessdata", default=os.path.join(os.path.dirname(__file__), "tessdata"))
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--duration", type=float)
    ap.add_argument("--out", help="write cue JSON here")
    ap.add_argument("--vtt", help="also write WebVTT here")
    ap.add_argument("--no-ocr", action="store_true", help="timings only")
    args = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"{tool} not found on PATH")

    w, h, dur = probe(args.video)
    print(f"{args.video}: {w}x{h}, {dur/60:.1f} min", file=sys.stderr)

    if args.calibrate:
        calibrate(args.video, w, h)
        return

    top = args.top if args.top is not None else int(h * 0.72)
    height = args.height if args.height is not None else h - top
    print(f"Band: rows {top}..{top+height} @ {args.fps} fps", file=sys.stderr)

    cues = detect(args.video, top, height, w, args.fps, args.start, args.duration)
    total = sum(c.e - c.s for c in cues)
    print(f"\nDetected {len(cues)} cues, {total/60:.1f} min of subtitled time",
          file=sys.stderr)

    if not args.no_ocr:
        ocr_cues(args.video, cues, top, height, w, args.fps, args.lang, args.tessdata)
        cues = [c for c in cues if c.t]
        print(f"OCR produced text for {len(cues)} cues", file=sys.stderr)

    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        write_json(cues, args.out)
        print(f"wrote {args.out}", file=sys.stderr)
    if args.vtt:
        write_vtt(cues, args.vtt)
        print(f"wrote {args.vtt}", file=sys.stderr)
    if not args.out and not args.vtt:
        for c in cues[:40]:
            print(f"{ts(c.s)} --> {ts(c.e)}  {c.t!r}")


if __name__ == "__main__":
    main()
