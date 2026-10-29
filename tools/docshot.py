#!/usr/bin/env python3
"""docshot.py -- makes CPC screenshots fit for the docs.

    docshot.py SHOT.png -o docs/images/NAME.png   one shot
    docshot.py --refresh                          remake every copy listed in DOC_SHOTS

CPCEC's shots (--shot, --shot-dir, the test goldens) are 768x272: one row per
scanline, so they show at half height on a page. This doubles each row
(nearest neighbour, no blur) to 768x544, the shape of a real CPC screen.
Shots that already have doubled scanlines (Caprice32's 768x540) and Spectrum
shots (320x256, square pixels) are copied unchanged.

Docs link the copies in docs/images, never the goldens; after a golden
changes, run --refresh. tests/tools/test_docshot.py checks both rules.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[1]

# docs/images copy -> source shot, both relative to the repo.
DOC_SHOTS = {
    f"docs/images/lamplighter-{n}.png": f"games/lamplighter/tests/golden/464/{n}.png"
    for n in ("room09", "walk", "lit09", "title", "climb")
}


def single_scanline(im: Image.Image) -> bool:
    """True for a shot with one row per scanline (wider than twice its height)."""
    return im.width > 2 * im.height


def docshot(src: Path, dst: Path) -> tuple[int, int]:
    im = Image.open(src)
    if single_scanline(im):
        im = im.resize((im.width, im.height * 2), Image.NEAREST)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, optimize=True)
    return im.size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("shot", nargs="?", type=Path)
    ap.add_argument("-o", "--output", type=Path)
    ap.add_argument("--refresh", action="store_true", help="remake every copy in DOC_SHOTS")
    a = ap.parse_args()
    if a.refresh:
        jobs = [(REPO / s, REPO / d) for d, s in DOC_SHOTS.items()]
    elif a.shot and a.output:
        jobs = [(a.shot, a.output)]
    else:
        ap.error("give SHOT -o OUTPUT, or --refresh")
    for src, dst in jobs:
        w, h = docshot(src, dst)
        print(f"{dst}: {w}x{h}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
