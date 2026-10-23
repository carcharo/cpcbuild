#!/usr/bin/env python3
"""make_finetiles_png.py -- draws the source art for examples/finetiles.bas:
finelevel.png (the 40 x 25 cell level, 160 x 200 pixels, drawn from 4 x 8
tiles) and finesprites.png (three 16 x 16 sprites side by side, with alpha).
Colours are the firmware colours of bounce.pal's pens, so img2cpc maps them
back to the same pens (tools/build_assets.sh converts both). Run from
anywhere; writes next to this file.

    python3 examples/assets/make_finetiles_png.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
PAL = [0, 1, 2, 11, 20, 26, 3, 6, 15, 24, 9, 18, 4, 8, 13, 10]  # bounce.pal

# pen names, for reading the drawing code
BLACK, BLUE, BBLUE, SKY, BCYAN, BWHITE, RED, BRED = range(8)
ORANGE, BYELLOW, GREEN, BGREEN, MAGENTA, BMAGENTA, WHITE, CYAN = range(8, 16)

W, H = 40, 25  # cells (4 x 8 pixels each)


def rgb(pen: int) -> tuple[int, int, int]:
    n = PAL[pen]
    lv = (0x00, 0x80, 0xFF)
    return lv[n // 3 % 3], lv[n // 9], lv[n % 3]  # firmware n = 9G + 3R + B


def cell_pen(kind: str, x: int, y: int) -> int:
    """Pen of pixel (x, y), 0-3 by 0-7, of a tile of the given kind."""
    if kind == "sky":
        return BLUE
    if kind == "star":  # one bright pixel, two sizes
        return BBLUE if (x, y) == (1, 3) else BLUE
    if kind == "star2":
        return SKY if (x, y) in ((2, 5), (2, 4)) else BLUE
    if kind in ("brick0", "brick1"):  # 8 x 4 pixel bricks, joints alternate
        if y in (3, 7):
            return BLACK
        joint = 0 if (kind == "brick0") == (y < 3) else 2
        if x == joint:
            return BLACK
        return BYELLOW if y in (0, 4) else ORANGE
    if kind in ("grass0", "grass1"):
        if y < 3:
            blades = (0, 2) if kind == "grass0" else (1, 3)
            if y == 0:
                return BGREEN if x in blades else BLUE
            return BGREEN if y == 1 else GREEN
        return RED if (x + y) % 3 else ORANGE
    if kind in ("dirt0", "dirt1"):
        speck = (1, 2) if kind == "dirt0" else (3, 5)
        return ORANGE if (x, y) == speck else (BLACK if y == 7 else RED)
    if kind == "ladder":  # rails at the edges, rungs on rows 1 and 5
        if x in (0, 3):
            return BWHITE
        return BYELLOW if y in (1, 5) else BLUE
    raise ValueError(kind)


def level() -> list[list[str]]:
    g = [["sky"] * W for _ in range(H)]
    # a few stars, pseudo-randomly scattered through the sky
    s = 7
    for _ in range(46):
        s = (s * 75 + 74) % 65537
        c, r = 1 + s % (W - 2), 1 + (s >> 6) % (H - 3)
        g[r][c] = "star" if s & 1 else "star2"

    def platform(r: int, c0: int, c1: int) -> None:
        for c in range(c0, c1 + 1):
            g[r][c] = "grass%d" % (c & 1)
            g[r + 1][c] = "dirt%d" % ((c >> 1) & 1)

    def ladder(c: int, r0: int, r1: int) -> None:
        for r in range(r0, r1 + 1):
            g[r][c] = "ladder"

    platform(22, 1, 38)
    platform(17, 4, 14)
    platform(17, 25, 36)
    platform(12, 12, 27)
    platform(7, 2, 10)
    platform(7, 30, 37)
    ladder(7, 9, 16)
    ladder(20, 14, 21)
    ladder(33, 9, 16)
    ladder(33, 19, 21)
    # the border: brick all round
    for c in range(W):
        for r in (0, H - 1):
            g[r][c] = "brick%d" % ((c + r) & 1)
    for r in range(H):
        for c in (0, W - 1):
            g[r][c] = "brick%d" % ((c + r) & 1)
    return g


def make_level() -> None:
    g = level()
    im = Image.new("RGB", (W * 4, H * 8))
    for r in range(H):
        for c in range(W):
            for y in range(8):
                for x in range(4):
                    im.putpixel((c * 4 + x, r * 8 + y), rgb(cell_pen(g[r][c], x, y)))
    im.save(HERE / "finelevel.png")


def make_sprites() -> None:
    """A gem, a blob and a ghost, 16 x 16 each; transparent outside."""
    im = Image.new("RGBA", (48, 16), (0, 0, 0, 0))

    def put(f: int, x: int, y: int, pen: int) -> None:
        im.putpixel((f * 16 + x, y), rgb(pen) + (255,))

    for y in range(16):
        for x in range(16):
            dx, dy = abs(x - 7.5), abs(y - 7.5)
            # 0: gem -- a diamond, lit from the top left
            d = dx + dy
            if d <= 7.5:
                if d > 6:
                    put(0, x, y, BBLUE)
                elif x < 8 and y < 8:
                    put(0, x, y, BWHITE)
                elif x < 8 or y < 8:
                    put(0, x, y, BCYAN)
                else:
                    put(0, x, y, CYAN)
            # 1: blob -- a round red body with eyes
            r2 = dx * dx + dy * dy
            if r2 <= 7.6 ** 2:
                pen = BRED if (x + y) < 17 else RED
                if r2 > 6.4 ** 2:
                    pen = RED if (x + y) < 17 else BLACK
                if x in (4, 5, 9, 10) and 4 <= y <= 8:
                    pen = BWHITE
                    if y >= 7 and x in (5, 10):
                        pen = BLACK
                put(1, x, y, pen)
            # 2: ghost -- a dome, straight sides, a wavy hem
            top = y < 8 and (dx * dx + (y - 7.5) ** 2) <= 7.6 ** 2
            low = 8 <= y <= 14 and dx <= 7.5
            if y == 15:
                low = dx <= 7.5 and (x // 2) % 2 == 0
            elif y == 14:
                low = dx <= 7.5 and (x // 2) % 2 == 1 or (x // 2) % 2 == 0
            if top or low:
                pen = BMAGENTA if x < 11 else MAGENTA
                if x in (4, 5, 9, 10) and 5 <= y <= 8:
                    pen = BWHITE
                    if y >= 7 and x in (5, 10):
                        pen = BBLUE
                put(2, x, y, pen)
    im.save(HERE / "finesprites.png")


if __name__ == "__main__":
    make_level()
    make_sprites()
