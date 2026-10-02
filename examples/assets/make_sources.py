#!/usr/bin/env python3
"""make_sources.py -- one-off: draws the source art for examples/bounce.bas
(bgtiles.png, balls.png, level.tmx) exactly as the demo's own BASIC code
used to build it at run time (MakeTiles, MakeMap, MakeBall). Colours are
the firmware colours of bounce.pal's pens, so img2cpc maps them back to
the same pens. Run from anywhere; writes next to this file.

    python3 examples/assets/make_sources.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
PAL = [0, 1, 2, 11, 20, 26, 3, 6, 15, 24, 9, 18, 4, 8, 13, 10]  # bounce.pal


def rgb(pen: int) -> tuple[int, int, int]:
    n = PAL[pen]
    lv = (0x00, 0x80, 0xFF)
    return lv[n // 3 % 3], lv[n // 9], lv[n % 3]  # firmware n = 9G + 3R + B


def tile_pen(t: int, x: int, y: int) -> int:
    if t == 0:  # dark blue with a faint dot
        return 2 if x == 3 and y == 3 else 1
    if t == 1:  # brick, black mortar
        if y == 3 or y == 7 or (y < 3 and x == 7) or (y > 3 and x == 3):
            return 0
        if y == 0 or y == 4:
            return 8
        return 7
    return 3 if x < 2 and y < 2 else 2  # tile 2: lighter blue, sky-blue corner


def make_tiles() -> None:
    im = Image.new("RGB", (24, 8))
    for t in range(3):
        for y in range(8):
            for x in range(8):
                im.putpixel((t * 8 + x, y), rgb(tile_pen(t, x, y)))
    im.save(HERE / "bgtiles.png")


def make_balls() -> None:
    """Three 8x16 balls side by side; transparent outside the circle."""
    im = Image.new("RGBA", (24, 16), (0, 0, 0, 0))
    for b, (dark, mid, lite) in enumerate(((6, 7, 8), (10, 11, 9), (12, 13, 4))):
        for py in range(16):
            for px in range(8):
                d = (4 * px - 14) ** 2 + (2 * py - 15) ** 2
                h = (4 * px - 8) ** 2 + (2 * py - 9) ** 2
                if d > 225:
                    continue
                if h < 20:
                    pen = 5
                elif h < 90:
                    pen = lite
                elif d < 150:
                    pen = mid
                else:
                    pen = dark
                im.putpixel((b * 8 + px, py), (*rgb(pen), 255))
    im.save(HERE / "balls.png")


def make_level() -> None:
    w, h = 20, 25
    rows = []
    for y in range(h):
        row = []
        for x in range(w):
            if x == 0 or y == 0 or x == w - 1 or y == h - 1:
                t = 1
            elif (x + y) & 1:
                t = 2
            else:
                t = 0
            row.append(str(t + 1))  # gid = tile number + firstgid (1)
        rows.append(",".join(row))
    (HERE / "level.tmx").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<map version="1.10" orientation="orthogonal" renderorder="right-down" width="{w}" height="{h}"'
        ' tilewidth="8" tileheight="8" infinite="0" nextlayerid="2" nextobjectid="1">\n'
        ' <tileset firstgid="1" name="bgtiles" tilewidth="8" tileheight="8" tilecount="3" columns="3">\n'
        '  <image source="bgtiles.png" width="24" height="8"/>\n'
        " </tileset>\n"
        f' <layer id="1" name="background" width="{w}" height="{h}">\n'
        '  <data encoding="csv">\n' + ",\n".join(rows) + "\n"
        "</data>\n </layer>\n</map>\n"
    )


if __name__ == "__main__":
    make_tiles()
    make_balls()
    make_level()
