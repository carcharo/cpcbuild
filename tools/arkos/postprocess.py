#!/usr/bin/env python3
"""postprocess.py -- turn Disark's output into source Boriel's zxbasm accepts.

    postprocess.py IN.asm OUT.asm [--case-from SRC.asm ...] [--drop-org]
                   [--header FILE]

Disark (pasmo profile, 0x hex, undocumented opcodes as bytes) writes
labels in column 0 with no colon, often followed by an instruction on the
same line (`PLY_AKG_INIT ld de,4`), and all in upper case (Rasm's symbol
file is upper-cased). zxbasm wants `label:`. This script:

  * puts every column-0 label on its own line with a ':' suffix;
  * drops the `org` line (the block is relocatable: all references are
    labels) and Rasm wrapper labels given with --drop-label;
  * restores the original spelling of identifiers (PLY_AKG_Init rather
    than PLY_AKG_INIT) from the identifiers found in the --case-from
    sources, so the committed file is readable and greppable;
  * renames labels that clash with zxbasm reserved words (`end`, ...)
    by appending '_';
  * keeps `label equ $+n` (labels inside instructions) on one line, no ':';
  * strips trailing blanks.

No other line is touched, so the assembled bytes equal Rasm's (checked
by convert.sh).
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter

IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
LABEL_LINE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)(?::)?(?:\s+(.*))?$")

# Words zxbasm will not take as a label name (mnemonics, registers,
# directives).  Lower-case; compared case-insensitively.
RESERVED = {
    "end", "org", "align", "defb", "defw", "defs", "db", "dw", "ds", "equ",
    "include", "incbin", "if", "else", "endif", "macro", "endm", "proc",
    "endp", "local", "push", "pop", "namespace", "a", "b", "c", "d", "e",
    "h", "l", "af", "bc", "de", "hl", "sp", "ix", "iy", "ixh", "ixl", "iyh",
    "iyl", "i", "r", "nz", "z", "nc", "po", "pe", "p", "m",
}
MNEMONICS = set("""adc add and bit call ccf cp cpd cpdr cpi cpir cpl daa dec di
djnz ei ex exx halt im in inc ind indr ini inir jp jr ld ldd lddr ldi ldir
neg nop or otdr otir out outd outi pop push res ret reti retn rl rla rlc rlca
rld rr rra rrc rrca rrd rst sbc scf set sla sll sra srl sub xor""".split())


def case_map(paths: list[str]) -> dict[str, str]:
    """Upper-case identifier -> most common original spelling."""
    seen: dict[str, Counter] = {}
    for p in paths:
        with open(p, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.split(";", 1)[0]
                for m in IDENT.finditer(line):
                    seen.setdefault(m.group(0).upper(), Counter())[m.group(0)] += 1
    out = {}
    for up, counts in seen.items():
        # Prefer a spelling that isn't all upper/lower if there is one.
        best = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        mixed = [s for s, _ in best if s != s.upper() and s != s.lower()]
        out[up] = mixed[0] if mixed else best[0][0]
    return out


def restore_case(text: str, cmap: dict[str, str]) -> str:
    def sub(m: re.Match) -> str:
        w = m.group(0)
        # Only identifiers that look like ours (PLY_...): mnemonics and
        # registers stay as Disark wrote them.
        if w.upper().startswith("PLY_"):
            return cmap.get(w.upper(), w)
        return w
    return IDENT.sub(sub, text)


def rename_if_reserved(name: str) -> str:
    if name.lower() in RESERVED or name.lower() in MNEMONICS:
        return name + "_"
    return name


def convert(lines: list[str], cmap: dict[str, str], drop_labels: set[str],
            drop_org: bool = True) -> str:
    out: list[str] = []
    renames: dict[str, str] = {}
    # First pass: find labels needing renames so references follow.
    for raw in lines:
        if raw[:1].isspace() or not raw.strip():
            continue
        m = LABEL_LINE.match(raw.rstrip())
        if m and rename_if_reserved(m.group(1)) != m.group(1):
            renames[m.group(1)] = rename_if_reserved(m.group(1))
    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue
        if drop_org and re.match(r"^\s+org\b", line, re.I):
            continue
        if line[0].isspace():
            out.append("    " + line.strip())
            continue
        m = LABEL_LINE.match(line)
        if not m:
            raise ValueError(f"cannot parse line: {raw!r}")
        label, rest = m.group(1), m.group(2)
        if label.upper() in {d.upper() for d in drop_labels}:
            if rest:
                out.append("    " + rest.strip())
            continue
        if rest and re.match(r"equ\b", rest, re.I):
            # `label equ $+n` (a label inside an instruction): zxbasm
            # takes EQU only without the colon.
            out.append(f"{renames.get(label, label)} {rest.strip()}")
            continue
        out.append(f"{renames.get(label, label)}:")
        if rest:
            out.append("    " + rest.strip())
    text = "\n".join(out) + "\n"
    for old, new in renames.items():
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    return restore_case_all(text, cmap)


def restore_case_all(text: str, cmap: dict[str, str]) -> str:
    return "\n".join(restore_case(l, cmap) for l in text.split("\n"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--case-from", action="append", default=[],
                    help="source file whose identifier spelling is restored")
    ap.add_argument("--drop-label", action="append", default=[],
                    help="label to remove (wrapper labels)")
    ap.add_argument("--header", help="text file prepended to the output")
    a = ap.parse_args(argv)
    with open(a.input, encoding="utf-8") as f:
        lines = f.read().split("\n")
    res = convert(lines, case_map(a.case_from), set(a.drop_label))
    with open(a.output, "w", encoding="utf-8") as f:
        if a.header:
            with open(a.header, encoding="utf-8") as h:
                f.write(h.read())
        f.write(res)
    return 0


if __name__ == "__main__":
    sys.exit(main())
