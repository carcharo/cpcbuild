#!/usr/bin/env python3
"""make_plus_art.py -- Lamplighter Plus's art: the hardware sprites and the
12-bit playfield palette, drawn from make_art.py's pictures.

    make_plus_art.py [outdir]        (default: plus/ next to this script)

Writes, in outdir:
  plus_sprites.png  96 x 16 -> 192 x 16: the 12 sprite frames of make_art.py
        (0-3 player right, 4-7 left, 8-9 climbing, 10-11 enemy) as 16 x 16
        hardware sprites. Every art pixel becomes 2 sprite pixels wide and
        stays 1 high: with the sprite magnified 2 x 1 (SprMag(slot, 2, 1)) two
        sprite pixels are one mode-0 pixel, so a sprite is the same 8 x 16
        mode-0 pixels as the CPC build's masked one.
  pl_pens.bas       the 16 playfield pens in 12-bit colours (the firmware
        colours of make_art.PENS as 0-15 levels, the ASIC's two bytes a pen:
        SetPalette12Block(@pl_pens(0), 0, 16)) and FLAME, the four colours
        the palette cycling rotates over pens 11-14 (the lit lamps' flames).
img2cpc.py --plus-sprite turns the sheet into lpsprites.bas
(build_assets.sh); the sprite colours are the sheet's distinct colours in order
of first appearance, 15 at most.
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_art as A  # noqa: E402

FLAME_PEN0 = 11        # first of the four cycled pens (G L P M in make_art.py)
# the flame's colours, 12-bit r, g, b 0-15: amber, yellow, red-orange, pale
# yellow; each pen takes the next colour on every rotation
FLAME = [(15, 10, 0), (15, 14, 4), (15, 5, 0), (15, 15, 11)]


def fw12(n):
    lv = (0, 8, 15)
    return (lv[(n // 3) % 3], lv[n // 9], lv[n % 3])


def px(c):
    return tuple(v * 17 for v in c) + (255,)


def sprite_sheet():
    fr = A.frames()
    sheet = Image.new("RGBA", (16 * len(fr), 16), (0, 0, 0, 0))
    for f, rows in enumerate(fr):
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch == ".":
                    continue
                c = px(fw12(A.PENS[A.CH[ch]]))
                for dx in range(2):
                    sheet.putpixel((16 * f + 2 * x + dx, y), c)
    return sheet


def asic(c):
    return [c[0] << 4 | c[2], c[1]]


def pens_bas():
    pens = [fw12(n) for n in A.PENS]
    for i, c in enumerate(FLAME):
        pens[FLAME_PEN0 + i] = c
    data = []
    for c in pens:
        data += asic(c)
    lines = ["' pl_pens.bas -- Lamplighter Plus's 16 playfield pens in 12-bit colours, written",
             "' by make_plus_art.py. Do not edit. Two bytes a pen as the ASIC's palette RAM",
             "' wants them (SetPalette12Block(@pl_pens(0), 0, 16)); pens 11-14 are the lit",
             "' lamps' flame, rotated over FLAME_PEN0.. by palette cycling.", "",
             "CONST FLAME_PEN0 AS UBYTE = %d" % FLAME_PEN0,
             "DIM pl_flame(3) AS UINTEGER => { _",
             "    " + ", ".join("$%X%X%X" % c for c in FLAME) + " _", "}", "",
             "DIM pl_pens(31) AS UBYTE => { _"]
    rows = []
    for i in range(0, 32, 16):
        rows.append("    " + ", ".join("$%02X" % b for b in data[i:i + 16]))
    lines.append(", _\n".join(rows) + " _")
    lines.append("}")
    return "\n".join(lines) + "\n"


def main():
    # the flame pens belong to the lit lamp (tile 6 of plus_tiles.png) alone:
    # palette cycling rewrites them
    for t, rows in enumerate(A.TILES):
        if t != A.T_LIT:
            assert not set("".join(rows)) & set("GLPM"), "tile %d uses a flame pen" % t
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "plus"
    out.mkdir(parents=True, exist_ok=True)
    sheet = sprite_sheet()
    sheet.save(out / "plus_sprites.png")
    (out / "pl_pens.bas").write_text(pens_bas())


if __name__ == "__main__":
    main()
