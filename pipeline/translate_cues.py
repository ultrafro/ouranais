#!/usr/bin/env python3
"""
Translate an extracted cue track into another language, preserving timings.

Cues are sent in small batches with their neighbours intact so the model can use
surrounding dialogue for context — subtitles are full of pronouns and fragments
that are ambiguous line-by-line. Timings are never touched; only `t` changes.

Usage
-----
  export ANTHROPIC_API_KEY=sk-ant-...
  python translate_cues.py --in ../public/subtitles/fr.json \
      --from French --to English --out ../public/subtitles/en.json

Requires: `pip install anthropic`
"""

from __future__ import annotations

import argparse
import json
import os
import sys

BATCH = 40
MODEL = "claude-sonnet-5"

PROMPT = """You are translating subtitles for a film from {src} to {dst}.

You will receive a JSON array of numbered lines. Return a JSON array of the same
length, in the same order, where each element is the {dst} translation of the
corresponding line.

Rules:
- Keep it natural and idiomatic, the way a professional subtitler would write it.
- Preserve the line breaks (\\n) within a cue where they still make sense.
- Keep it short. Subtitles are read at a glance.
- Preserve names and places as-is.
- If a line is an unreadable OCR fragment, return your best reconstruction, or an
  empty string if there is nothing recoverable.
- Return ONLY the JSON array, no commentary."""


def translate(client, cues: list[dict], src: str, dst: str) -> list[str]:
    out: list[str] = []
    for i in range(0, len(cues), BATCH):
        batch = cues[i : i + BATCH]
        payload = json.dumps([c["t"] for c in batch], ensure_ascii=False, indent=0)
        msg = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=PROMPT.format(src=src, dst=dst),
            messages=[{"role": "user", "content": payload}],
        )
        text = msg.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        try:
            got = json.loads(text)
        except json.JSONDecodeError:
            print(f"  batch {i//BATCH}: unparseable reply, keeping source", file=sys.stderr)
            got = [c["t"] for c in batch]
        if len(got) != len(batch):
            print(f"  batch {i//BATCH}: length mismatch "
                  f"({len(got)} vs {len(batch)}), keeping source", file=sys.stderr)
            got = [c["t"] for c in batch]
        out.extend(str(g) for g in got)
        print(f"  {min(i+BATCH, len(cues))}/{len(cues)}", file=sys.stderr)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src_file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--from", dest="src_lang", default="French")
    ap.add_argument("--to", dest="dst_lang", required=True)
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("set ANTHROPIC_API_KEY")
    try:
        import anthropic
    except ImportError:
        raise SystemExit("pip install anthropic")

    with open(args.src_file, encoding="utf-8") as f:
        cues = json.load(f)
    print(f"translating {len(cues)} cues -> {args.dst_lang}", file=sys.stderr)

    texts = translate(anthropic.Anthropic(), cues, args.src_lang, args.dst_lang)
    result = [
        {"s": c["s"], "e": c["e"], "t": t}
        for c, t in zip(cues, texts)
        if t.strip()
    ]
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=0)
    print(f"wrote {args.out} ({len(result)} cues)", file=sys.stderr)


if __name__ == "__main__":
    main()
