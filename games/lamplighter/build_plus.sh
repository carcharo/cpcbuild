#!/bin/sh
# build_plus.sh -- builds Lamplighter Plus for the CPC Plus / GX4000: the
# 6128 Plus disc (firmware mode) and the bare cartridge, both from the same
# source as every other Lamplighter build with -D PLUS.
#
#   games/lamplighter/build_plus.sh [OUTDIR] [-- extra zxbc arguments]
#
# OUTDIR defaults to games/lamplighter/build (git-ignored). Writes
#   lampplus.bin   firmware build (disc): -D PLUS
#   lamppluc.bin   cartridge: -D PLUS -D CPC_BAREMETAL -D CPC_OWNFONT, made
#                  into lampplus.cpr by tools/mkcpr.py (boot stub copies the
#                  program to RAM at &0040)
#   lampplus.dsk   disc: PLUS.BIN (the loader: RUN"PLUS) and LAMPPLUS.BIN
# and a .map for each. The loader is Starfall's RUN"PLUS loader with the
# program's name changed (games/shooter/loader.asm, -D PLUSLOAD).
# Needs the sprite manager and palette cycling (lib/cpcplus/sprman, palcycle),
# in this checkout's lib/; PLUSLIB adds a second include directory if wanted.
# Needs poetry (the compiler fork's environment) in the PATH.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ZX="${ZXBASIC:-$REPO/../zxbasic}"
COMMON="$(cd "$REPO" && cd "$(git rev-parse --git-common-dir)" && pwd)/.."
PLUSLIB="${PLUSLIB:-$REPO/lib}"
export PATH="$HOME/.local/bin:$PATH"
OUT="$HERE/build"
if [ $# -gt 0 ] && [ "$1" != "--" ]; then OUT="$1"; shift; fi
if [ "${1:-}" = "--" ]; then shift; fi
EXTRA="$*"
mkdir -p "$OUT"

build() {   # name, -D flags
  rm -f "$OUT/$1.bin"
  (cd "$ZX" && poetry run zxbc --arch cpc --org 0x40 -I "$REPO/lib" -I "$PLUSLIB" -D PLUS $2 $EXTRA \
      -M "$OUT/$1.map" -o "$OUT/$1.bin" "$HERE/main.bas") 2>&1 | grep -v "W150\|W170\|warning" || true
  [ -f "$OUT/$1.bin" ] || { echo "build_plus: $1 failed" >&2; exit 1; }
  size=$(wc -c < "$OUT/$1.bin")
  printf "%-10s %6d bytes, &0040-&%04X\n" "$1" "$size" $((0x40 + size))
}

build lampplus ""
build lamppluc "-D CPC_BAREMETAL -D CPC_OWNFONT"
python3 "$REPO/tools/mkcpr.py" "$OUT/lamppluc.bin" --load 0x40 -o "$OUT/lampplus.cpr"
# the RUN"PLUS loader: Starfall's, for LAMPPLUS.BIN
{ echo "#define PLUSLOAD"; sed 's/STARPLUS\.BIN/LAMPPLUS.BIN/' "$REPO/games/shooter/loader.asm"; } > "$OUT/loader_plus.asm"
(cd "$ZX" && poetry run zxbasm -o "$OUT/loader_plus.bin" "$OUT/loader_plus.asm")
ZXBASIC="$ZX" python3 "$REPO/games/shooter/pack_dsk.py" "$OUT/lampplus.dsk" \
    PLUS.BIN="$OUT/loader_plus.bin"@0x8000 \
    LAMPPLUS.BIN="$OUT/lampplus.bin"@0x40
# the disc build is loaded by PLUS.BIN, which sits at &8000 (AMSDOS buffer at
# &8800): the program must end below it
end=$((0x40 + $(wc -c < "$OUT/lampplus.bin")))
[ "$end" -le $((0x8000)) ] || { echo "build_plus: lampplus overlaps the loader at &8000" >&2; exit 1; }
printf "headroom below &8000 in lampplus: %d bytes\n" $((0x8000 - end))
