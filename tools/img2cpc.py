#!/usr/bin/env python3
"""img2cpc.py -- converts a PNG into a Boriel BASIC include (a .bas file of
DIM ... => {...} arrays and CONSTs) for the cpcbuild library.

    img2cpc.py --mode 0|1|2 [--name NAME] [-o out.bas] image.png
               [--sprite [--frame WxH] | --tiles [--tile-width PX] [--dedupe]]
               [--masked]
               [--transparent RRGGBB]
               [--palette 0,1,2,... | --palette-file F] [--pen0 N]
               [--no-palette] [--write-palette F] [--no-sidecar] [--check]
    img2cpc.py --spectrum [--name NAME] [-o out.bas] image.png
    img2cpc.py --plus-sprite [--packed] [--palette RGB,RGB,...] [--plus-format bas|asm|bin]
               [--transparent RRGGBB] [--name NAME] [-o out] image.png
    img2cpc.py --plus-palette [--palette RGB,...] [--plus-format bas|asm|bin] [-o out] image.png

One PNG pixel is one CPC pixel (mode 0 art is 160 pixels wide, mode 1 is
320, mode 2 is 640; no aspect correction); the width must be a multiple of
the pixels per screen byte (2, 4, 8 for modes 0, 1, 2).

Kinds
  --sprite  (default) the whole image as a PutSprite block, w bytes x h
            lines, rows top first. With --frame WxH (pixels) the image is a
            sheet cut into frames row-major; NAME holds all frames back to
            back. Emits NAME, NAME_W (bytes), NAME_H (lines), NAME_FRAMES,
            NAME_SIZE (bytes per frame).
  --tiles   8x8 tiles, row-major over the image, 32/16/8 bytes each in
            mode 0/1/2, for SetTileSet. Emits NAME, NAME_COUNT. --dedupe
            drops repeated tiles and also emits NAME_MAP (one tile number
            per source cell, for TileMap) with NAME_MAPW, NAME_MAPH.
            --tile-width PX makes the tiles PX x 8 pixels: 1, 2 or 4 screen
            bytes wide (PX = 2/4/8 in mode 0, 4/8/16 in mode 1, 8/16/32 in
            mode 2; default 8), for SetTileWidth. The image must be a
            multiple of PX x 8. Unless PX is 8 it also emits NAME_TILEW (the
            tile width in bytes); NAME_MAPW is then image width / PX.
  --masked  (sprites) (mask, pixel) byte pairs for PutSpriteMasked; mask
            bit 1 keeps the background. A pixel is transparent if its alpha
            is below 128 or it is --transparent RRGGBB. In unmasked output
            transparent pixels become pen 0.

Palette
  Pens are firmware colours 0-26 (9*G + 3*R + B, each of R, G, B being
  0/1/2 for 0x00/0x80/0xFF). --palette fixes the pens, and each image
  colour takes the pen whose colour is nearest (squared RGB distance, ties
  to the lower pen). Otherwise the palette is built from the image: each
  opaque colour goes to its nearest firmware colour, and the distinct ones
  take pens in order of first appearance (rows top to bottom), after
  --pen0 N if given; more than 16/4/2 colours is an error. NAME_pal (pen
  order, for SetPalette) and NAME_PENS are emitted unless --no-palette;
  --write-palette F saves the palette so other images can share it with
  --palette-file F (comma/whitespace separated, # comments).

--spectrum emits ZX Spectrum data (build with --arch zx48k) instead: per
8x8 cell the two most frequent colours (nearest of the 8 Spectrum colours
at normal 0xD7 or BRIGHT 0xFF level; transparent counts as black) become
paper and ink (the less frequent one; the same colour if the cell has only
one), a set bit is ink, bit 7 is the leftmost pixel. NAME is the bitmap,
8 bytes per cell (cells row-major, rows top first: UDG order), NAME_attr
one attribute byte (FLASH<<7 | BRIGHT<<6 | PAPER<<3 | INK) per cell, and
NAME_COLS, NAME_ROWS the size in cells. Width and height must be
multiples of 8.

Sidecar
  If NAME.cpcbuild.json sits beside NAME.png (the Aseprite extension's
  Export for CPCBuild writes one) its settings are the defaults for a CPC
  conversion: mode, kind (--sprite/--tiles), name, frame, masked, palette
  (the pens, as --palette) and tileWidth (--tile-width, if not 8), so
  `img2cpc.py hero.png` is enough and --mode is not required. Anything on
  the command line wins; --palette-file overrides the sidecar palette.
  Each of the sidecar's sprite tags also gives NAME_<TAG> (its first frame)
  and NAME_<TAG>_LEN (its frame count), TAG being the tag name in capitals
  with every character but A-Z and 0-9 turned into _. A sidecar that is not
  valid is an error; --no-sidecar ignores it. The generated file's header
  says when a sidecar was used. --spectrum and --plus-* never read one.

--check does everything a conversion does (the same options, the sidecar
too) but writes nothing: it prints what would be made (sizes, the pens
used, image colours moved to another firmware colour, transparent pixels,
repeated tiles, total data bytes) and exits 0, or gives the error the
conversion would. CPC modes only; -o is an error.

CPC Plus (ASIC) data, no --mode needed. Colours are 12-bit: 4 bits per
channel, each 8-bit channel c quantised to round(c * 15 / 255) (so 0x11 * n
maps to n exactly). Palette entries are two bytes, as the ASIC wants them in
its palette RAM (&6400-&643F): byte 0 = red << 4 | blue, byte 1 = green
(low nibble).
--plus-sprite  hardware sprite data from a 16x16 image or a sheet of 16x16
            cells (cut row-major). One byte per pixel, 0 = transparent (alpha
            below 128 or --transparent), 1-15 = sprite palette entry, 256 bytes
            per sprite, rows top first: the ASIC's own layout (the low nibble
            of each byte is used). --packed gives two pixels per byte, the left
            one in the high nibble (128 bytes per sprite), for programs that
            unpack into the ASIC. The sprite palette (NAME_pal, 30 bytes = 15
            entries, for &6422-&643F) is the image's distinct colours in order
            of first appearance (cells in order, rows top to bottom); more
            than 15 is an error unless --palette gives the entries (hex RGB
            triples such as F00,0F0, or a file via --palette-file; each pixel
            takes the nearest). Emits NAME, NAME_pal, NAME_FRAMES, NAME_SIZE,
            NAME_PALN.
--plus-palette the 16 pen colours of a full-screen image: its distinct colours
            in order of first appearance (error beyond 16 unless --palette),
            as NAME_pal, 32 bytes for &6400-&641F.
--plus-format bas (default, DIM arrays), asm (defb lines and EQUs) or bin
            (the data to -o, the palette to -o with the suffix .pal; for
            --plus-palette just the palette to -o).
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import sys
from collections import Counter
from pathlib import Path

MAXPENS = {0: 16, 1: 4, 2: 2}
PPB = {0: 2, 1: 4, 2: 8}  # pixels per screen byte

# ---------------------------------------------------------------- encoding


def pixel_bits(mode: int, n: int, pen: int) -> int:
    """The screen-byte bits of pixel n (0 = leftmost) holding `pen`."""
    if mode == 0:
        # left: p0=7 p1=3 p2=5 p3=1; right: one bit lower
        b = 0
        for plane, bit in enumerate((7, 3, 5, 1)):
            if pen >> plane & 1:
                b |= 1 << (bit - n)
        return b
    if mode == 1:
        return ((pen & 1) << (7 - n)) | ((pen >> 1 & 1) << (3 - n))
    return (pen & 1) << (7 - n)


def encode_byte(mode: int, pens: list[int]) -> int:
    """One screen byte from its PPB[mode] pens, leftmost first."""
    b = 0
    for n, pen in enumerate(pens):
        b |= pixel_bits(mode, n, pen)
    return b


def pixel_mask(mode: int, n: int) -> int:
    """All the bits of pixel n (the mask of one pixel)."""
    return pixel_bits(mode, n, MAXPENS[mode] - 1)


# ---------------------------------------------------------------- colours


def fw_rgb(n: int) -> tuple[int, int, int]:
    g, r, b = n // 9, n // 3 % 3, n % 3
    lv = (0x00, 0x80, 0xFF)
    return lv[r], lv[g], lv[b]


def dist2(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


def nearest(rgb: tuple[int, int, int], table: list[tuple[int, int, int]]) -> int:
    """Index of the nearest entry; ties go to the lowest index."""
    best, bestd = 0, None
    for i, c in enumerate(table):
        d = dist2(rgb, c)
        if bestd is None or d < bestd:
            best, bestd = i, d
    return best


FW_TABLE = [fw_rgb(n) for n in range(27)]


def nearest_fw(rgb: tuple[int, int, int]) -> int:
    return nearest(rgb, FW_TABLE)


# Spectrum colour index = G*4 + R*2 + B.
def zx_rgb(idx: int, bright: int) -> tuple[int, int, int]:
    lv = 0xFF if bright else 0xD7
    return (lv if idx & 2 else 0, lv if idx & 4 else 0, lv if idx & 1 else 0)


# candidates: (idx, bright); black appears once
ZX_CANDS = [(0, 0)] + [(i, br) for br in (0, 1) for i in range(1, 8)]
ZX_TABLE = [zx_rgb(i, br) for i, br in ZX_CANDS]

# ---------------------------------------------------------------- image


class Image:
    """w x h, pix[y][x] = (r, g, b) or None where transparent."""

    def __init__(self, w: int, h: int, pix: list[list]):
        self.w, self.h, self.pix = w, h, pix


def load_image(path: Path, transparent: tuple[int, int, int] | None) -> Image:
    from PIL import Image as PILImage

    try:
        im = PILImage.open(path).convert("RGBA")
    except OSError as e:
        raise SystemExit(f"img2cpc: {path}: {e}")
    w, h = im.size
    data = im.load()
    pix = []
    for y in range(h):
        row = []
        for x in range(w):
            r, g, b, a = data[x, y]
            if a < 128 or (transparent is not None and (r, g, b) == transparent):
                row.append(None)
            else:
                row.append((r, g, b))
        pix.append(row)
    return Image(w, h, pix)


def parse_pal_list(text: str) -> list[int]:
    out = []
    for line in text.splitlines():
        line = line.split("#", 1)[0]
        for tok in line.replace(",", " ").split():
            try:
                v = int(tok)
            except ValueError:
                raise SystemExit(f"img2cpc: bad palette entry {tok!r}")
            if not 0 <= v <= 26:
                raise SystemExit(f"img2cpc: palette colour {v} is not a firmware colour (0-26)")
            out.append(v)
    return out


def build_palette(img: Image, mode: int, fixed: list[int] | None, pen0: int | None) -> list[int]:
    maxp = MAXPENS[mode]
    if fixed is not None:
        if not fixed:
            raise SystemExit("img2cpc: empty palette")
        if len(fixed) > maxp:
            raise SystemExit(f"img2cpc: palette has {len(fixed)} pens, mode {mode} has {maxp}")
        return list(fixed)
    pal: list[int] = [pen0] if pen0 is not None else []
    for row in img.pix:
        for p in row:
            if p is not None:
                c = nearest_fw(p)
                if c not in pal:
                    pal.append(c)
    if not pal:
        pal = [0]
    if len(pal) > maxp:
        raise SystemExit(
            f"img2cpc: the image needs {len(pal)} colours (firmware {pal}), mode {mode} has only {maxp} pens"
        )
    return pal


def pen_grid(img: Image, pal: list[int]) -> list[list]:
    """Pen number per pixel, None where transparent."""
    pal_rgb = [FW_TABLE[c] for c in pal]
    cache: dict = {}
    out = []
    for row in img.pix:
        r = []
        for p in row:
            if p is None:
                r.append(None)
            else:
                if p not in cache:
                    cache[p] = nearest(p, pal_rgb)
                r.append(cache[p])
        out.append(r)
    return out


def pack_block(grid, x0: int, y0: int, wpx: int, hpx: int, mode: int, masked: bool) -> list[int]:
    """Bytes of the wpx x hpx pixel block at (x0, y0): rows top first, each
    row's bytes left to right; (mask, pixel) pairs when masked."""
    ppb = PPB[mode]
    out: list[int] = []
    for y in range(y0, y0 + hpx):
        for bx in range(x0, x0 + wpx, ppb):
            pens, mask = [], 0
            for n in range(ppb):
                p = grid[y][bx + n]
                if p is None:
                    mask |= pixel_mask(mode, n)
                    p = 0
                pens.append(p)
            if masked:
                out.append(mask)
            out.append(encode_byte(mode, pens))
    return out


# ---------------------------------------------------------------- Spectrum


def spectrum_sprite_bits(img: Image) -> list[int]:
    """Spectrum sprite data (--zx-sprite): bit = 1 for every opaque pixel
    that isn't black, whatever the colour balance of its cell, in the same
    8x8-cell order as spectrum_convert. For sprites drawn by OR-ing (or
    through a mask) with colour set by the program's own attributes: the
    picture rule (paper = the most frequent colour of a cell) would invert
    cells where the sprite's pixels outnumber the background."""
    if img.w % 8 or img.h % 8:
        raise SystemExit(f"img2cpc: Spectrum image size {img.w}x{img.h} must be a multiple of 8")
    bitmap: list[int] = []
    for cy in range(0, img.h, 8):
        for cx in range(0, img.w, 8):
            for y in range(cy, cy + 8):
                b = 0
                for c in range(8):
                    p = img.pix[y][cx + c]
                    if p is not None and p[:3] != (0, 0, 0):
                        b |= 1 << (7 - c)
                bitmap.append(b)
    return bitmap


def spectrum_convert(img: Image) -> tuple[list[int], list[int]]:
    if img.w % 8 or img.h % 8:
        raise SystemExit(f"img2cpc: Spectrum image size {img.w}x{img.h} must be a multiple of 8")
    bitmap: list[int] = []
    attrs: list[int] = []
    for cy in range(0, img.h, 8):
        for cx in range(0, img.w, 8):
            cell = []
            for y in range(cy, cy + 8):
                for x in range(cx, cx + 8):
                    p = img.pix[y][x]
                    cell.append((0, 0) if p is None else ZX_CANDS[nearest(p, ZX_TABLE)])
            cnt = Counter(cell)
            first = {}
            for i, c in enumerate(cell):
                first.setdefault(c, i)
            order = sorted(cnt, key=lambda c: (-cnt[c], first[c]))
            paper = order[0]
            ink = order[1] if len(order) > 1 else paper
            if ink[0] == paper[0]:  # same colour, differing only in brightness
                ink = paper
            nonblack = [c for c in (paper, ink) if c[0] != 0]
            bright = 0
            if nonblack:
                bright = max(nonblack, key=lambda c: cnt[c])[1]
            attrs.append(bright << 6 | paper[0] << 3 | ink[0])
            ink_rgb, paper_rgb = zx_rgb(ink[0], bright), zx_rgb(paper[0], bright)
            for r in range(8):
                b = 0
                for c in range(8):
                    idx, _br = cell[r * 8 + c]
                    if ink[0] == paper[0]:
                        bit = 0
                    elif idx == ink[0]:
                        bit = 1
                    elif idx == paper[0]:
                        bit = 0
                    else:
                        p = img.pix[cy + r][cx + c]
                        bit = 1 if p is not None and dist2(p, ink_rgb) < dist2(p, paper_rgb) else 0
                    b |= bit << (7 - c)
                bitmap.append(b)
    return bitmap, attrs


# ---------------------------------------------------------------- CPC Plus


def q4(c: int) -> int:
    """8-bit channel to 4 bits (exact for multiples of 0x11)."""
    return (c * 15 + 127) // 255


def rgb12(p: tuple[int, int, int]) -> tuple[int, int, int]:
    return q4(p[0]), q4(p[1]), q4(p[2])


def asic_entry(c: tuple[int, int, int]) -> list[int]:
    """The two palette-RAM bytes of a 4-bit (r, g, b) colour."""
    return [c[0] << 4 | c[2], c[1]]


def parse_rgb12_list(text: str) -> list[tuple[int, int, int]]:
    out = []
    for line in text.splitlines():
        line = line.split("#", 1)[0]
        for tok in line.replace(",", " ").split():
            if len(tok) != 3 or any(ch not in "0123456789abcdefABCDEF" for ch in tok):
                raise SystemExit(f"img2cpc: bad 12-bit colour {tok!r} (expected three hex digits RGB)")
            out.append((int(tok[0], 16), int(tok[1], 16), int(tok[2], 16)))
    return out


def plus_colours(pixels, limit: int, what: str, fixed) -> list[tuple[int, int, int]]:
    """The palette: `fixed` if given, else the distinct 12-bit colours of
    `pixels` (None = transparent) in order of first appearance (at most `limit`)."""
    if fixed is not None:
        if len(fixed) > limit:
            raise SystemExit(f"img2cpc: palette has {len(fixed)} entries, {what} has {limit}")
        return list(fixed)
    pal: list[tuple[int, int, int]] = []
    for p in pixels:
        if p is not None:
            c = rgb12(p)
            if c not in pal:
                pal.append(c)
    if len(pal) > limit:
        raise SystemExit(
            f"img2cpc: the image has {len(pal)} distinct 12-bit colours, {what} has only {limit}; pass --palette"
        )
    return pal


def plus_sprite_data(img: Image, packed: bool, fixed) -> tuple[list[int], list[int], int]:
    """(sprite bytes, palette bytes (30), frames)."""
    if img.w % 16 or img.h % 16:
        raise SystemExit(f"img2cpc: sprite image {img.w}x{img.h} must be a whole number of 16x16 cells")
    cells = [(x, y) for y in range(0, img.h, 16) for x in range(0, img.w, 16)]
    order = [img.pix[y + r][x + c] for x, y in cells for r in range(16) for c in range(16)]
    pal = plus_colours(order, 15, "the sprite palette", fixed)
    if not pal:
        pal = [(0, 0, 0)]
    idx: dict = {}

    def pen(p):
        if p is None:
            return 0
        c = rgb12(p)
        if c not in idx:
            idx[c] = 1 + (nearest(c, pal) if fixed is not None else pal.index(c))
        return idx[c]

    data: list[int] = []
    for x, y in cells:
        px = [pen(img.pix[y + r][x + c]) for r in range(16) for c in range(16)]
        if packed:
            data += [px[i] << 4 | px[i + 1] for i in range(0, 256, 2)]
        else:
            data += px
    pal_bytes: list[int] = []
    for c in pal:
        pal_bytes += asic_entry(c)
    pal_bytes += [0, 0] * (15 - len(pal))
    return data, pal_bytes, len(cells)


def plus_palette_data(img: Image, fixed) -> list[int]:
    pal = plus_colours([p for row in img.pix for p in row], 16, "the ASIC", fixed)
    if not pal:
        pal = [(0, 0, 0)]
    out: list[int] = []
    for c in pal:
        out += asic_entry(c)
    out += [0, 0] * (16 - len(pal))
    return out


def fmt_asm(name: str, data: list[int]) -> str:
    lines = [f"{name}:"]
    for i in range(0, len(data), 16):
        lines.append("    defb " + ", ".join(f"${b:02X}" for b in data[i : i + 16]))
    return "\n".join(lines) + "\n"


def plus_convert(args, img: Image):
    """(arrays [(name, bytes)], consts [(name, value)], description)."""
    name = args.name
    fixed = None
    if args.palette is not None:
        fixed = parse_rgb12_list(args.palette)
    elif args.palette_file is not None:
        fixed = parse_rgb12_list(Path(args.palette_file).read_text())
    if args.plus_sprite:
        data, pal, frames = plus_sprite_data(img, args.packed, fixed)
        size = len(data) // frames
        consts = [(name + "_FRAMES", frames), (name + "_SIZE", size), (name + "_PALN", 15)]
        desc = (f"{frames} sprite(s) of {size} bytes "
                f"({'packed 4-bit' if args.packed else 'one byte per pixel'}), palette 15 entries")
        return [(name, data), (name + "_pal", pal)], consts, desc
    return [(name + "_pal", plus_palette_data(img, fixed))], [], "16 pen colours, 32 bytes"


# ---------------------------------------------------------------- sidecar


def _is_int(v) -> bool:
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


def _no_constant(c: str):
    raise ValueError(c)


def sidecar_path(image: Path) -> Path:
    return image.with_name(image.stem + ".cpcbuild.json")


def load_sidecar(path: Path) -> dict:
    """The settings of a NAME.cpcbuild.json: a dict with the keys it has among
    kind, mode, name, frame, masked, tile_width, palette, tags (a list of
    (name, from, to), always present). Anything wrong is a SystemExit."""

    def bad(what: str):
        raise SystemExit(f"img2cpc: {path}: {what}")

    try:
        raw = json.loads(path.read_text(encoding="utf-8"), parse_constant=_no_constant)
    except OSError:
        bad("cannot be read")
    except ValueError:
        bad("not valid JSON")
    if not isinstance(raw, dict):
        bad("must hold one JSON object")
    if raw.get("format") != "cpcbuild-image":
        bad('"format" must be "cpcbuild-image"')
    if not _is_int(raw.get("version")) or raw["version"] != 1:
        bad('"version" must be 1')
    out: dict = {"tags": []}

    def field(key: str, ok, what: str, dest: str | None = None, conv=lambda v: v):
        if key in raw:
            if not ok(raw[key]):
                bad(f'"{key}" must be {what}')
            out[dest or key] = conv(raw[key])

    field("kind", lambda v: v in ("sprite", "tiles") and isinstance(v, str), '"sprite" or "tiles"')
    field("mode", lambda v: _is_int(v) and v in (0, 1, 2), "0, 1 or 2", conv=int)
    field("name", lambda v: isinstance(v, str) and v != "", "a non-empty string")
    field("frame", lambda v: isinstance(v, str) and re.fullmatch("[0-9]+x[0-9]+", v) is not None, 'a "WxH" string')
    field("masked", lambda v: isinstance(v, bool), "true or false")
    field("tileWidth", lambda v: _is_int(v) and v >= 1, "a whole number of pixels", "tile_width", int)
    field("palette", lambda v: isinstance(v, list) and all(_is_int(c) and 0 <= c <= 26 for c in v),
          "a list of firmware colours 0-26", conv=lambda v: [int(c) for c in v])
    tag_ok = lambda v: (isinstance(v, dict) and isinstance(v.get("name"), str) and v["name"] != ""
                        and _is_int(v.get("from")) and _is_int(v.get("to")))
    field("tags", lambda v: isinstance(v, list) and all(tag_ok(t) for t in v),
          'a list of {"name", "from", "to"}', conv=lambda v: [(t["name"], int(t["from"]), int(t["to"])) for t in v])
    return out


def apply_sidecar(args, side: dict) -> None:
    """Makes the sidecar's settings the defaults of args (the command line wins)."""
    if args.mode is None and "mode" in side:
        args.mode = side["mode"]
    if args.name is None and "name" in side:
        args.name = side["name"]
    if not args.sprite and not args.tiles and side.get("kind") == "tiles":
        args.tiles = True
    if args.palette is None and args.palette_file is None and "palette" in side:
        args.palette = ",".join(map(str, side["palette"]))
    if args.tiles:
        if args.tile_width is None and side.get("tile_width", 8) != 8:
            args.tile_width = side["tile_width"]
    else:
        if args.frame is None and "frame" in side:
            args.frame = side["frame"]
        if side.get("masked"):
            args.masked = True
        args.sidecar_tags = side["tags"]


def tag_consts(args, name: str, nframes: int) -> list[tuple[str, int]]:
    """NAME_<TAG> and NAME_<TAG>_LEN for the sidecar's tags."""
    out: list[tuple[str, int]] = []
    taken = {name.upper() + "_" + s for s in ("W", "H", "FRAMES", "SIZE", "PENS", "PAL")}
    for tag, first, last in getattr(args, "sidecar_tags", []):
        if not 0 <= first <= last < nframes:
            raise SystemExit(
                f'img2cpc: {args.sidecar_path}: tag "{tag}" is frames {first}-{last}, '
                f"but the sheet has {nframes} frames"
            )
        const = f"{name}_" + re.sub("[^A-Z0-9]", "_", tag.upper())
        for c in ((const, first), (const + "_LEN", last - first + 1)):
            if c[0].upper() in taken:
                raise SystemExit(f'img2cpc: {args.sidecar_path}: tag "{tag}" makes {c[0]}, which is already defined')
            taken.add(c[0].upper())
            out.append(c)
    return out


# ---------------------------------------------------------------- output


def fmt_array(name: str, data: list[int]) -> str:
    if not data:
        raise SystemExit(f"img2cpc: nothing to emit for {name}")
    if len(data) > 65535:
        raise SystemExit(f"img2cpc: {name} would have {len(data)} bytes (the limit is 65535)")
    lines = []
    for i in range(0, len(data), 16):
        chunk = ", ".join(f"${b:02X}" for b in data[i : i + 16])
        lines.append("    " + chunk + (", _" if i + 16 < len(data) else " _"))
    return f"DIM {name}({len(data) - 1}) AS UBYTE => {{ _\n" + "\n".join(lines) + "\n}\n"


def fmt_const(name: str, value: int) -> str:
    return f"CONST {name} AS UBYTE = {value}\n" if value < 256 else f"CONST {name} AS UINTEGER = {value}\n"


def parse_wxh(s: str) -> tuple[int, int]:
    try:
        w, h = s.lower().split("x")
        w, h = int(w), int(h)
        if w < 1 or h < 1:
            raise ValueError
    except ValueError:
        raise SystemExit(f"img2cpc: bad --frame {s!r} (expected WxH in pixels)")
    return w, h


def moved_colours(img: Image, grid, pal: list[int]) -> list[tuple[tuple[int, int, int], int]]:
    """(image colour, pen) for each opaque colour, in order of first appearance,
    that is not exactly the firmware colour of its pen."""
    pens: dict = {}
    for prow, grow in zip(img.pix, grid):
        for p, pen in zip(prow, grow):
            if p is not None and p not in pens:
                pens[p] = pen
    return [(p, pen) for p, pen in pens.items() if p != FW_TABLE[pal[pen]]]


def convert(args, img: Image, info: dict | None = None) -> tuple[str, str]:
    """Returns (body text, description of the sizes). A dict as `info` is
    filled with the figures --check reports."""
    name = args.name
    body: list[str] = []
    if args.spectrum:
        bitmap, attrs = spectrum_convert(img)
        if args.zx_sprite:
            bitmap = spectrum_sprite_bits(img)
        body.append(fmt_array(name, bitmap))
        body.append(fmt_array(name + "_attr", attrs))
        body.append(fmt_const(name + "_COLS", img.w // 8))
        body.append(fmt_const(name + "_ROWS", img.h // 8))
        return "".join(body), f"spectrum {img.w // 8}x{img.h // 8} cells, {len(bitmap)} + {len(attrs)} bytes"

    mode, ppb = args.mode, PPB[args.mode]
    if img.w % ppb:
        raise SystemExit(
            f"img2cpc: image width {img.w} is not a multiple of {ppb} (mode {mode} has {ppb} pixels per byte)"
        )
    fixed = None
    if args.palette is not None:
        fixed = parse_pal_list(args.palette)
    elif args.palette_file is not None:
        fixed = parse_pal_list(Path(args.palette_file).read_text())
    pal = build_palette(img, mode, fixed, args.pen0)
    grid = pen_grid(img, pal)
    if info is not None:
        info.update(pens=pal, moved=moved_colours(img, grid, pal), transparent=sum(p is None for r in grid for p in r))
    if args.write_palette and not args.check:
        Path(args.write_palette).write_text(
            f"# firmware colours for pens 0-{len(pal) - 1} (img2cpc, mode {mode})\n" + ", ".join(map(str, pal)) + "\n"
        )

    if args.tiles:
        if args.masked:
            raise SystemExit("img2cpc: --masked applies to sprites only")
        tw = args.tile_width if args.tile_width is not None else 8
        if tw not in (ppb, ppb * 2, ppb * 4):
            raise SystemExit(
                f"img2cpc: tile width {tw} must be {ppb}, {ppb * 2} or {ppb * 4} pixels in mode {mode} (1, 2 or 4 bytes)"
            )
        if tw == 8:
            if img.w % 8 or img.h % 8:
                raise SystemExit(f"img2cpc: tile image size {img.w}x{img.h} must be a multiple of 8")
        elif img.w % tw or img.h % 8:
            raise SystemExit(f"img2cpc: tile image size {img.w}x{img.h} must be a multiple of {tw}x8")
        tiles: list[list[int]] = []
        cells: list[int] = []
        for ty in range(0, img.h, 8):
            for tx in range(0, img.w, tw):
                t = pack_block(grid, tx, ty, tw, 8, mode, False)
                if args.dedupe and t in tiles:
                    cells.append(tiles.index(t))
                else:
                    tiles.append(t)
                    cells.append(len(tiles) - 1)
        if len(tiles) > 256:
            raise SystemExit(f"img2cpc: {len(tiles)} tiles; tile numbers go up to 255")
        if info is not None:
            info.update(count=len(tiles), tw=tw, each=len(tiles[0]), total=sum(map(len, tiles)),
                        repeats=len(cells) - len({tuple(t) for t in tiles}))
        body.append(fmt_array(name, [b for t in tiles for b in t]))
        body.append(fmt_const(name + "_COUNT", len(tiles)))
        if tw != 8:
            body.append(fmt_const(name + "_TILEW", tw // ppb))
        if args.dedupe:
            body.append(fmt_array(name + "_MAP", cells))
            body.append(fmt_const(name + "_MAPW", img.w // tw))
            body.append(fmt_const(name + "_MAPH", img.h // 8))
        desc = f"{len(tiles)} tile{'s' if len(tiles) != 1 else ''} of {len(tiles[0])} bytes"
    else:
        fw, fh = img.w, img.h
        if args.frame:
            fw, fh = parse_wxh(args.frame)
            if img.w % fw or img.h % fh:
                raise SystemExit(f"img2cpc: image {img.w}x{img.h} is not a whole number of {fw}x{fh} frames")
        if fw % ppb:
            raise SystemExit(f"img2cpc: frame width {fw} is not a multiple of {ppb} (mode {mode})")
        data: list[int] = []
        nframes = 0
        for y in range(0, img.h, fh):
            for x in range(0, img.w, fw):
                data += pack_block(grid, x, y, fw, fh, mode, args.masked)
                nframes += 1
        size = len(data) // nframes
        body.append(fmt_array(name, data))
        body.append(fmt_const(name + "_W", fw // ppb))
        body.append(fmt_const(name + "_H", fh))
        body.append(fmt_const(name + "_FRAMES", nframes))
        body.append(fmt_const(name + "_SIZE", size))
        for cname, value in tag_consts(args, name, nframes):
            body.append(fmt_const(cname, value))
        if info is not None:
            info.update(frames=nframes, fw=fw, fh=fh, each=size, total=len(data))
        desc = (
            f"{nframes} frame(s) of {fw // ppb} bytes x {fh} lines"
            f"{', masked' if args.masked else ''}, {size} bytes each"
        )
    if not args.no_palette:
        body.append(fmt_array(name + "_pal", pal))
        body.append(fmt_const(name + "_PENS", len(pal)))
    return "\n".join(body), desc


def check_report(args, img: Image, info: dict, side: Path | None) -> str:
    ppb = PPB[args.mode]
    lines = [f"check: {args.image} {img.w}x{img.h} pixels, mode {args.mode}, {'tiles' if args.tiles else 'sprite'}"]
    if side:
        lines.append(f"  sidecar: {side}")
    if args.tiles:
        line = (f"  tiles: {info['count']} of {info['tw']}x8 pixels "
                f"({info['tw'] // ppb} bytes wide, {info['each']} bytes each)")
        n = info["repeats"]
        if n:
            rep = f"{n} repeat" + ("s" if n > 1 else "")
            line += f", {rep} dropped" if args.dedupe else f", {rep} (--dedupe would drop {'it' if n == 1 else 'them'})"
        lines.append(line)
    else:
        lines.append(f"  frames: {info['frames']} of {info['fw']}x{info['fh']} pixels "
                     f"({'masked, ' if args.masked else ''}{info['fw'] // ppb} bytes x {info['fh']} lines, "
                     f"{info['each']} bytes each)")
    lines.append("  pens: " + " ".join(f"{pen}={fw}" for pen, fw in enumerate(info["pens"])))
    if info["moved"]:
        lines.append(f"  colours moved: {len(info['moved'])}")
        for (r, g, b), pen in info["moved"]:
            lines.append(f"    #{r:02X}{g:02X}{b:02X} -> pen {pen} (firmware {info['pens'][pen]})")
    if info["transparent"] and not args.masked:
        lines.append(f"  transparent pixels: {info['transparent']}")
    lines.append(f"  total: {info['total']} bytes")
    lines.append("  ok")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", type=Path, help="source PNG")
    ap.add_argument("--mode", type=int, choices=(0, 1, 2), help="CPC screen mode (required unless --spectrum)")
    ap.add_argument("--name", help="array name prefix (default: the file stem)")
    ap.add_argument("-o", "--output", type=Path, help="output .bas (default stdout)")
    kind = ap.add_mutually_exclusive_group()
    kind.add_argument("--sprite", action="store_true", help="whole image as a sprite (default)")
    kind.add_argument("--tiles", action="store_true", help="cut into 8x8 tiles")
    ap.add_argument("--tile-width", type=int, metavar="PX",
                    help="tiles: tile width in pixels, 1, 2 or 4 bytes (default 8); emits NAME_TILEW")
    ap.add_argument("--frame", metavar="WxH", help="sprite frame size in pixels (cut a sheet, row-major)")
    ap.add_argument("--dedupe", action="store_true", help="tiles: drop repeats and emit NAME_MAP")
    ap.add_argument("--masked", action="store_true", help="sprites: emit (mask, pixel) pairs")
    ap.add_argument("--transparent", metavar="RRGGBB", help="colour to treat as transparent")
    ap.add_argument("--palette", metavar="LIST", help="fixed pens: firmware colours, comma-separated")
    ap.add_argument("--palette-file", metavar="F", help="fixed pens read from a file")
    ap.add_argument("--pen0", type=int, metavar="N", help="auto palette: firmware colour for pen 0")
    ap.add_argument("--no-palette", action="store_true", help="don't emit NAME_pal / NAME_PENS")
    ap.add_argument("--write-palette", metavar="F", help="save the palette used")
    ap.add_argument("--plus-sprite", action="store_true", help="CPC Plus hardware sprite data + palette")
    ap.add_argument("--plus-palette", action="store_true", help="CPC Plus 16 pen colours (12-bit) of the image")
    ap.add_argument("--packed", action="store_true", help="--plus-sprite: two pixels per byte")
    ap.add_argument("--plus-format", choices=("bas", "asm", "bin"), default="bas", help="--plus-*: output format")
    ap.add_argument("--spectrum", action="store_true", help="emit ZX Spectrum bitmap + attributes")
    ap.add_argument("--zx-sprite", action="store_true",
                    help="with --spectrum: sprite data, bit = 1 for every opaque non-black pixel (no per-cell ink/paper choice)")
    ap.add_argument("--no-sidecar", action="store_true", help="ignore NAME.cpcbuild.json beside the image")
    ap.add_argument("--check", action="store_true", help="convert but write nothing; report what would be made")
    args = ap.parse_args(argv)
    args.sidecar_tags = []

    plus = args.plus_sprite or args.plus_palette
    if args.plus_sprite and args.plus_palette:
        ap.error("use --plus-sprite or --plus-palette, not both")
    if plus and args.spectrum:
        ap.error("--plus-* and --spectrum are exclusive")
    if args.packed and not args.plus_sprite:
        ap.error("--packed needs --plus-sprite")
    if args.plus_format != "bas" and not plus:
        ap.error("--plus-format needs --plus-sprite or --plus-palette")
    if args.plus_format == "bin" and not args.output:
        ap.error("--plus-format bin needs -o")
    if args.check and args.output:
        ap.error("--check writes nothing; leave out -o")
    if args.check and (plus or args.spectrum):
        ap.error("--check is for CPC modes, not --spectrum or --plus-*")
    side_file = None
    if not plus and not args.spectrum and not args.no_sidecar:
        sp = sidecar_path(args.image)
        if sp.is_file():
            side_file = sp
            args.sidecar_path = sp
            apply_sidecar(args, load_sidecar(sp))
    if not plus and not args.spectrum and args.mode is None:
        ap.error("--mode is required (or --spectrum, --plus-sprite, --plus-palette)")
    if args.zx_sprite and not args.spectrum:
        ap.error("--zx-sprite needs --spectrum")
    if args.pen0 is not None and not 0 <= args.pen0 <= 26:
        ap.error("--pen0 must be a firmware colour 0-26")
    if args.palette is not None and args.palette_file is not None:
        ap.error("use --palette or --palette-file, not both")
    if args.dedupe and not args.tiles:
        ap.error("--dedupe needs --tiles")
    if args.tile_width is not None and not args.tiles:
        ap.error("--tile-width needs --tiles")
    if args.frame and args.tiles:
        ap.error("--frame is for sprites")
    if not args.image.exists():
        ap.error(f"{args.image}: not found")
    if args.name is None:
        stem = "".join(c if c.isalnum() else "_" for c in args.image.stem)
        args.name = stem if stem and not stem[0].isdigit() else "img_" + stem
    transparent = None
    if args.transparent:
        t = args.transparent.lstrip("#")
        try:
            if len(t) != 6:
                raise ValueError
            transparent = (int(t[0:2], 16), int(t[2:4], 16), int(t[4:6], 16))
        except ValueError:
            ap.error("--transparent expects RRGGBB")

    img = load_image(args.image, transparent)
    cmd = "img2cpc.py " + " ".join(shlex.quote(a) for a in (sys.argv[1:] if argv is None else argv))
    if side_file:
        cmd += f" (settings from {side_file.name})"
    cmt = ";" if args.plus_format == "asm" else "'"
    if plus:
        arrays, consts, desc = plus_convert(args, img)
        if args.plus_format == "bin":
            args.output.write_bytes(bytes(arrays[0][1]))
            if len(arrays) == 2:
                args.output.with_suffix(".pal").write_bytes(bytes(arrays[1][1]))
            return 0
        if args.plus_format == "asm":
            body = "\n".join([fmt_asm(n, d) for n, d in arrays] + [f"{n} EQU {v}\n" for n, v in consts])
        else:
            body = "\n".join([fmt_array(n, d) for n, d in arrays] + [fmt_const(n, v) for n, v in consts])
        mode_txt = "CPC Plus"
    else:
        info = {} if args.check else None
        body, desc = convert(args, img, info)
        if args.check:
            sys.stdout.write(check_report(args, img, info, side_file))
            return 0
        mode_txt = "Spectrum" if args.spectrum else "mode " + str(args.mode)
    head = (
        f"{cmt} Generated by {cmd}\n"
        f"{cmt} Source: {args.image}, {img.w}x{img.h} pixels, {mode_txt}\n"
        f"{cmt} {desc}\n"
        f"{cmt} Do not edit; regenerate it from the source image (command above).\n\n"
    )
    text = head + body
    if args.output:
        args.output.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
