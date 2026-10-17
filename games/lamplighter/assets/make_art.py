#!/usr/bin/env python3
"""make_art.py -- Lamplighter's placeholder art (ours) and map, as source files.

    make_art.py [outdir]        (default: next to this script)

Writes, for the CPC (mode 0, one PNG pixel = one CPC pixel, the exact RGB of
the firmware colours in PENS so img2cpc.py's fixed palette maps them one to
one):

  lamp.pal      the 16 pens (firmware colours)
  tiles.png     128x8   16 tiles of 8x8 (see TILE_NAMES; the tile numbers are
                        the ones game.bas's attribute table is indexed by)
  sprites.png   96x16   12 frames of 8x16 (4 bytes x 16 lines), transparent =
                        alpha 0, for img2cpc --masked: 0-3 player facing
                        right (stand, walk 1, walk 2, jump), 4-7 the same
                        facing left, 8-9 climbing, 10-11 the enemy
  tower.tmx     the tower for Tiled: 60x92 cells = 3 x 4 rooms of 20 x 23;
                tile layer "tiles" and object layer "objects" (start cells
                and enemies), room names as the map property "names".
                Room r is at grid column r % 3, row r // 3 (row 0 at the top).
  font.bas      none: the CPC build reuses Starfall's 5x7 font (fontcpc.bas)

The tower's rooms are described in ROOMS below with a few commands each
(platforms, ladders, spikes, lamps) and drawn into the big map.
"""
import base64
import sys
import zlib
from pathlib import Path

from PIL import Image

# ---- palette ----------------------------------------------------------------

# pen -> firmware colour (docs/library.md palette table)
PENS = [0, 1, 3, 6, 15, 24, 12, 26, 13, 11, 20, 9, 18, 16, 5, 2]
CH = {  # art character -> pen
    "K": 0, "d": 1, "r": 2, "R": 3, "O": 4, "Y": 5, "y": 6, "W": 7,
    "g": 8, "B": 9, "C": 10, "G": 11, "L": 12, "P": 13, "M": 14, "N": 15,
}


def fw_rgb(n):
    """Firmware colour number (9G + 3R + B, each 0-2) -> RGB."""
    lv = (0, 128, 255)
    return (lv[(n // 3) % 3], lv[n // 9], lv[n % 3])


def rgb_of(ch):
    return fw_rgb(PENS[CH[ch]])


# ---- tiles --------------------------------------------------------------------

TILE_NAMES = ["bg", "brick", "platform", "ladder", "spikes", "lamp", "lamp lit",
              "door", "door open", "heart", "window", "wall", "ladder top",
              "-", "-", "-"]
T_BG, T_BRICK, T_PLAT, T_LADDER, T_SPIKES, T_LAMP, T_LIT, T_DOOR, T_OPEN, \
    T_HEART, T_WINDOW, T_WALL, T_LTOP = range(13)

TILES = [
    # 0 bg: black, a few dim stars
    ["KKKKKKKK",
     "KKKKKdKK",
     "KKKKKKKK",
     "KdKKKKKK",
     "KKKKKKKK",
     "KKKKKKdK",
     "KKKKKKKK",
     "KKdKKKKK"],
    # 1 brick
    ["RRRRRRRK",
     "rrrrrrrK",
     "rrrrrrrK",
     "KKKKKKKK",
     "RRKRRRRR",
     "rrKrrrrr",
     "rrKrrrrr",
     "KKKKKKKK"],
    # 2 platform (a stone ledge; one-way)
    ["WWWWWWWW",
     "gggggggg",
     "gggggggg",
     "dddddddd",
     "KKKKKKKK",
     "KKKKKKKK",
     "KKKKKKKK",
     "KKKKKKKK"],
    # 3 ladder
    ["KOKKKKOK",
     "KOOOOOOK",
     "KOKKKKOK",
     "KOKKKKOK",
     "KOKKKKOK",
     "KOOOOOOK",
     "KOKKKKOK",
     "KOKKKKOK"],
    # 4 spikes
    ["KKKKKKKK",
     "KKKKKKKK",
     "KKKKKKKK",
     "KKCKKKCK",
     "KKCKKKCK",
     "KCWCKCWC",
     "CWWWCWWW",
     "gggggggg"],
    # 5 lamp, unlit
    ["KKKggKKK",
     "KKgddgKK",
     "KKgddgKK",
     "KKgddgKK",
     "KKKggKKK",
     "KKKKgKKK",
     "KKKKgKKK",
     "KKKggKKK"],
    # 6 lamp, lit
    ["KKKggKKK",
     "KyyYYyyK",
     "KygYWgyK",
     "KygYYgyK",
     "KKyggyKK",
     "KKKKgKKK",
     "KKKKgKKK",
     "KKKggKKK"],
    # 7 door, closed
    ["rrrrrrrr",
     "rOOOrOOO",
     "rOOOrOOO",
     "rOOOrOOO",
     "rOOOrOYO",
     "rOOOrOOO",
     "rOOOrOOO",
     "rrrrrrrr"],
    # 8 door, open
    ["rKKKKKKK",
     "rKKKKKKK",
     "rKKyKKKK",
     "rKKKKKKK",
     "rKKKKKKK",
     "rKKKKKKK",
     "rKKKKKKK",
     "rKKKKKKK"],
    # 9 heart (HUD)
    ["KKKKKKKK",
     "KRRKRRKK",
     "RRRRRRRK",
     "RRRRRRRK",
     "KRRRRRKK",
     "KKRRRKKK",
     "KKKRKKKK",
     "KKKKKKKK"],
    # 10 window
    ["KKggggKK",
     "KgBBBBgK",
     "KgBCCBgK",
     "KgBBBBgK",
     "KggggggK",
     "KgBBBBgK",
     "KgBBBBgK",
     "KggggggK"],
    # 11 wall (dim bricks, decoration)
    ["dddddddK",
     "KKKKKKKK",
     "KKKdddddd"[:8],
     "KKKKKKKK",
     "dddddddK",
     "KKKKKKKK",
     "ddKddddd",
     "KKKKKKKK"],
    # 12 ladder top: a ledge with the ladder below it
    ["WWWWWWWW",
     "gggggggg",
     "KOKKKKOK",
     "KOOOOOOK",
     "KOKKKKOK",
     "KOKKKKOK",
     "KOOOOOOK",
     "KOKKKKOK"],
]
TILES += [["KKKKKKKK"] * 8] * (16 - len(TILES))


def tiles_image():
    img = Image.new("RGB", (8 * len(TILES), 8))
    for t, rows in enumerate(TILES):
        assert len(rows) == 8 and all(len(r) == 8 for r in rows), t
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                img.putpixel((8 * t + x, y), rgb_of(ch))
    return img


# ---- sprites ------------------------------------------------------------------

# 8 x 16 frames, built from a head (6 rows), a body (6) and legs (4); '.' is
# transparent. Facing right; the left-facing frames are mirrored.
HEAD = ["...MM...",
        "..MMMM..",
        ".MMMMMM.",
        "..PPPP..",
        "..PPKP..",
        "..PPPP.."]
HEAD_BACK = ["...MM...",
             "..MMMM..",
             ".MMMMMM.",
             "..MMMM..",
             "..MMMM..",
             "..PPPP.."]
BODY = [".CCCCCC.",
        "CCCWWCCO",
        "CCCWWCCY",
        "PCCWWCCO",
        ".CCCCCC.",
        ".CCCCCC."]
BODY_JUMP = ["P.CCCC.P",
             "PCCWWCCP",
             ".CCWWCCY",
             ".CCCCCCO",
             "..CCCC..",
             "..CCCC.."]
BODY_CLIMB1 = ["P.CCCC..",
               "PCCWWCC.",
               ".CCWWCC.",
               ".CCCCCCP",
               "..CCCC.P",
               "..CCCC.."]
BODY_CLIMB2 = ["..CCCC.P",
               ".CCWWCCP",
               ".CCWWCC.",
               "PCCCCCC.",
               "P.CCCC..",
               "..CCCC.."]
LEGS_STAND = ["..BBBB..",
              "..BBBB..",
              "..B..B..",
              "..rr.rr."]
LEGS_WALK1 = ["..BBBB..",
              ".BB..BB.",
              "BB....BB",
              "rr....rr"]
LEGS_WALK2 = ["..BBBB..",
              "...BB...",
              "..BB.BB.",
              ".rr...rr"]
LEGS_JUMP = [".BB..BB.",
             ".B....B.",
             ".rr..rr.",
             "........"]
LEGS_CL1 = ["..BB.BB.",
            "..BB..B.",
            "..rr..rr",
            "........"]
LEGS_CL2 = [".BB.BB..",
            ".B..BB..",
            "rr..rr..",
            "........"]
BODY_CL = ["..BBBB..", "..BBBB..", "........", "........"]  # unused spare

GHOST_A = ["........",
           "........",
           "........",
           "...MM...",
           "..MMMM..",
           ".MMMMMM.",
           ".MWKMWK.",
           ".MWKMWK.",
           ".MMMMMM.",
           ".MMRRMM.",
           ".MMMMMM.",
           ".MMMMMM.",
           ".MMMMMM.",
           ".MM.MMM.",
           ".M.MM.M.",
           "........"]
GHOST_B = GHOST_A[:13] + [".MMM.MM.", "..M.MM.M", "........"]


def mirror(rows):
    return [r[::-1] for r in rows]


def lines_cat(*parts):
    out = []
    for p in parts:
        out += p
    assert len(out) == 16, len(out)
    return out


def frames():
    right = [lines_cat(HEAD, BODY, LEGS_STAND),
             lines_cat(HEAD, BODY, LEGS_WALK1),
             lines_cat(HEAD, BODY, LEGS_WALK2),
             lines_cat(HEAD, BODY_JUMP, LEGS_JUMP)]
    left = [mirror(f) for f in right]
    climb = [lines_cat(HEAD_BACK, BODY_CLIMB1, LEGS_CL1),
             lines_cat(HEAD_BACK, BODY_CLIMB2, LEGS_CL2)]
    return right + left + climb + [GHOST_A, GHOST_B]


def sprites_image(fr):
    img = Image.new("RGBA", (8 * len(fr), 16), (0, 0, 0, 0))
    for f, rows in enumerate(fr):
        assert len(rows) == 16 and all(len(r) == 8 for r in rows), f
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch != ".":
                    img.putpixel((8 * f + x, y), rgb_of(ch) + (255,))
    return img


# ---- the tower ----------------------------------------------------------------

RW, RH = 20, 23          # a room, in cells
GW, GH = 3, 4            # the tower, in rooms

NAMES = ["THE BELFRY", "ATTIC STORE", "CLOCK LOFT",
         "GLASS GALLERY", "THE ARCHIVE", "WEST STAIR",
         "OLD LIBRARY", "TOWER HALL", "SERVANTS WAY",
         "THE CELLAR", "COLD STORE", "BOILER ROOM"]

# Rooms are connected along the path 9 10 11 / 8 7 6 / 3 4 5 / 2 1 0 (a
# serpentine climb). H: pairs joined by a doorway at the floor level (rows
# 20-21, closed by a door in the room it is the exit of); V: pairs joined
# by a ladder column (lower room's ladder runs to its ceiling; the upper
# room has a ladder-top cell in its floor).
H_LINKS = [(9, 10), (10, 11), (8, 7), (7, 6), (3, 4), (4, 5), (2, 1), (1, 0)]
# (from, to): the room the player leaves by the door on that side; the door
# is in the exit room of the climb's direction of travel
V_LINKS = [(11, 8, 15), (6, 3, 3), (5, 2, 16)]      # lower, upper, column
# door: room -> side ("L" or "R") of its exit
DOORS = {9: "R", 10: "R", 8: "L", 7: "L", 3: "R", 4: "R", 2: "L", 1: "L"}

# per room: P platforms (row, c0, c1), H ladders (col, top row, bottom row; a
# top row > 0 makes the top cell a ladder top), S spikes (row, c0, c1), L
# lamps (col, row), W windows (col, row), E enemies (kind 1 walker, 2 floater,
# 3 bat; col, row, range in cells), start (col, row) of the sprite's top left
ROOMS = {
    9: dict(P=[(19, 6, 11)], H=[], S=[(21, 14, 15)], L=[(3, 21), (8, 18)],
            W=[(4, 6), (15, 6)], E=[(1, 17, 20, 0)], start=(1, 20)),
    10: dict(P=[(19, 12, 15), (16, 2, 6)], H=[(7, 16, 21)], S=[(21, 9, 11)],
             L=[(4, 21), (13, 18), (3, 15)], W=[(10, 8)],
             E=[(2, 17, 12, 4)], start=(1, 20)),
    11: dict(P=[(19, 7, 12)], H=[(15, 0, 21)], S=[], L=[(3, 21), (9, 18)],
             W=[(5, 6), (10, 10)], E=[(1, 5, 20, 0)], start=(1, 20)),
    8: dict(P=[(19, 3, 7)], H=[], S=[(21, 10, 11)], L=[(10, 21), (5, 18)],
            W=[(12, 5)], E=[(3, 10, 14, 6)], start=(15, 20)),
    7: dict(P=[(19, 10, 14), (16, 2, 6)], H=[(4, 16, 21)], S=[],
            L=[(6, 21), (12, 18), (3, 15)], W=[(9, 6)],
            E=[(1, 9, 20, 0)], start=(17, 20)),
    6: dict(P=[(19, 13, 17)], H=[(3, 0, 21)], S=[(21, 6, 7)],
            L=[(10, 21), (15, 18)], W=[(8, 8)], E=[], start=(17, 20)),
    3: dict(P=[(19, 11, 15)], H=[], S=[(21, 16, 17)], L=[(8, 21), (13, 18)],
            W=[(7, 6)], E=[(3, 8, 14, 5)], start=(3, 20)),
    4: dict(P=[(19, 7, 11)], H=[], S=[(21, 12, 13)], L=[(4, 21), (9, 18), (15, 21)],
            W=[(10, 6)], E=[(1, 16, 20, 0)], start=(1, 20)),
    5: dict(P=[(19, 8, 12)], H=[(16, 0, 21)], S=[], L=[(4, 21), (10, 18)],
            W=[(6, 6)], E=[(2, 13, 14, 4)], start=(1, 20)),
    2: dict(P=[(19, 3, 7)], H=[], S=[(21, 11, 12)], L=[(9, 21), (5, 18)],
            W=[(13, 7)], E=[(1, 13, 20, 0)], start=(16, 20)),
    1: dict(P=[(19, 7, 11)], H=[], S=[], L=[(14, 21), (9, 18)],
            W=[(4, 6), (16, 9)], E=[(3, 12, 13, 5)], start=(17, 20)),
    0: dict(P=[(19, 7, 11), (16, 13, 17)], H=[(12, 16, 21)], S=[(21, 3, 4)],
            L=[(2, 21), (9, 18), (15, 15)], W=[(5, 8)],
            E=[(1, 5, 20, 0), (2, 16, 6, 4)], start=(17, 20)),
}


def build_room(r):
    spec = ROOMS[r]
    g = [[T_BG] * RW for _ in range(RH)]
    for c in range(RW):
        g[0][c] = T_BRICK
        g[RH - 1][c] = T_BRICK
    for row in range(RH):
        g[row][0] = T_BRICK
        g[row][RW - 1] = T_BRICK
    for c, row in spec["W"]:
        g[row][c] = T_WINDOW
    for row, c0, c1 in spec["P"]:
        for c in range(c0, c1 + 1):
            g[row][c] = T_PLAT
    for c, top, bot in spec["H"]:
        for row in range(top, bot + 1):
            g[row][c] = T_LADDER
        if top > 0:
            g[top][c] = T_LTOP
    for row, c0, c1 in spec["S"]:
        for c in range(c0, c1 + 1):
            g[row][c] = T_SPIKES
    for c, row in spec["L"]:
        g[row][c] = T_LAMP
    # doorways at floor level
    for a, b in H_LINKS:
        for me, other in ((a, b), (b, a)):
            if r != me:
                continue
            col = RW - 1 if other == me + 1 else 0
            for row in (20, 21):
                g[row][col] = T_BG
            if DOORS.get(r) == ("R" if col == RW - 1 else "L"):
                for row in (20, 21):
                    g[row][col] = T_DOOR
    for lo, up, col in V_LINKS:
        if r == lo:
            for row in range(0, RH - 1):
                g[row][col] = T_LADDER          # up through the ceiling
        if r == up:
            g[RH - 1][col] = T_LTOP             # a ladder top in the floor
    return g


def tower():
    big = [[0] * (RW * GW) for _ in range(RH * GH)]
    for r in range(GW * GH):
        g = build_room(r)
        gx, gy = r % GW, r // GW
        for y in range(RH):
            for x in range(RW):
                big[gy * RH + y][gx * RW + x] = g[y][x]
    return big


def tmx(big):
    w, h = RW * GW, RH * GH
    raw = b"".join((t + 1).to_bytes(4, "little") for row in big for t in row)
    data = base64.b64encode(zlib.compress(raw, 9)).decode()
    objs = []
    oid = 1
    for r in range(GW * GH):
        gx, gy = r % GW, r // GW
        ox, oy = gx * RW * 8, gy * RH * 8
        spec = ROOMS[r]
        sc, sr = spec["start"]
        objs.append(f'  <object id="{oid}" name="start{r}" type="start" x="{ox + 8 * sc}" y="{oy + 8 * sr}" width="8" height="16"/>')
        oid += 1
        for kind, c, row, rng in spec["E"]:
            kn = {1: "walker", 2: "floater", 3: "bat"}[kind]
            objs.append(f'  <object id="{oid}" name="{kn}" type="enemy" x="{ox + 8 * c}" y="{oy + 8 * row}" width="8" height="16">\n'
                        f'   <properties>\n    <property name="kind" type="int" value="{kind}"/>\n'
                        f'    <property name="range" type="int" value="{rng}"/>\n   </properties>\n  </object>')
            oid += 1
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down" '
            f'width="{w}" height="{h}" tilewidth="8" tileheight="8" infinite="0" nextlayerid="3" nextobjectid="{oid}">\n'
            f' <properties>\n  <property name="names" value="{",".join(NAMES)}"/>\n </properties>\n'
            f' <tileset firstgid="1" name="tiles" tilewidth="8" tileheight="8" tilecount="16" columns="16">\n'
            f'  <image source="tiles.png" width="128" height="8"/>\n </tileset>\n'
            f' <layer id="1" name="tiles" width="{w}" height="{h}">\n'
            f'  <data encoding="base64" compression="zlib">{data}</data>\n </layer>\n'
            f' <objectgroup id="2" name="objects">\n' + "\n".join(objs) + '\n </objectgroup>\n</map>\n')


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    out.mkdir(parents=True, exist_ok=True)
    (out / "lamp.pal").write_text("# Lamplighter's 16 pens (firmware colours)\n" + ",".join(map(str, PENS)) + "\n")
    tiles_image().save(out / "tiles.png")
    sprites_image(frames()).save(out / "sprites.png")
    (out / "tower.tmx").write_text(tmx(tower()))


if __name__ == "__main__":
    main()
