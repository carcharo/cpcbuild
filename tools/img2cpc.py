#!/usr/bin/env python3
"""img2cpc.py -- converts a PNG into a Boriel BASIC include (a .bas file of
DIM ... => {...} arrays and CONSTs) for the cpcbuild library.

    img2cpc.py --mode 0|1|2 [--name NAME] [-o out.bas] image.png
               [--sprite [--frame WxH] | --tiles [--dedupe]] [--masked]
               [--transparent RRGGBB]
               [--palette 0,1,2,... | --palette-file F] [--pen0 N]
               [--no-palette] [--write-palette F]
    img2cpc.py --spectrum [--name NAME] [-o out.bas] image.png

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
"""
from __future__ import annotations

import argparse
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


def convert(args, img: Image) -> tuple[str, str]:
    """Returns (body text, description of the sizes)."""
    name = args.name
    body: list[str] = []
    if args.spectrum:
        bitmap, attrs = spectrum_convert(img)
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
    if args.write_palette:
        Path(args.write_palette).write_text(
            f"# firmware colours for pens 0-{len(pal) - 1} (img2cpc, mode {mode})\n" + ", ".join(map(str, pal)) + "\n"
        )

    if args.tiles:
        if args.masked:
            raise SystemExit("img2cpc: --masked applies to sprites only")
        if img.w % 8 or img.h % 8:
            raise SystemExit(f"img2cpc: tile image size {img.w}x{img.h} must be a multiple of 8")
        tiles: list[list[int]] = []
        cells: list[int] = []
        for ty in range(0, img.h, 8):
            for tx in range(0, img.w, 8):
                t = pack_block(grid, tx, ty, 8, 8, mode, False)
                if args.dedupe and t in tiles:
                    cells.append(tiles.index(t))
                else:
                    tiles.append(t)
                    cells.append(len(tiles) - 1)
        if len(tiles) > 256:
            raise SystemExit(f"img2cpc: {len(tiles)} tiles; tile numbers go up to 255")
        body.append(fmt_array(name, [b for t in tiles for b in t]))
        body.append(fmt_const(name + "_COUNT", len(tiles)))
        if args.dedupe:
            body.append(fmt_array(name + "_MAP", cells))
            body.append(fmt_const(name + "_MAPW", img.w // 8))
            body.append(fmt_const(name + "_MAPH", img.h // 8))
        desc = f"{len(tiles)} tiles of {len(tiles[0])} bytes"
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
        desc = (
            f"{nframes} frame(s) of {fw // ppb} bytes x {fh} lines"
            f"{', masked' if args.masked else ''}, {size} bytes each"
        )
    if not args.no_palette:
        body.append(fmt_array(name + "_pal", pal))
        body.append(fmt_const(name + "_PENS", len(pal)))
    return "\n".join(body), desc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", type=Path, help="source PNG")
    ap.add_argument("--mode", type=int, choices=(0, 1, 2), help="CPC screen mode (required unless --spectrum)")
    ap.add_argument("--name", help="array name prefix (default: the file stem)")
    ap.add_argument("-o", "--output", type=Path, help="output .bas (default stdout)")
    kind = ap.add_mutually_exclusive_group()
    kind.add_argument("--sprite", action="store_true", help="whole image as a sprite (default)")
    kind.add_argument("--tiles", action="store_true", help="cut into 8x8 tiles")
    ap.add_argument("--frame", metavar="WxH", help="sprite frame size in pixels (cut a sheet, row-major)")
    ap.add_argument("--dedupe", action="store_true", help="tiles: drop repeats and emit NAME_MAP")
    ap.add_argument("--masked", action="store_true", help="sprites: emit (mask, pixel) pairs")
    ap.add_argument("--transparent", metavar="RRGGBB", help="colour to treat as transparent")
    ap.add_argument("--palette", metavar="LIST", help="fixed pens: firmware colours, comma-separated")
    ap.add_argument("--palette-file", metavar="F", help="fixed pens read from a file")
    ap.add_argument("--pen0", type=int, metavar="N", help="auto palette: firmware colour for pen 0")
    ap.add_argument("--no-palette", action="store_true", help="don't emit NAME_pal / NAME_PENS")
    ap.add_argument("--write-palette", metavar="F", help="save the palette used")
    ap.add_argument("--spectrum", action="store_true", help="emit ZX Spectrum bitmap + attributes")
    args = ap.parse_args(argv)

    if not args.spectrum and args.mode is None:
        ap.error("--mode is required (or --spectrum)")
    if args.pen0 is not None and not 0 <= args.pen0 <= 26:
        ap.error("--pen0 must be a firmware colour 0-26")
    if args.palette is not None and args.palette_file is not None:
        ap.error("use --palette or --palette-file, not both")
    if args.dedupe and not args.tiles:
        ap.error("--dedupe needs --tiles")
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
    body, desc = convert(args, img)
    cmd = "img2cpc.py " + " ".join(shlex.quote(a) for a in (sys.argv[1:] if argv is None else argv))
    head = (
        f"' Generated by {cmd}\n"
        f"' Source: {args.image}, {img.w}x{img.h} pixels, "
        f"{'Spectrum' if args.spectrum else 'mode ' + str(args.mode)}\n"
        f"' {desc}\n"
        "' Do not edit; regenerate with tools/build_assets.sh.\n\n"
    )
    text = head + body
    if args.output:
        args.output.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
