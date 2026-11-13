#!/bin/sh
# build_cpc.sh -- builds Lamplighter for the Amstrad CPC: the 464 build and
# the 6128 build (both firmware, single-buffered; the same code).
#
#   games/lamplighter/build_cpc.sh [OUTDIR] [-- extra cpcbas arguments]
#
# OUTDIR defaults to games/lamplighter/build (git-ignored). Writes lamp464.bin
# and lamp6128.bin (AMSDOS-headered, loaded at &0040: run with LOAD"..",&40 :
# CALL &40, or from the Studio) and a .map for each, and prints where each
# build ends against the 464 budget: the program must end below the heap at
# &8B60.
# Needs the cpcbas compiler, built: $CPCBAS (default: ../cpcbas next to the
# main working tree; see tests/env.sh).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/tests/env.sh"
CLI="$CPCBAS/packages/cpcbas/dist/bin/cpcbas.js"
[ -f "$CLI" ] || { echo "build_cpc: cpcbas not built at $CLI (set CPCBAS)" >&2; exit 1; }
OUT="$HERE/build"
if [ $# -gt 0 ] && [ "$1" != "--" ]; then OUT="$1"; shift; fi
if [ "${1:-}" = "--" ]; then shift; fi
mkdir -p "$OUT"

build() {   # name, -D flag, extra cpcbas arguments
  name=$1; flag=$2; shift 2
  rm -f "$OUT/$name.bin"
  node "$CLI" --org 0x40 -D "$flag" "$@" -M "$OUT/$name.map" -o "$OUT/$name.bin" "$HERE/main.bas" 2>&1 \
      | grep -v "warning\|hint:" || true
  [ -f "$OUT/$name.bin" ] || { echo "build_cpc: $name failed" >&2; exit 1; }
  size=$(($(wc -c < "$OUT/$name.bin") - 128))   # the AMSDOS header
  end=$((0x40 + size))
  [ "$end" -le $((0x8B60)) ] || { echo "build_cpc: $name ends at &$(printf %04X $end), above the heap at &8B60" >&2; exit 1; }
  printf "%-10s %6d bytes, &0040-&%04X, %5d bytes below the heap (&8B60)\n" "$name" "$size" "$end" $((0x8B60 - end))
}

build lamp464 CPC464 "$@"
build lamp6128 CPC6128 "$@"
