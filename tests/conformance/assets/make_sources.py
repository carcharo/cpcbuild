#!/usr/bin/env python3
"""make_sources.py -- draws the source art for tests/conformance/cb_assets.bas.
The patterns are simple formulas, which cb_assets.bas repeats on its own to
work out the screen bytes it expects:

  plain sprite   pen = (x + k*y) AND (npens-1), k = 2 (mode 1), 3 (mode 0)
  masked sprite  transparent where (x + y) is even, else pen
                 1 + (x + 2*y) MOD (npens-1)
  picture        cell (cx, cy) is tile kind k = (cx + 2*cy) MOD 3, whose
                 pixel (x, y) has pen ((k+1)*x + y) AND 3
  level.tmx      the same picture as a map (base64+zlib, one flipped cell)

Pens are drawn in the firmware colour PAL[pen] (mode 1: 0, 26, 6, 18; mode 0:
7*pen MOD 27).
    python3 tests/conformance/assets/make_sources.py
"""
from __future__ import annotations

import base64
import struct
import zlib
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
PAL1 = [0, 26, 6, 18]
PAL0 = [(7 * p) % 27 for p in range(16)]


def rgb(n: int) -> tuple[int, int, int]:
    lv = (0x00, 0x80, 0xFF)
    return lv[n // 3 % 3], lv[n // 9], lv[n % 3]  # firmware n = 9G + 3R + B


def plain(w, h, pal, k, name):
    im = Image.new("RGB", (w, h))
    for y in range(h):
        for x in range(w):
            im.putpixel((x, y), rgb(pal[(x + k * y) & (len(pal) - 1)]))
    im.save(HERE / name)


def masked(w, h, pal, name):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(h):
        for x in range(w):
            if (x + y) % 2:
                im.putpixel((x, y), (*rgb(pal[1 + (x + 2 * y) % (len(pal) - 1)]), 255))
    im.save(HERE / name)


def kind(cx, cy):
    return (cx + 2 * cy) % 3


def picture():
    im = Image.new("RGB", (32, 16))
    for y in range(16):
        for x in range(32):
            k = kind(x // 8, y // 8)
            im.putpixel((x, y), rgb(PAL1[((k + 1) * (x % 8) + y % 8) & 3]))
    im.save(HERE / "pic1.png")


def level():
    gids = [kind(cx, cy) + 1 for cy in range(2) for cx in range(4)]
    gids[3] |= 0x80000000  # a flipped cell: still tile kind 0
    raw = base64.b64encode(zlib.compress(struct.pack("<8I", *gids))).decode()
    (HERE / "level.tmx").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<map version="1.10" orientation="orthogonal" width="4" height="2" tilewidth="8" tileheight="8" infinite="0">\n'
        ' <tileset firstgid="1" name="pic1" tilewidth="8" tileheight="8" tilecount="3" columns="3">\n'
        '  <image source="pic1.png" width="24" height="8"/>\n </tileset>\n'
        ' <layer id="1" name="floor" width="4" height="2">\n'
        f'  <data encoding="base64" compression="zlib">{raw}</data>\n </layer>\n</map>\n'
    )


if __name__ == "__main__":
    plain(8, 4, PAL1, 2, "spr1.png")
    masked(8, 4, PAL1, "msk1.png")
    plain(16, 4, PAL0, 3, "spr0.png")
    masked(8, 4, PAL0, "msk0.png")
    picture()
    level()
