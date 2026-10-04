#!/usr/bin/env python3
"""run.py -- smoke tests for the Plus harness (tools/cpcrun.py --model plus,
--cpr) on Caprice32. Each case runs cpcrun.py and checks its exit status and
printer transcript. Usage: run.py [-k PATTERN]

Cases: firmware and bare hello (F1 menu, run", printer capture, END), the
Plus identity check (plusdetect.bas), .cpr runs (a handmade cartridge made
here: a RIFF "AMS!" file with one 16 KB "cb00" chunk whose Z80 code writes
text to the printer port &EFxx like runtime/bareboot.asm's __CPC_PRN_CHAR and
then `rst 0`), and the refusals (chips has no Plus).
"""
from __future__ import annotations

import argparse
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CPCRUN = HERE.parent.parent / "tools" / "cpcrun.py"


def make_cpr(text: bytes) -> bytes:
    """A minimal cartridge: page 0 holds code at &0000 that prints `text`
    (7-bit, NUL-terminated here) through the printer port and does `rst 0`.
    Layout: "RIFF", u32 length of the rest, "AMS!", then chunks "cbNN" (u32
    length, data), here one of 16384 bytes."""
    code = bytes([
        0xF3,                    # di
        0x21, 0x00, 0x00,        # ld hl, msg   (patched below)
        # loop:
        0x7E,                    # ld a,(hl)
        0xB7,                    # or a
        0x28, 0x11,              # jr z, done
        0x23,                    # inc hl
        0xE6, 0x7F,              # and $7F
        0x5F,                    # ld e,a
        0x01, 0x00, 0xEF,        # ld bc,$EF00
        0xED, 0x59,              # out (c),e       data, strobe inactive
        0xF6, 0x80,              # or $80
        0xED, 0x79,              # out (c),a       strobe
        0xED, 0x59,              # out (c),e       strobe released
        0x18, 0xEA,              # jr loop
        # done:
        0xC7,                    # rst 0
    ])
    msg_addr = len(code)
    code = code[:2] + struct.pack("<H", msg_addr) + code[4:]
    page = (code + text + b"\x00").ljust(16384, b"\x00")
    body = b"AMS!" + b"cb00" + struct.pack("<I", len(page)) + page
    return b"RIFF" + struct.pack("<I", len(body)) + body


def cpcrun(*args: str, timeout: float = 60):
    proc = subprocess.run([sys.executable, str(CPCRUN), *args], capture_output=True, text=True, timeout=timeout)
    return proc.returncode, proc.stdout, proc.stderr


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-k", dest="pattern", default=None)
    args = ap.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="plus-smoke-"))
    ok_cpr = tmp / "ok.cpr"
    ok_cpr.write_bytes(make_cpr(b"HI\n\x04END\n"))
    noend_cpr = tmp / "noend.cpr"
    noend_cpr.write_bytes(make_cpr(b"HI\n"))

    cases = [
        # name, args, want exit, want stdout (None = don't care), want stderr substring
        ("hello_firmware", ["--model", "plus", str(HERE / "hello.bas")], 0, "HELLO PLUS\nDONE\n", ""),
        ("hello_bare", ["--model", "plus", "--bare", str(HERE / "hello.bas")], 0, "HELLO PLUS\nDONE\n", ""),
        ("plusdetect_firmware", ["--model", "plus", str(HERE / "plusdetect.bas")], 0,
         "PASS ram_poke\nPASS asic_paged_in\nDONE\n", ""),
        ("plusdetect_bare", ["--model", "plus", "--bare", str(HERE / "plusdetect.bas")], 0, None, ""),
        ("cpr_hello", ["--cpr", str(ok_cpr)], 0, "HI\n", ""),
        ("cpr_explicit_model", ["--cpr", str(ok_cpr), "--model", "plus"], 0, "HI\n", ""),
        ("cpr_no_end_marker", ["--cpr", str(noend_cpr)], 4, None, "without the END marker"),
        ("chips_has_no_plus", ["--emu", "chips", "--model", "plus", str(HERE / "hello.bas")], 2, None, "no Plus"),
        ("cpr_needs_plus", ["--cpr", str(ok_cpr), "--model", "6128"], 2, None, "--model plus"),
    ]
    failed = 0
    for name, cargs, want_code, want_out, want_err in cases:
        if args.pattern and args.pattern not in name:
            continue
        code, out, err = cpcrun(*cargs)
        problems = []
        if code != want_code:
            problems.append(f"exit {code}, want {want_code}")
        if want_out is not None and out != want_out:
            problems.append(f"stdout {out!r}, want {want_out!r}")
        if want_err and want_err not in err:
            problems.append(f"stderr lacks {want_err!r}")
        if name == "plusdetect_bare" and "FAIL" in out:
            problems.append("FAIL line in output")
        if problems:
            failed += 1
            print(f"FAIL     {name}: " + "; ".join(problems))
            print("         stderr tail:", err.strip().splitlines()[-1:] if err.strip() else "")
        else:
            print(f"PASS     {name}")
    print(f"\n{'all passed' if not failed else f'{failed} failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
