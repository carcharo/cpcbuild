#!/usr/bin/env python3
"""make_plus_sources.py -- draws the source art for the cpcplus tests (Phase 7 P2):

  plus_ball.png  32x16, two 16x16 hardware-sprite frames (RGBA, alpha 0 =
                 transparent): frame 0 a shaded disc, frame 1 a diamond; both
                 have an asymmetric mark at the top left (the disc's highlight,
                 the diamond's corner) so the orientation is checked too.
                 Colours are 12-bit exact (each channel a multiple of 0x11).
  plus_bars.png  16x1, sixteen different 12-bit colours (none of them one of
                 the CPC's 27), the pens of the palette screen test.

The generated includes are made by tools/build_assets.sh (these three lines are
what it should run; they are not in it yet):

    python3 tools/img2cpc.py --plus-sprite --name plusball tests/conformance/assets/plus_ball.png -o tests/conformance/assets/plus_ball.bas
    python3 tools/img2cpc.py --plus-sprite --packed --name plusballpk tests/conformance/assets/plus_ball.png -o tests/conformance/assets/plus_ballpk.bas
    python3 tools/img2cpc.py --plus-palette --name plusbars tests/conformance/assets/plus_bars.png -o tests/conformance/assets/plus_bars.bas

    python3 tests/conformance/assets/make_plus_sources.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent

NAVY = (0x22, 0x22, 0x88, 255)
ORANGE = (0xFF, 0x88, 0x00, 255)
SAND = (0xFF, 0xCC, 0x44, 255)
WHITE = (0xFF, 0xFF, 0xFF, 255)
GREEN = (0x00, 0xBB, 0x66, 255)
CRIMSON = (0xCC, 0x00, 0x44, 255)
CLEAR = (0, 0, 0, 0)


def disc(x: int, y: int):
    dx, dy = x - 7.5, y - 7.5
    r = (dx * dx + dy * dy) ** 0.5
    if r > 7.6:
        return CLEAR
    if (x, y) in ((4, 4), (5, 4), (4, 5)):
        return WHITE
    if r > 6.4:
        return NAVY
    if dx + dy < -4:
        return SAND
    return ORANGE


def diamond(x: int, y: int):
    d = abs(x - 7.5) + abs(y - 7.5)
    if d > 8:
        return CLEAR
    if x < 4 and y < 2 and d <= 8:
        return WHITE
    if d > 6.5:
        return CRIMSON
    return GREEN


def main() -> None:
    ball = Image.new("RGBA", (32, 16))
    for y in range(16):
        for x in range(16):
            ball.putpixel((x, y), disc(x, y))
            ball.putpixel((16 + x, y), diamond(x, y))
    ball.save(HERE / "plus_ball.png", optimize=True)

    bars = Image.new("RGB", (16, 1))
    for i in range(16):
        r, g, b = i, (i * 5 + 3) % 16, 15 - i
        bars.putpixel((i, 0), (r * 0x11, g * 0x11, b * 0x11))
    bars.save(HERE / "plus_bars.png", optimize=True)


if __name__ == "__main__":
    main()
