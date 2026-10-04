#!/bin/sh
# build_plus.sh -- builds Starfall Plus for the CPC Plus / GX4000: the
# cartridge (bare metal) and the 6128 Plus disc (firmware mode), both from
# the same source as every other Starfall build with -D PLUS.
#
#   games/shooter/build_plus.sh [OUTDIR] [-- extra zxbc arguments]
#
# OUTDIR defaults to games/shooter/build (git-ignored). Writes
#   starplus.bin   firmware build (disc): -D PLUS
#   starplus.cpr   cartridge: -D PLUS -D CPC_BAREMETAL -D CPC_OWNFONT, made
#                  into a .cpr by tools/mkcpr.py (boot stub copies the
#                  program to RAM at &0040)
#   starplus.dsk   disc: PLUS.BIN (the loader: RUN"PLUS) and STARPLUS.BIN
# and a .map for each. Both builds keep the songs inside the program (the
# 464 build's way): a cartridge has no disc, a GX4000 has no extra RAM bank.
# Needs poetry (the compiler fork's environment) in the PATH.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ZX="${ZXBASIC:-$REPO/../zxbasic}"
export PATH="$HOME/.local/bin:$PATH"
OUT="$HERE/build"
if [ $# -gt 0 ] && [ "$1" != "--" ]; then OUT="$1"; shift; fi
if [ "${1:-}" = "--" ]; then shift; fi
EXTRA="$*"
mkdir -p "$OUT"

build() {   # name, -D flags
  (cd "$ZX" && poetry run zxbc --arch cpc --org 0x40 -I "$REPO/lib" -D PLUS $2 $EXTRA \
      -M "$OUT/$1.map" -o "$OUT/$1.bin" "$HERE/main.bas") 2>&1 | grep -v "W150\|W170\|warning" || true
  [ -f "$OUT/$1.bin" ] || { echo "build_plus: $1 failed" >&2; exit 1; }
  size=$(wc -c < "$OUT/$1.bin")
  printf "%-10s %6d bytes, &0040-&%04X\n" "$1" "$size" $((0x40 + size))
}

rm -f "$OUT/starplus.bin" "$OUT/starpluc.bin"
build starplus ""
build starpluc "-D CPC_BAREMETAL -D CPC_OWNFONT"
python3 "$REPO/tools/mkcpr.py" "$OUT/starpluc.bin" --load 0x40 -o "$OUT/starplus.cpr"
(cd "$ZX" && poetry run zxbasm -o "$OUT/loader_plus.bin" "$HERE/loader_plus.asm")
python3 "$HERE/pack_dsk.py" "$OUT/starplus.dsk" \
    PLUS.BIN="$OUT/loader_plus.bin"@0x8000 \
    STARPLUS.BIN="$OUT/starplus.bin"@0x40
# the disc build is loaded by PLUS.BIN, which sits at &8000 (AMSDOS buffer at
# &8800), and a firmware program must stay below the firmware's own memory
# (HIMEM about &A67B for a RUN" program)
end=$((0x40 + $(wc -c < "$OUT/starplus.bin")))
[ "$end" -le $((0x8000)) ] || { echo "build_plus: starplus overlaps the loader at &8000" >&2; exit 1; }
printf "headroom below &8000 in starplus: %d bytes\n" $((0x8000 - end))
