#!/usr/bin/env python3
"""make_plus_art.py -- Starfall Plus's art: the CPC Plus (ASIC) hardware sprites
and the 12-bit playfield palette, drawn from make_art.py's pictures.

    make_plus_art.py [outdir]        (default: next to this script)

Writes, in outdir:
  plus_sprites.png  a sheet of 16x16 hardware sprites, one cell each:
        0 ship; 1-2 diver; 3 player bullet; 4 bomb; 5-7 explosion;
        8-9 the formation's alien (stage 2, the raster-multiplexed build;
        its body colours are palette entries PAL_BODY and PAL_LIGHT, which
        the raster handlers set per row)
      Every art pixel of the 8x8 pictures becomes 2 sprite pixels wide and
      stays 1 high: with the sprite magnified 2x1, 2 sprite pixels are one
      mode-0 pixel, so a sprite covers the same 8 x 8 mode-0 pixels as the
      software one (the lower half of its 16 lines is transparent). The
      explosion is drawn 2x2 (16 x 16 lines, centred on the old box). Where
      the 12-bit palette helps, the top half of a picture is lighter than
      its bottom half (the CPC's 16 pens had one colour each).
  pl_pens.bas       the 16 pens of the playfield in 12-bit colours, as the
                    ASIC's palette bytes (SetPalette12Block, 32 bytes), plus
                    PL_BORDER and the PL_PEN_* constants for the HUD.
img2cpc.py --plus-sprite --packed turns the sheet into plsprites.bas
(build_assets.sh); the sprite colours are the sheet's distinct colours in
order of first appearance, 15 at most.
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_art as A  # noqa: E402

# art character -> 12-bit colour (r, g, b), 0-15 each
BASE = {
    "W": (15, 15, 15), "C": (0, 13, 15), "S": (3, 6, 15), "R": (15, 3, 3),
    "Y": (15, 14, 2), "O": (15, 8, 2), "G": (3, 14, 4), "M": (14, 3, 14),
}
LIGHT = {                         # the top half of a picture
    "C": (8, 15, 15), "R": (15, 9, 8), "Y": (15, 15, 9), "G": (9, 15, 9), "M": (15, 9, 15),
}
# the aliens' body (entries rewritten per row by the raster handlers)
BODY = (15, 3, 4)
BODY_LIGHT = (15, 9, 9)

# the alien of stage 2: one shape for all rows, two frames; B body, L the
# lighter body, W eyes, O belly, .. clear
ALIEN = [["...BB...",
          "..BBBB..",
          ".BBWWBB.",
          "BB.BB.BB",
          "BBBBBBBB",
          "..B..B..",
          ".B.OO.B.",
          "B.B..B.B"],
         ["...BB...",
          "..BBBB..",
          ".BBWWBB.",
          "BB.BB.BB",
          "BBBBBBBB",
          ".B.OO.B.",
          "B..BB..B",
          ".B....B."]]


def colour(ch, y, h=8):
    if ch == "B":
        return BODY_LIGHT if y < h // 2 else BODY
    if ch == "L":
        return BODY_LIGHT
    if ch in LIGHT and y < h // 2:
        return LIGHT[ch]
    return BASE[ch]


def px(c):
    return tuple(v * 17 for v in c) + (255,)


def cell(rows):
    """16x16 RGBA from an 8x8 art picture: 2 sprite pixels wide per art pixel."""
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    h = len(rows)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != ".":
                for dx in range(2):
                    im.putpixel((2 * x + dx, y), px(colour(ch, y, h)))
    return im


def expl_cell(rows):
    """The explosion: every art pixel 2x2 sprite pixels... that is 16 wide
    from 8 art pixels doubled, and 16 high from 8 rows doubled."""
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == ".":
                continue
            for dy in range(2):
                for dx in range(2):
                    im.putpixel((2 * x + dx, 2 * y + dy), px(colour(ch, y)))
    return im


def bullet_cell():
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    cols = [(15, 15, 15), (15, 15, 15), (0, 13, 15), (0, 13, 15)]
    for y in range(4):
        for x in range(2):
            im.putpixel((x, y), px(cols[y]))
    return im


def bomb_cell():
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    cols = [(15, 3, 3), (15, 8, 2), (15, 3, 3), (15, 8, 2)]
    for y in range(4):
        for x in range(2):
            im.putpixel((x, y), px(cols[y]))
    return im


def sprite_sheet():
    cells = [cell(A.SHIP), cell(A.DIVER[0]), cell(A.DIVER[1]), bullet_cell(), bomb_cell()]
    cells += [expl_cell(f) for f in A.EXPL]
    cells += [cell(f) for f in ALIEN]
    sheet = Image.new("RGBA", (16 * len(cells), 16), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        sheet.paste(c, (16 * i, 0))
    return sheet


# The 16 pens, the firmware colours of make_art.PENS as 12-bit, with a few
# of the playfield's colours made richer than the firmware's three levels.
PEN_OVERRIDE = {
    0: (0, 0, 0),
    2: (0, 13, 15),      # C cyan
    3: (3, 7, 15),       # S sky
    12: (0, 2, 7),       # B deep blue (border tiles, ground)
    13: (6, 9, 15),      # b light blue (highlights)
}
BORDER = (0, 0, 2)


def fw12(n):
    lv = (0, 8, 15)
    return (lv[(n // 3) % 3], lv[n // 9], lv[n % 3])


def pens12():
    out = []
    for i, n in enumerate(A.PENS):
        out.append(PEN_OVERRIDE.get(i, fw12(n)))
    return out


def asic(c):
    return [c[0] << 4 | c[2], c[1]]


def pens_bas(ent):
    pens = pens12()
    data = []
    for c in pens:
        data += asic(c)
    lines = ["' pl_pens.bas -- Starfall Plus's 16 playfield pens in 12-bit colours, written by",
             "' make_plus_art.py. Do not edit. Two bytes a pen as the ASIC's palette RAM wants",
             "' them (SetPalette12Block(@pl_pens(0), 0, 16)).", "",
             "CONST PL_BORDER AS UINTEGER = $%X%X%X" % BORDER,
             "' sprite colour entries (1-15) the stage-2 raster handlers rewrite per row",
             "CONST PL_BODY AS UBYTE = %d" % ent[BODY],
             "CONST PL_LIGHT AS UBYTE = %d" % ent[BODY_LIGHT],
             "CONST PL_BODY_N AS UINTEGER = $%X%X%X" % BODY, "",
             "DIM pl_pens(31) AS UBYTE => { _"]
    rows = []
    for i in range(0, 32, 16):
        rows.append("    " + ", ".join("$%02X" % b for b in data[i:i + 16]))
    lines.append(", _\n".join(rows) + " _")
    lines.append("}")
    return "\n".join(lines) + "\n"


def entry_numbers(sheet):
    """Sprite palette entry (1-15) of each colour, in img2cpc's order: the
    sheet's distinct colours by first appearance, cells in order, rows top to
    bottom."""
    seen = []
    for cx in range(0, sheet.width, 16):
        for y in range(16):
            for x in range(cx, cx + 16):
                p = sheet.getpixel((x, y))
                if p[3] >= 128:
                    c = tuple(v // 17 for v in p[:3])
                    if c not in seen:
                        seen.append(c)
    assert len(seen) <= 15, len(seen)
    return {c: i + 1 for i, c in enumerate(seen)}


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    sheet = sprite_sheet()
    sheet.save(out / "plus_sprites.png")
    ent = entry_numbers(sheet)
    (out / "pl_pens.bas").write_text(pens_bas(ent))


if __name__ == "__main__":
    main()
