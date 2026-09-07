#!/usr/bin/env python3
"""
Build a placeholder cue track from a real one, for testing the player.

Copies the timings verbatim and replaces every line with a synthetic marker, so
you can exercise the language switcher, overlay rendering and sync before any
real translation exists.

The markers are deliberately not the source text. A placeholder that looks like
the track it came from tells you nothing when you switch to it — you cannot see
whether the switch fired. `[EN] cue 47` is unmistakable, and the cue number lets
you match what is on screen against the JSON when a timing looks wrong.

Usage
-----
  python make_placeholder.py --in ../public/subtitles/fr.json \
      --out ../public/subtitles/en.json --tag EN
"""

from __future__ import annotations

import argparse
import json
import os


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tag", default="EN", help="marker prefix (default EN)")
    ap.add_argument("--two-line", action="store_true",
                    help="make every 4th cue two lines, to exercise wrapping")
    args = ap.parse_args()

    with open(args.src, encoding="utf-8") as f:
        cues = json.load(f)

    out = []
    for i, c in enumerate(cues):
        dur = c["e"] - c["s"]
        text = f"[{args.tag}] cue {i} · {dur:.1f}s"
        if args.two_line and i % 4 == 3:
            text += f"\nsecond line of cue {i}"
        out.append({"s": c["s"], "e": c["e"], "t": text})

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    print(f"wrote {args.out} ({len(out)} placeholder cues)")


if __name__ == "__main__":
    main()
