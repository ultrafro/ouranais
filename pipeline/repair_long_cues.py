#!/usr/bin/env python3
"""
Repair an existing cue track in place by re-splitting its over-long cues.

Detection compares each sample against the previous one, so a subtitle change
that fades rather than cuts can slip past and two lines land in one cue. The
timing is then wrong, and OCR samples the midpoint of the merged span -- which
is the changeover -- and reads noise. The giveaway is a long cue holding almost
no text.

This re-runs only the suspect cues rather than the whole film, so a repair takes
a couple of minutes instead of an hour.

Usage
-----
  python repair_long_cues.py --video film.mp4 --track ../public/subtitles/fr.json \
      --top 544 --height 82 --lang fra
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

import extract_subtitles as X


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--track", required=True)
    ap.add_argument("--top", type=int, required=True)
    ap.add_argument("--height", type=int, required=True)
    ap.add_argument("--lang", default="fra")
    ap.add_argument("--tessdata", default=os.path.join(os.path.dirname(__file__), "tessdata"))
    ap.add_argument("--min-dur", type=float, default=X.RESPLIT_MIN_DUR)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    w, _, _ = X.probe(args.video)
    with open(args.track, encoding="utf-8") as f:
        raw = json.load(f)
    cues = [X.Cue(s=c["s"], e=c["e"], t=c.get("t", "")) for c in raw]

    suspects = [c for c in cues if c.e - c.s >= args.min_dur]
    print(f"{len(cues)} cues, {len(suspects)} longer than {args.min_dur}s", file=sys.stderr)

    tmp = tempfile.mkdtemp(prefix="repair_")
    try:
        rebuilt = X.resplit_long_cues(args.video, cues, args.top, args.height, w, tmp)
        fresh = [c for c in rebuilt if not c.t]
        print(f"-> {len(rebuilt)} cues ({len(fresh)} need OCR)", file=sys.stderr)
        if args.dry_run:
            return
        if fresh:
            X.ocr_cues(args.video, fresh, args.top, args.height, w, 10.0,
                       args.lang, args.tessdata)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    kept = [c for c in rebuilt if c.t.strip()]
    kept.sort(key=lambda c: c.s)
    X.write_json(kept, args.track)
    vtt = os.path.splitext(args.track)[0] + ".vtt"
    if os.path.exists(vtt):
        X.write_vtt(kept, vtt)
    print(f"wrote {args.track}: {len(raw)} -> {len(kept)} cues", file=sys.stderr)


if __name__ == "__main__":
    main()
