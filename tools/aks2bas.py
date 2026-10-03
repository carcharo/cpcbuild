#!/usr/bin/env python3
"""aks2bas.py -- Arkos Tracker songs / sound-effect banks -> Boriel include.

    aks2bas.py song.aks   out.bas [--name NAME] [--subsongs 1,3]  # SongToAkg
    aks2bas.py --sfx bank.aks out.bas [--name NAME]               # SongToSoundEffects
    aks2bas.py song.aks   out.bas --at 0x4000 [--bin out.bin]       # a song for a 6128 RAM bank
    aks2bas.py [--sfx] in.aks out.bas --psg spectrum|cpc          # set the sound chip's clock
    aks2bas.py --from-asm src.asm out.bas [--name NAME] [--prefix P]
                                          # no Arkos tool: convert an
                                          # already-exported AKG/AKX source

The Arkos command-line tools export Z80 source (AKG format for songs, AKX
for sound effects) in a profile that needs three changes for Boriel's
assembler, done here by post-processing (no custom source profile needed):
labels get a ':' (and go on their own line), '#hex' becomes '0x', and the
whole thing is wrapped in an `asm` block. The tools are run with
--labelPrefix NAME_ so several songs in one program can't clash.

Songs for a 6128 RAM bank (--at). AKG song data holds absolute addresses, so
a song that lives in an extra bank (paged in at &4000-&7FFF, see lib/music
and lib/cpcbuild/banks.bas) must be exported for the address it will have
there: `--at 0x4000` runs SongToAkg's binary export (--exportAsBinary
--encodingAddress) instead of the source export. The include then defines
NAME (the image, in the program, for BankCopyIn(bank, 0x4000, @NAME,
NAME_length)) and the constant NAME_length; `--bin FILE` also writes the
raw bytes (to put on a disc for BankLoad: `cpcrun.py --disk-file
TUNE.BIN=FILE`, and the AMSDOS header gets added by the disc tools). Every
subsong chosen with --subsongs (default all) goes into the one image; the
song is then started with MusicInitBank(0x4000, subsong, bank).

Sound chip clock (--psg). The Arkos exporters take the PSG clock from the
song itself (the .aks's <frequencyHz>, 1 MHz for a CPC song, 1.7734 MHz for
a Spectrum one ...) and have no option for it. It matters for sound effects
only: an AKX bank stores software periods, computed from that clock, so a
bank exported for the CPC plays about 10 semitones flat on a Spectrum. AKG
song data stores notes and the player converts them with its own period
table, so a song exports byte-identically whatever the clock (checked with
SongToAkg). `--psg cpc|spectrum` makes this tool rewrite the clock in a
temporary copy of the .aks before the export (1000000 or 1773400 Hz); without
it the song's own clock is kept. Not available with --from-asm (the periods
are already baked in).

The output is a .bas include. Use it like this (see lib/music/music.bas):

    #include <music/music.bas>
    #include "tune.bas"                  ' made by: aks2bas.py tune.aks tune.bas --name tune
    MusicInit(@tune, 0)                  ' @tune: address of the song data

    #include "sfx.bas"                   ' aks2bas.py --sfx sfx.aks sfx.bas --name sfx
    SfxInit(@sfx)

`@NAME` works because the generated code puts a BASIC label NAME right in
front of the data; the data itself sits in the program image, jumped over
by a `jp` at the point of the #include (include it at the top level, before
the program proper, like any library).

The Arkos tools are looked up in $AT3_TOOLS, then tools/arkos/work/bin
(created by tools/arkos/fetch.sh).
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIRECTIVES = {"db", "dw", "defb", "defw", "defs", "ds", "org", "equ", "dm", "defm"}
LABEL_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)(:?)(?:[ \t]+(.*))?$")
HEX_HASH = re.compile(r"(?<![A-Za-z0-9_$#])#([0-9A-Fa-f]+)\b")


def split_code_comment(s: str) -> tuple[str, str]:
    """Split `code ; comment`, ignoring ';' inside double-quoted strings."""
    q = False
    for i, ch in enumerate(s):
        if ch == '"':
            q = not q
        elif ch == ";" and not q:
            return s[:i], s[i:]
    return s, ""


def map_outside_strings(code: str, fn) -> str:
    parts = re.split(r'("[^"]*")', code)
    return "".join(p if p.startswith('"') else fn(p) for p in parts)


def sanitize_name(name: str) -> str:
    n = re.sub(r"[^A-Za-z0-9_]", "_", name)
    if not n or n[0].isdigit():
        n = "_" + n
    return n


def to_boriel(text: str, name: str, prefix: str = "", kind: str = "song") -> str:
    """Post-process an Arkos source export into a Boriel include (.bas)."""
    raw = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    # Pass 1: every column-0 label (with or without ':').
    labels: list[str] = []
    for line in raw:
        if not line or line[0] in " \t;":
            continue
        m = LABEL_RE.match(line.rstrip())
        if m and m.group(1).lower() not in DIRECTIVES:
            labels.append(m.group(1))
    if not labels:
        raise ValueError("no labels found: not an Arkos source export?")
    lset = set(labels)

    def fix_ops(code: str) -> str:
        def sub(p: str) -> str:
            p = HEX_HASH.sub(lambda m: "0x" + m.group(1), p)
            if prefix:
                p = re.sub(r"[A-Za-z_][A-Za-z0-9_]*",
                           lambda m: prefix + m.group(0) if m.group(0) in lset else m.group(0), p)
            return p
        return map_outside_strings(code, sub)

    out: list[str] = []
    for line in raw:
        if not line.strip():
            if out and out[-1] != "":
                out.append("")
            continue
        if line.lstrip()[0] == ";":
            out.append("    " + line.strip())
            continue
        if line[0] not in " \t":
            m = LABEL_RE.match(line.rstrip())
            if m and m.group(1).lower() not in DIRECTIVES:
                out.append(f"{prefix}{m.group(1)}:")
                rest = m.group(3)
                if rest:
                    code, com = split_code_comment(rest)
                    if code.strip():
                        out.append("    " + (fix_ops(code.strip()) + (" " + com if com else "")))
                    elif com:
                        out.append("    " + com)
                continue
        code, com = split_code_comment(line)
        code = fix_ops(code.strip())
        out.append("    " + (code + ("    " + com if com else "")).strip())
    while out and out[-1] == "":
        out.pop()

    guard = "__AKS_" + name.upper() + "__"
    skip = "__aks_" + name + "_end"
    what = "Arkos AKG song" if kind == "song" else "Arkos sound effects (AKX)"
    head = [
        f"' {name}.bas -- {what}, converted by tools/aks2bas.py. Do not edit.",
        f"' Use: #include this at the top level, then pass @{name} to "
        + ("MusicInit(@%s, subsong)." % name if kind == "song" else "SfxInit(@%s)." % name),
        "",
        f"#ifndef {guard}",
        f"#define {guard}",
        "",
        "asm",
        f"    jp {skip}",
        "end asm",
        f"{name}:",
        "asm",
    ]
    tail = [f"{skip}:", "end asm", "", "#endif", ""]
    return "\n".join(head + out + tail)


def bank_include(data: bytes, name: str, adr: int) -> str:
    """A .bas include holding a binary song image assembled for `adr`."""
    guard = "__AKS_" + name.upper() + "__"
    skip = "__aks_" + name + "_end"
    lines = []
    for i in range(0, len(data), 16):
        lines.append("    db " + ", ".join(f"0x{b:02X}" for b in data[i:i + 16]))
    head = [
        f"' {name}.bas -- Arkos AKG song assembled for bank address {adr:#06x}, converted by tools/aks2bas.py --at.",
        f"' Do not edit. {name} is the image (in the program, to copy into a bank at {adr:#06x} with",
        f"' BankCopyIn); {name}_length is its size; start it with MusicInitBank({adr:#06x}, subsong, bank).",
        "",
        f"#ifndef {guard}",
        f"#define {guard}",
        "",
        f"const {name}_length as uinteger = {len(data)}",
        "asm",
        f"    jp {skip}",
        "end asm",
        f"{name}:",
        "asm",
    ]
    tail = [f"{skip}:", "end asm", "", "#endif", ""]
    return "\n".join(head + lines + tail)


PSG_HZ = {"cpc": 1_000_000, "spectrum": 1_773_400}
FREQ_RE = re.compile(rb"(<frequencyHz>)\s*[0-9.]+\s*(</frequencyHz>)")


def set_psg_clock(data: bytes, hz: int) -> bytes:
    """Return the .aks XML (`data` may be the zip a tracker saves, or plain
    XML) with every PSG <frequencyHz> set to `hz`."""
    if data[:2] == b"PK":
        import io
        import zipfile
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n for n in z.namelist() if not n.endswith("/")]
            if not names:
                raise ValueError("empty .aks archive")
            data = z.read(names[0])
    out, n = FREQ_RE.subn(lambda m: m.group(1) + str(hz).encode() + m.group(2), data)
    if n == 0:
        raise ValueError("no <frequencyHz> in the song: not an Arkos .aks?")
    return out


def find_tool(tool: str) -> str:
    cands = []
    if os.environ.get("AT3_TOOLS"):
        cands.append(Path(os.environ["AT3_TOOLS"]) / tool)
    cands.append(HERE / "arkos" / "work" / "bin" / tool)
    for c in cands:
        if c.is_file():
            return str(c)
    sys.exit(f"aks2bas: {tool} not found (run tools/arkos/fetch.sh or set AT3_TOOLS)")


def run_tool(tool: str, args: list[str], timeout: int = 120) -> None:
    r = subprocess.run([find_tool(tool)] + args, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        sys.exit(f"aks2bas: {tool} failed ({r.returncode}):\n{r.stdout}{r.stderr}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--name", help="BASIC label / include name (default: output file stem)")
    ap.add_argument("--sfx", action="store_true", help="input is a song to export as a sound-effects bank")
    ap.add_argument("--from-asm", action="store_true", help="input is already an Arkos source export")
    ap.add_argument("--subsongs", help="SongToAkg: 1-based subsong numbers, comma separated (default all)")
    ap.add_argument("--psg", choices=sorted(PSG_HZ),
                    help="set the sound chip clock before exporting: cpc (1000000 Hz) or "
                         "spectrum (1773400 Hz, 128K AY); matters for --sfx (see above)")
    ap.add_argument("--at", metavar="ADDR",
                    help="export the song as a binary assembled for ADDR (0x4000-0x7FFF: a 6128 RAM bank "
                         "window); the include holds the image as data (see above)")
    ap.add_argument("--bin", metavar="FILE", help="--at: also write the raw binary here")
    ap.add_argument("--prefix", default="", help="--from-asm: prefix added to every label")
    a = ap.parse_args(argv)

    if a.at and (a.sfx or a.from_asm):
        ap.error("--at is for songs exported from an .aks/.vt2 (not with --sfx or --from-asm)")
    if a.bin and not a.at:
        ap.error("--bin needs --at")
    if a.psg and a.from_asm:
        ap.error("--psg can't be used with --from-asm (the periods are already in the source)")
    name = sanitize_name(a.name or Path(a.output).stem)
    kind = "sfx" if a.sfx else "song"
    if a.at:
        try:
            adr = int(a.at, 0)
        except ValueError:
            ap.error(f"--at {a.at}: not a number")
        if not 0x4000 <= adr <= 0x7FFF:
            ap.error("--at must be inside the bank window, 0x4000-0x7FFF")
        with tempfile.TemporaryDirectory() as td:
            tmp = str(Path(td) / "out.bin")
            inp = a.input
            if a.psg:
                patched = Path(td) / "in.aks"
                try:
                    patched.write_bytes(set_psg_clock(Path(a.input).read_bytes(), PSG_HZ[a.psg]))
                except ValueError as e:
                    sys.exit(f"aks2bas: {a.input}: {e}")
                inp = str(patched)
            extra = ["-s", a.subsongs] if a.subsongs else []
            run_tool("SongToAkg", extra + ["--exportAsBinary", "--encodingAddress", hex(adr), inp, tmp])
            data = Path(tmp).read_bytes()
        if adr + len(data) > 0x8000:
            sys.exit(f"aks2bas: the song ({len(data)} bytes) doesn't fit between {adr:#06x} and 0x7FFF")
        if a.bin:
            Path(a.bin).write_bytes(data)
        Path(a.output).write_text(bank_include(data, name, adr), encoding="utf-8")
        return 0
    if a.from_asm:
        src = Path(a.input).read_text(encoding="utf-8")
        prefix = a.prefix
    else:
        prefix = name + "_"
        with tempfile.TemporaryDirectory() as td:
            tmp = str(Path(td) / "out.asm")
            if a.psg:
                patched = Path(td) / "in.aks"
                try:
                    patched.write_bytes(set_psg_clock(Path(a.input).read_bytes(), PSG_HZ[a.psg]))
                except ValueError as e:
                    sys.exit(f"aks2bas: {a.input}: {e}")
                a.input = str(patched)
            if a.sfx:
                run_tool("SongToSoundEffects", ["--labelPrefix", prefix, a.input, tmp])
            else:
                extra = ["-s", a.subsongs] if a.subsongs else []
                run_tool("SongToAkg", extra + ["--labelPrefix", prefix, a.input, tmp])
            src = Path(tmp).read_text(encoding="utf-8")
        prefix = ""   # the tool already prefixed
    Path(a.output).write_text(to_boriel(src, name, prefix, kind), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
