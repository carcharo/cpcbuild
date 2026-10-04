#!/usr/bin/env python3
"""make_assets.py -- draws the source art of the CPC Plus demo
(examples/plusdemo.bas):

  sprites.png    four 16x16 frames: a ball, a star, a gem and a heart, 13
                 colours in all (the ASIC's sprite palette has 15). Colours are
                 12-bit: every channel is a multiple of 0x11, so
                 img2cpc.py --plus-sprite keeps them exactly.
  landscape.png  64x104, mode 1: one period of the scrolling landscape (it
                 repeats sideways: the left and right edges join). Pen 0 black
                 (the sky, where the raster bars show), 1 white (stars), 2 purple
                 (hills), 3 teal (ground): the demo sets the real 12-bit colours.

    python3 examples/plusdemo/make_assets.py
    (examples/plusdemo/build.sh then converts them to sprites.bas and
    landscape.bas with img2cpc.py)
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent


def col(rgb12: str):
    return tuple(int(c, 16) * 17 for c in rgb12)


OUT = col("301")
R = [col("A21"), col("F42"), col("F85"), col("FCA")]
S = [col("FB0"), col("FE0"), col("FF9")]
G = [col("08C"), col("0CF"), col("9FF")]
H = [col("D14"), col("F36"), col("FAB")]


def frame(inside, shade):
    """16x16 RGBA: pixels where inside(x, y) with an OUT outline, colour from shade(x, y)."""
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    ins = [[inside(x, y) for x in range(16)] for y in range(16)]
    for y in range(16):
        for x in range(16):
            if not ins[y][x]:
                continue
            edge = any(not (0 <= x + dx < 16 and 0 <= y + dy < 16 and ins[y + dy][x + dx])
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            im.putpixel((x, y), (*(OUT if edge else shade(x, y)), 255))
    return im


def ball():
    def inside(x, y):
        return (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 7.6 ** 2

    def shade(x, y):
        d = ((x - 5.5) ** 2 + (y - 5.0) ** 2) ** 0.5
        return R[3] if d < 2.2 else R[2] if d < 5 else R[1] if d < 8.5 else R[0]
    return frame(inside, shade)


def star():
    import math
    pts = []
    for i in range(10):
        r = 7.8 if i % 2 == 0 else 3.4
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((7.5 + r * math.cos(a), 8.3 + r * math.sin(a)))

    def inside(x, y):
        n, j = False, len(pts) - 1
        for i in range(len(pts)):
            xi, yi = pts[i]
            xj, yj = pts[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                n = not n
            j = i
        return n

    def shade(x, y):
        return S[2] if x + y < 14 and x > 5 and x < 9 else S[1] if x + y < 17 else S[0]
    return frame(inside, shade)


def gem():
    def inside(x, y):
        return abs(x - 7.5) / 7.8 + abs(y - 8.0) / 8.0 <= 1.0

    def shade(x, y):
        if y < 5:
            return G[2] if x < 8 else G[1]
        return G[1] if x < 8 else G[0]
    return frame(inside, shade)


def heart():
    def inside(x, y):
        u, v = (x - 7.5) / 7.2, (7.2 - y) / 6.4
        return (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0

    def shade(x, y):
        d = ((x - 4.5) ** 2 + (y - 4.0) ** 2) ** 0.5
        return H[2] if d < 1.8 else H[1] if x + y < 17 else H[0]
    return frame(inside, shade)


def landscape():
    """One 64x104 period: the shapes are triangle waves, so it tiles sideways."""
    pens = [(0, 0, 0), (255, 255, 255), (128, 0, 128), (0, 128, 128)]
    stars = {(5, 6), (23, 13), (41, 4), (52, 21), (14, 27), (33, 9), (60, 17), (47, 33),
             (9, 38), (29, 22), (56, 41), (38, 49), (19, 12), (3, 30)}
    im = Image.new("RGB", (64, 104))
    for px in range(64):
        top = 38 + abs(px - 32) // 2 + abs((px * 3) % 64 - 32) // 4
        gnd = 88 + abs((px * 2) % 64 - 32) // 8
        for y in range(104):
            pen = 3 if y >= gnd else 2 if y >= top else 1 if (px, y) in stars else 0
            im.putpixel((px, y), pens[pen])
    return im


landscape().save(HERE / "landscape.png")

sheet = Image.new("RGBA", (64, 16), (0, 0, 0, 0))
for i, f in enumerate((ball(), star(), gem(), heart())):
    sheet.paste(f, (16 * i, 0))
sheet.save(HERE / "sprites.png")
