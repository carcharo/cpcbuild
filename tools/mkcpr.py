#!/usr/bin/env python3
"""mkcpr.py -- builds an Amstrad CPC Plus / GX4000 cartridge (.cpr) from a
bare-metal program binary (zxbc --arch cpc -D CPC_BAREMETAL -D CPC_OWNFONT).

    mkcpr.py prog.bin [--load 0x40] [--entry 0x40] -o game.cpr

--load is the address the binary is compiled for (its origin); with no
--load it is read from the memory map zxbc wrote next to the binary
(prog.map, `.core.__START_PROGRAM`), the way cpcrun.py does. --entry
defaults to --load. The program must lie within RAM below &C000.

Formats (checked against Caprice32's cartridge.cpp / cap32.cpp / asic.cpp
and the cpcwiki CPR / ASIC pages as remembered through the sources noted
in docs/notes.md):
  * .cpr is RIFF: "RIFF", u32 LE (file size - 8), "AMS!", then chunks "cbNN"
    (NN = 00..31 as two ASCII digits), each: 4-byte id, u32 LE size, data
    (an odd size is followed by a pad byte; ours are always 16384 bytes, the
    size of a cartridge page, so there is none). Caprice32 loads the chunks
    in file order, ignoring the ids, so they are written in order, page 0
    first. At most 32 pages (512 KB).
  * Reset: interrupts off, cartridge page 0 at &0000 (the lower ROM), the
    ASIC locked, upper ROM selectable through the ROM-select port (&DFxx):
    a value of 128 + n puts cartridge page n at &C000 (Caprice32:
    page = val & 31 for val >= 128). Writes to &0000-&BFFF always reach RAM
    whatever ROM is paged in.

Cartridge layout made here:
  page 0 (cb00)  boot stub at &0000, the rest zero
  pages 1..N     the program image, 16 KB per page, in order
The stub runs from the lower ROM at reset, copies the image from the pages
(through the upper-ROM window at &C000) to RAM at the load address, pages the
upper ROM out, copies a tail of 13 bytes to RAM at &C000 (screen RAM,
free until the program's own start-up clears it) and jumps there; the tail
pages the lower ROM out too (Gate Array RMR &8D, mode 1, both ROMs off), RAM
configuration normal, and jumps to the entry. The stub needs neither the
ASIC unlock nor RMR2. The program's own bare boot (CPC_INIT_00_BOOTSTRAP)
then sets up the machine from a cold start; END resets via &0000 = the
cartridge page 0, which boots again (the stub restarts the program).
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

PAGE = 0x4000
MAX_PAGES = 32
TAIL_ADDR = 0xC000
RAM_TOP = 0xC000


def read_origin(map_path: Path) -> int:
    for line in map_path.read_text().splitlines():
        addr, _, label = line.partition(":")
        if label.strip() == ".core.__START_PROGRAM":
            return int(addr, 16)
    raise SystemExit(f"mkcpr: no .core.__START_PROGRAM in {map_path}; give --load")


def build_stub(load: int, entry: int, length: int) -> tuple[bytes, list[str]]:
    """The page-0 boot stub (Z80 bytes, tail included) and a listing."""

    def w(v):
        return [v & 0xFF, v >> 8]

    tail = bytes(
        [0x01] + w(0x7FC0) + [0xED, 0x49]      # ld bc,&7FC0 ; out (c),c  RAM configuration normal
        + [0x01] + w(0x7F8D) + [0xED, 0x49]    # ld bc,&7F8D ; out (c),c  lower ROM off too, mode 1
        + [0xC3] + w(entry)                    # jp entry
    )
    ins: list[tuple[list[int], str]] = [
        ([0xF3], "di"),
        ([0x01] + w(0x7F81), "ld bc,&7F81        ; GA RMR: mode 1, lower and upper ROM on"),
        ([0xED, 0x49], "out (c),c"),
    ]
    npages = (length + PAGE - 1) // PAGE
    dst, left = load, length
    for n in range(1, npages + 1):
        chunk = min(PAGE, left)
        ins += [
            ([0x01] + w(0xDF80 + n), f"ld bc,&DF{0x80 + n:02X}        ; upper ROM = cartridge page {n}"),
            ([0xED, 0x49], "out (c),c"),
            ([0x21] + w(0xC000), "ld hl,&C000"),
            ([0x11] + w(dst), f"ld de,&{dst:04X}"),
            ([0x01] + w(chunk), f"ld bc,&{chunk:04X}"),
            ([0xED, 0xB0], "ldir"),
        ]
        dst += chunk
        left -= chunk
    ins += [
        ([0x01] + w(0x7F89), "ld bc,&7F89        ; RMR: upper ROM off (lower still on)"),
        ([0xED, 0x49], "out (c),c"),
    ]
    # the tail follows the 5 instructions below (3 + 3 + 3 + 2 + 3 = 14 bytes)
    tail_at = sum(len(b) for b, _ in ins) + 14
    ins += [
        ([0x21] + w(tail_at), f"ld hl,&{tail_at:04X}        ; the tail (below)"),
        ([0x11] + w(TAIL_ADDR), "ld de,&C000"),
        ([0x01] + w(len(tail)), f"ld bc,{len(tail)}"),
        ([0xED, 0xB0], "ldir"),
        ([0xC3] + w(TAIL_ADDR), "jp &C000"),
    ]
    code = bytearray()
    lst: list[str] = []
    for b, text in ins:
        lst.append(f"{len(code):04X}  {bytes(b).hex(' ').upper():<12} {text}")
        code += bytes(b)
    assert len(code) == tail_at
    lst.append(f"{tail_at:04X}  tail, copied to RAM at &C000 ({len(tail)} bytes):")
    lst.append("      01 C0 7F ED 49  ld bc,&7FC0 ; out (c),c   RAM configuration normal")
    lst.append("      01 8D 7F ED 49  ld bc,&7F8D ; out (c),c   lower ROM off too, mode 1")
    lst.append(f"      C3 {entry & 0xFF:02X} {entry >> 8:02X}        jp &{entry:04X}")
    return bytes(code) + tail, lst


def build_cpr(image: bytes, load: int, entry: int | None = None) -> bytes:
    """The .cpr file bytes for a program image loaded at `load`."""
    if entry is None:
        entry = load
    if not image:
        raise ValueError("empty program image")
    if not (0 <= load <= 0xFFFF and 0 <= entry <= 0xFFFF):
        raise ValueError("load/entry must be 16-bit addresses")
    if load + len(image) > RAM_TOP:
        raise ValueError(
            f"program &{load:04X}-&{load + len(image) - 1:04X} does not fit below &{RAM_TOP:04X}"
        )
    npages = (len(image) + PAGE - 1) // PAGE
    if 1 + npages > MAX_PAGES:
        raise ValueError("too many cartridge pages")
    stub, _ = build_stub(load, entry, len(image))
    pages = [stub.ljust(PAGE, b"\0")]
    for i in range(npages):
        pages.append(image[i * PAGE : (i + 1) * PAGE].ljust(PAGE, b"\0"))
    body = b"AMS!"
    for n, data in enumerate(pages):
        body += b"cb%02d" % n + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


def write_cpr(path: Path | str, image: bytes, load: int, entry: int | None = None) -> None:
    Path(path).write_bytes(build_cpr(image, load, entry))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("binary", type=Path, help="bare-metal program binary (no AMSDOS header)")
    ap.add_argument("--load", type=lambda s: int(s, 0), help="load address (default: from prog.map)")
    ap.add_argument("--entry", type=lambda s: int(s, 0), help="entry address (default: --load)")
    ap.add_argument("-o", "--output", type=Path, help="output .cpr (default: binary with .cpr)")
    ap.add_argument("--listing", action="store_true", help="print the boot stub listing")
    args = ap.parse_args(argv)
    if not args.binary.exists():
        ap.error(f"{args.binary}: not found")
    image = args.binary.read_bytes()
    load = args.load
    if load is None:
        m = args.binary.with_suffix(".map")
        if not m.exists():
            ap.error("no --load and no .map next to the binary")
        load = read_origin(m)
    entry = load if args.entry is None else args.entry
    out = args.output or args.binary.with_suffix(".cpr")
    try:
        data = build_cpr(image, load, entry)
    except ValueError as e:
        raise SystemExit(f"mkcpr: {e}")
    out.write_bytes(data)
    if args.listing:
        print("\n".join(build_stub(load, entry, len(image))[1]))
    print(f"mkcpr: {out}: {len(data)} bytes, {len(data) // (PAGE + 8)} pages, load &{load:04X} entry &{entry:04X}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
