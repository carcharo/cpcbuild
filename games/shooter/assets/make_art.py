#!/usr/bin/env python3
"""make_art.py -- draws Starfall's pixel art (ours) as PNGs.

    make_art.py [outdir]        (default: next to this script)

CPC mode 0 art (one PNG pixel = one CPC pixel, colours are the exact RGB of
the firmware colours in PENS, so img2cpc.py's fixed palette maps them one to
one; transparent = alpha 0):
  sprites.png  96x8    12 frames of 8x8: ship; enemy row 0 (bottom, green)
                       frames 0-1; row 1 (red) 0-1; row 2 (top, magenta) 0-1;
                       diver 0-1; explosion 0-2
  shots.png    4x4     two 2x4 frames: player bullet, bomb (1 logical unit
                       wide: the left pixel of the 2-pixel byte)
  tiles.png    56x8    7 tiles: 0 border outer, 1 border inner left, 2 inner
                       right, 3 HUD rule, 4 ground, 5 ground fill, 6 life icon
  font.bas     the font: 7 bytes (5-bit rows) for each of ASCII 45..90
                       ("-" to "Z": digits, upper case, - . = and others
                       blank), CONST font_FIRST, font_COUNT
  fontcpc.bas  the same in cpcbuild/text.bas's format (each row shifted left
                       2: bit 7 the leftmost pixel), what the CPC layer
                       includes; font.bas stays for tests/screens/text5x7.bas
  starfall.pal the 16 pens (firmware colours)

Spectrum 1-bit art for the Spectrum builds (assets/zx/): the same shapes,
every pixel doubled horizontally (1 logical unit = 2 pixels) to 16x8 and
padded to 16x16 with the lower half transparent, frames stacked vertically
(a 16-wide column: frame f is rows 16f..16f+15; with img2cpc --spectrum the
cells come out row-major, so frame f is cells 4f (top-left), 4f+1
(top-right), 4f+2 and 4f+3 (the empty lower half)). White = ink = also the
mask (the shapes have no opaque black pixels). zx_shots.png is the same for
bullet and bomb (a 2-pixel wide column at the left, 4 lines).
"""
import sys
from pathlib import Path

from PIL import Image

# pen -> firmware colour (docs/library.md palette table)
PENS = [0, 26, 20, 11, 6, 15, 24, 8, 16, 18, 9, 12, 1, 14, 3, 13]
CH = {  # art character -> pen
    "K": 0, "W": 1, "C": 2, "S": 3, "R": 4, "O": 5, "Y": 6, "M": 7,
    "P": 8, "G": 9, "g": 10, "y": 11, "B": 12, "b": 13, "r": 14, "w": 15,
}


def fw_rgb(n):
    """Firmware colour number (9G + 3R + B, each 0-2) -> RGB."""
    lv = (0, 128, 255)
    return (lv[(n // 3) % 3], lv[n // 9], lv[n % 3])


def rgb_of(ch):
    return fw_rgb(PENS[CH[ch]])


SHIP = ["...CC...",
        "...CC...",
        "..CWWC..",
        "..CWWC..",
        ".CCSSCC.",
        "CCSSSSCC",
        "CS.RR.SC",
        "C..YY..C"]

ROW0 = [[".G....G.",
         "..G..G..",
         ".GGGGGG.",
         "GG.GG.GG",
         "GGGGGGGG",
         "G.GGGG.G",
         "G.G..G.G",
         "..G..G.."],
        [".G....G.",
         "G.G..G.G",
         "GGGGGGGG",
         "GG.GG.GG",
         "GGGGGGGG",
         ".GGGGGG.",
         "..G..G..",
         ".G....G."]]
ROW1 = [["...RR...",
         "..RRRR..",
         ".RROORR.",
         "RR.RR.RR",
         "RRRRRRRR",
         "..R..R..",
         ".R.OO.R.",
         "R.R..R.R"],
        ["...RR...",
         "..RRRR..",
         ".RROORR.",
         "RR.RR.RR",
         "RRRRRRRR",
         ".R.OO.R.",
         "R..RR..R",
         ".R....R."]]
ROW2 = [["..M..M..",
         "...MM...",
         "..MMMM..",
         ".MMWWMM.",
         "MMMMMMMM",
         "M.MMMM.M",
         "M.M..M.M",
         "...MM..."],
        ["..M..M..",
         "M..MM..M",
         "M.MMMM.M",
         "MMMWWMMM",
         ".MMMMMM.",
         "..MMMM..",
         ".M.MM.M.",
         "M......M"]]
DIVER = [["Y..YY..Y",
          "YY.YY.YY",
          "YYYYYYYY",
          ".YYWWYY.",
          "..YYYY..",
          "...YY...",
          "...RR...",
          "....R..."],
         ["...YY...",
          "..YYYY..",
          "YYYYYYYY",
          "YYYWWYYY",
          "Y.YYYY.Y",
          "..YYYY..",
          "...RR...",
          "...R...."]]
EXPL = [["........",
         "..Y..Y..",
         "...OO...",
         "..OWWO..",
         "..OWWO..",
         "...OO...",
         "..Y..Y..",
         "........"],
        ["Y..O..Y.",
         ".O.YY.O.",
         "..YWWY..",
         "OYWWWWYO",
         ".OYWWYO.",
         "..YWWY..",
         ".O.YY.O.",
         "Y..O..Y."],
        ["R......R",
         "..O..O..",
         "........",
         ".O....O.",
         "......R.",
         "..R..O..",
         "O.......",
         "...R...R"]]

FRAMES = [SHIP] + ROW0 + ROW1 + ROW2 + DIVER + EXPL

BULLET = ["W.", "W.", "C.", "C."]
BOMB = ["R.", "O.", "R.", "O."]

BORDER_OUT = ["BBBBBBBB", "BbBBBBbB", "BBBBBBBB", "BBBBBBBB",
              "BBBBBBBB", "BbBBBBbB", "BBBBBBBB", "BBBBBBBB"]
BORDER_L = ["BBBBBBSC"] * 8
BORDER_R = ["CSBBBBBB"] * 8
RULE = ["KKKKKKKK"] * 5 + ["BBBBBBBB", "SSSSSSSS", "BBBBBBBB"]
GROUND = ["CCCCCCCC", "SSSSSSSS", "BBBBBBBB", "BBBBBBBB",
          "BBBBBBBB", "BBBBBBBB", "BBBBBBBB", "BBBBBBBB"]
FILL = ["BKBKBKBK", "KBKBKBKB"] * 4


def star(x, y, ch):
    rows = ["KKKKKKKK"] * 8
    rows[y] = rows[y][:x] + ch + rows[y][x + 1:]
    return rows


FONT = {
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
    "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
    ".": [".....", ".....", ".....", ".....", ".....", "..#..", "..#.."],
    "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
    ":": [".....", "..#..", ".....", ".....", "..#..", ".....", "....."],
    "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
    "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
}


def glyph(c):
    """8 rows of 8 art characters for ASCII c: the 5x7 glyph at x 1..5,
    white over the top four rows, bright cyan below."""
    rows = ["........"] * 8
    g = FONT.get(chr(c))
    if g:
        for y, r in enumerate(g):
            line = "".join(("W" if y < 4 else "C") if ch == "#" else "." for ch in r)
            rows[y] = "." + line + ".."
    return rows


def draw(rows, mode="cpc"):
    h, w = len(rows), len(rows[0])
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != ".":
                im.putpixel((x, y), rgb_of(ch) + (255,))
    return im


def draw_tile(rows):
    """A tile: '.' is black, not transparent."""
    return draw([r.replace(".", "K") for r in rows])


def sheet(frames, per_row=None):
    h, w = len(frames[0]), len(frames[0][0])
    per_row = per_row or len(frames)
    nrows = (len(frames) + per_row - 1) // per_row
    im = Image.new("RGBA", (w * per_row, h * nrows), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        im.paste(draw(f), ((i % per_row) * w, (i // per_row) * h))
    return im


def tiles_image():
    tiles = [BORDER_OUT, BORDER_L, BORDER_R, RULE, GROUND, FILL, SHIP]
    im = Image.new("RGBA", (8 * len(tiles), 8), (0, 0, 0, 255))
    for i, t in enumerate(tiles):
        im.paste(draw_tile(t), (i * 8, 0))
    return im


def font_bas(shift=0, name="font.bas"):
    """The font as a Boriel include: 7 row bytes per character 45..90, each
    row shifted left by `shift` (0: bit 4 the leftmost pixel, as drawn here;
    2: the cpcbuild/text.bas format, bit 7 the leftmost, keeping the glyph's
    one-pixel left margin)."""
    if shift:
        where = ["' in the library's format (cpcbuild/text.bas): the rows of font.bas shifted",
                 "' left by %d, so bit 7 is the leftmost pixel of the 8-pixel cell (the glyph" % shift,
                 "' keeps a one-pixel left margin, as the game always drew it)."]
        head = "' Characters 45 ('-') to 90 ('Z'), 7 bytes each, one byte per row,"
    else:
        head = "' Characters 45 ('-') to 90 ('Z'), 7 bytes each, one byte per row, bit 4 the"
        where = ["' leftmost pixel."]
    out = ["' %s -- Starfall's 5x7 font, written by make_art.py. Do not edit." % name,
           head] + where + [""] + [
           "CONST font_FIRST AS UBYTE = 45", "CONST font_COUNT AS UBYTE = 46", "",
           "DIM font(%d) AS UBYTE => { _" % (46 * 7 - 1)]
    lines = []
    for c in range(45, 91):
        g = FONT.get(chr(c))
        rows = [int(r.replace("#", "1").replace(".", "0"), 2) << shift for r in g] if g else [0] * 7
        lines.append("    " + ", ".join("$%02X" % b for b in rows))
    out.append(", _\n".join(lines) + " _")
    out.append("}")
    return "\n".join(out) + "\n"


def zx_frame(rows, w, h):
    """Rows of art -> a 16x16 frame (bool grid), pixels doubled
    horizontally, lower part empty."""
    g = [[False] * 16 for _ in range(16)]
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != ".":
                g[y][2 * x] = g[y][2 * x + 1] = True
    return g


def zx_sheet(frames, w, h):
    im = Image.new("RGB", (16, 16 * len(frames)), (0, 0, 0))
    for i, f in enumerate(frames):
        g = zx_frame(f, w, h)
        for y in range(16):
            for x in range(16):
                if g[y][x]:
                    im.putpixel((x, 16 * i + y), (255, 255, 255))
    return im


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    (out / "zx").mkdir(exist_ok=True)
    sheet(FRAMES).save(out / "sprites.png")
    sheet([BULLET, BOMB], 2).save(out / "shots.png")
    tiles_image().save(out / "tiles.png")
    (out / "font.bas").write_text(font_bas())
    (out / "fontcpc.bas").write_text(font_bas(2, "fontcpc.bas"))
    (out / "starfall.pal").write_text(
        "# Starfall's 16 pens (firmware colours)\n" + ",".join(map(str, PENS)) + "\n")
    zx_sheet(FRAMES, 8, 8).save(out / "zx" / "zx_sprites.png")
    zx_sheet([BULLET, BOMB], 2, 4).save(out / "zx" / "zx_shots.png")
    icon = Image.new("RGB", (8, 8), (0, 0, 0))
    for y, r in enumerate(SHIP):
        for x, ch in enumerate(r):
            if ch != ".":
                icon.putpixel((x, y), (255, 255, 255))
    icon.save(out / "zx" / "zx_icon.png")


if __name__ == "__main__":
    main()
