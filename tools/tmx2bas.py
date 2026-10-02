#!/usr/bin/env python3
"""tmx2bas.py -- converts a Tiled .tmx tile layer into a Boriel BASIC
include for the cpcbuild library's TileMap.

    tmx2bas.py map.tmx [--layer NAME] [--name NAME] [--empty N]
               [--firstgid N] [-o out.bas]

Emits `DIM NAME(n) AS UBYTE => {...}` (w*h tile numbers, row-major) and
`CONST NAME_W`, `NAME_H` (in tiles); use it as TileMap(@NAME(0), x, y,
NAME_W, NAME_H).

The tile number is the cell's gid minus the first tileset's firstgid (or
--firstgid), with Tiled's flip/rotation flags (the top bits of the gid)
stripped. An empty cell (gid 0) becomes --empty (default 0). Layer data
may be csv, or base64 with no compression, zlib or gzip. A tile number
above 255 is an error (TileMap takes one byte per cell). The layer is
--layer NAME, default the first tile layer. Infinite (chunked) maps and
zstd data are not supported.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import shlex
import struct
import sys
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

GID_MASK = 0x0FFFFFFF  # bits 31-29 flip flags, bit 28 hex rotation


def decode_data(data: ET.Element, count: int) -> list[int]:
    enc = data.get("encoding")
    comp = data.get("compression")
    text = data.text or ""
    if enc == "csv":
        if comp:
            raise ValueError("csv data cannot be compressed")
        gids = [int(t) for t in text.replace("\n", ",").split(",") if t.strip()]
    elif enc == "base64":
        raw = base64.b64decode("".join(text.split()))
        if comp in (None, ""):
            pass
        elif comp == "zlib":
            raw = zlib.decompress(raw)
        elif comp == "gzip":
            raw = gzip.decompress(raw)
        else:
            raise ValueError(f"unsupported compression {comp!r} (use none, zlib or gzip)")
        if len(raw) != 4 * count:
            raise ValueError(f"layer data is {len(raw)} bytes, expected {4 * count}")
        gids = list(struct.unpack(f"<{count}I", raw))
    elif enc is None:
        raise ValueError("XML tile data is not supported (use csv or base64)")
    else:
        raise ValueError(f"unsupported encoding {enc!r}")
    if len(gids) != count:
        raise ValueError(f"layer has {len(gids)} cells, expected {count}")
    return gids


def convert(tmx: Path, layer_name: str | None, firstgid: int | None, empty: int) -> tuple[list[int], int, int, str]:
    root = ET.parse(tmx).getroot()
    layers = root.findall("layer")
    if not layers:
        raise ValueError("no tile layers in the map")
    if layer_name is None:
        layer = layers[0]
    else:
        found = [l for l in layers if l.get("name") == layer_name]
        if not found:
            raise ValueError(f"no tile layer {layer_name!r} (have: {', '.join(l.get('name', '?') for l in layers)})")
        layer = found[0]
    if firstgid is None:
        ts = root.find("tileset")
        firstgid = int(ts.get("firstgid", "1")) if ts is not None else 1
    w = int(layer.get("width") or root.get("width"))
    h = int(layer.get("height") or root.get("height"))
    data = layer.find("data")
    if data is None:
        raise ValueError("layer has no data")
    if data.find("chunk") is not None:
        raise ValueError("infinite (chunked) maps are not supported")
    tiles = []
    for i, gid in enumerate(decode_data(data, w * h)):
        gid &= GID_MASK
        if gid == 0:
            n = empty
        elif gid < firstgid:
            raise ValueError(f"cell {i % w},{i // w}: gid {gid} is below firstgid {firstgid}")
        else:
            n = gid - firstgid
        if n > 255:
            raise ValueError(f"cell {i % w},{i // w}: tile number {n} does not fit in a byte")
        tiles.append(n)
    return tiles, w, h, layer.get("name", "")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tmx", type=Path, help="source .tmx")
    ap.add_argument("--layer", help="tile layer name (default: the first)")
    ap.add_argument("--name", help="array name (default: the file stem)")
    ap.add_argument("--empty", type=int, default=0, help="tile number for empty cells (default 0)")
    ap.add_argument("--firstgid", type=int, help="override the tileset's firstgid")
    ap.add_argument("-o", "--output", type=Path, help="output .bas (default stdout)")
    args = ap.parse_args(argv)
    if not 0 <= args.empty <= 255:
        ap.error("--empty must be 0-255")
    if not args.tmx.exists():
        ap.error(f"{args.tmx}: not found")
    name = args.name
    if name is None:
        name = "".join(c if c.isalnum() else "_" for c in args.tmx.stem)
        if not name or name[0].isdigit():
            name = "map_" + name
    try:
        tiles, w, h, lname = convert(args.tmx, args.layer, args.firstgid, args.empty)
    except (ValueError, ET.ParseError, OSError, zlib.error, EOFError) as e:
        print(f"tmx2bas: {args.tmx}: {e}", file=sys.stderr)
        return 1
    lines = []
    for i in range(0, len(tiles), 16):
        chunk = ", ".join(f"${b:02X}" for b in tiles[i : i + 16])
        lines.append("    " + chunk + (", _" if i + 16 < len(tiles) else " _"))
    cmd = "tmx2bas.py " + " ".join(shlex.quote(a) for a in (sys.argv[1:] if argv is None else argv))
    text = (
        f"' Generated by {cmd}\n"
        f"' Source: {args.tmx}, layer '{lname}', {w}x{h} tiles, {len(tiles)} bytes\n"
        "' Do not edit; regenerate with tools/build_assets.sh.\n\n"
        f"DIM {name}({len(tiles) - 1}) AS UBYTE => {{ _\n" + "\n".join(lines) + "\n}\n\n"
        f"CONST {name}_W AS UBYTE = {w}\n"
        f"CONST {name}_H AS UBYTE = {h}\n"
    )
    if args.output:
        args.output.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
