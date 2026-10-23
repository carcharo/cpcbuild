#!/bin/sh
# build_cpc.sh -- builds Lamplighter for the Amstrad CPC: the 464 build and
# the 6128 build (both firmware, single-buffered; the same code).
#
#   games/lamplighter/build_cpc.sh [OUTDIR] [-- extra zxbc arguments]
#
# OUTDIR defaults to games/lamplighter/build (git-ignored). Writes lamp464.bin
# and lamp6128.bin (load at &0040: run with LOAD"..",&40 : CALL &40, or from
# the Studio) and a .map for each, and prints where each build ends against
# the 464 budget: the program must end below the heap at
# &8B60.
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

build() {   # name, -D flag
  rm -f "$OUT/$1.bin"
  (cd "$ZX" && poetry run zxbc --arch cpc --org 0x40 -I "$REPO/lib" -D $2 $EXTRA \
      -M "$OUT/$1.map" -o "$OUT/$1.bin" "$HERE/main.bas") 2>&1 | grep -v "W150\|W170\|warning" || true
  [ -f "$OUT/$1.bin" ] || { echo "build_cpc: $1 failed" >&2; exit 1; }
  size=$(wc -c < "$OUT/$1.bin")
  end=$((0x40 + size))
  [ "$end" -le $((0x8B60)) ] || { echo "build_cpc: $1 ends at &$(printf %04X $end), above the heap at &8B60" >&2; exit 1; }
  printf "%-10s %6d bytes, &0040-&%04X, %5d bytes below the heap (&8B60)\n" "$1" "$size" "$end" $((0x8B60 - end))
}

build lamp464 CPC464
build lamp6128 CPC6128
