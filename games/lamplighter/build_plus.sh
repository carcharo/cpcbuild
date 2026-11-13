#!/bin/sh
# build_plus.sh -- builds Lamplighter Plus for the CPC Plus / GX4000: the
# 6128 Plus disc (firmware mode) and the bare cartridge, both from the same
# source as every other Lamplighter build with -D PLUS.
#
#   games/lamplighter/build_plus.sh [OUTDIR] [-- extra cpcbas arguments]
#
# OUTDIR defaults to games/lamplighter/build (git-ignored). Writes
#   lampplus.bin   firmware build (disc): -D PLUS
#   lamppluc.bin   cartridge image: -D PLUS -D CPC_BAREMETAL -D CPC_OWNFONT
#   lampplus.cpr   the cartridge: the same build packed by cpcbas -f cpr (a
#                  boot stub copies the program to RAM at &0040)
#   lampplus.dsk   disc: PLUS.BIN (the loader, loader_plus.asm: RUN"PLUS)
#                  and LAMPPLUS.BIN
# and a .map for each. The loader sits at &9E00 with the 2 KB AMSDOS buffer
# below it (&9600-&9DFF): the program must end below &9600.
# Needs the cpcbas compiler, built: $CPCBAS (see tests/env.sh).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/tests/env.sh"
CLI="$CPCBAS/packages/cpcbas/dist/bin/cpcbas.js"
[ -f "$CLI" ] || { echo "build_plus: cpcbas not built at $CLI (set CPCBAS)" >&2; exit 1; }
OUT="$HERE/build"
if [ $# -gt 0 ] && [ "$1" != "--" ]; then OUT="$1"; shift; fi
if [ "${1:-}" = "--" ]; then shift; fi
mkdir -p "$OUT"

build() {   # name, -D flags (one string), extra cpcbas arguments
  name=$1; defs=$2; shift 2
  rm -f "$OUT/$name.bin"
  set --  "$@"
  for d in $defs; do set -- "$@" -D "$d"; done
  node "$CLI" --org 0x40 -D PLUS "$@" -M "$OUT/$name.map" -o "$OUT/$name.bin" "$HERE/main.bas" 2>&1 \
      | grep -v "warning\|hint:" || true
  [ -f "$OUT/$name.bin" ] || { echo "build_plus: $name failed" >&2; exit 1; }
  size=$(($(wc -c < "$OUT/$name.bin") - 128))   # the AMSDOS header
  printf "%-10s %6d bytes, &0040-&%04X\n" "$name" "$size" $((0x40 + size))
}

EXTRA="$*"
build lampplus "" $EXTRA
build lamppluc "CPC_BAREMETAL CPC_OWNFONT" $EXTRA
node "$CLI" --org 0x40 -D PLUS -D CPC_BAREMETAL -D CPC_OWNFONT $EXTRA -f cpr -o "$OUT/lampplus.cpr" "$HERE/main.bas" 2>&1 \
    | grep -v "warning\|hint:" || true
[ -f "$OUT/lampplus.cpr" ] || { echo "build_plus: lampplus.cpr failed" >&2; exit 1; }
# the RUN"PLUS loader and the disc (cpcbas dsk takes raw images and their load addresses)
node "$CLI" asm "$HERE/loader_plus.asm" -o "$OUT/loader_plus.bin"
tail -c +129 "$OUT/lampplus.bin" > "$OUT/lampplus.raw"
node "$CLI" dsk -o "$OUT/lampplus.dsk" "PLUS.BIN=$OUT/loader_plus.bin@0x9E00" "LAMPPLUS.BIN=$OUT/lampplus.raw@0x40"
rm -f "$OUT/lampplus.raw"
# the disc build is loaded by PLUS.BIN: it must end below the AMSDOS buffer at &9600
end=$((0x40 + $(wc -c < "$OUT/lampplus.bin") - 128))
[ "$end" -le $((0x9600)) ] || { echo "build_plus: lampplus ends at &$(printf %04X $end), above the AMSDOS buffer at &9600" >&2; exit 1; }
printf "headroom below the AMSDOS buffer (&9600) in lampplus: %d bytes\n" $((0x9600 - end))
