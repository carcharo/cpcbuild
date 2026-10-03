#!/bin/sh
# build_zx.sh -- builds Starfall for the ZX Spectrum:
#
#   build/starfall128.tap   Spectrum 128K (double-buffered, music)   -D ZX128
#   build/starfall48.tap    Spectrum 48K (single-buffered, silent)   -D ZX48
#
# Usage: build_zx.sh [48|128|all] [extra zxbc arguments, e.g. -D KEMPSTON]
# (extra arguments go to every build). Load either .tap with LOAD "" (a BASIC
# loader with CLEAR, then the code, autorun). Needs the zxbasic fork next to
# this repo (../zxbasic, or $ZXBASIC) with its `poetry run zxbc`.
#
# The program is compiled with the cpcbuild library path (-I lib: music/) and
# a small heap (256 bytes: the game doesn't build strings). ORG:
#   48K   32768 (the default); the image has to end below DB00, where the
#         sprite engine's tables start;
#   128K  31744 (7C00): the image has to end below C000, the window where
#         bank 7 (screen 7 and the same tables) is paged in for good. Only
#         the heap and the first 700 bytes of variables are below 8000
#         (contended RAM); all the code is above.
# The script checks the image against those limits (the 128K one is the
# tight one: see "Memory plan" in platform_zx.bas) and fails if it doesn't fit.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ZXBASIC="${ZXBASIC:-$REPO/../zxbasic}"
OUT="$REPO/build"
which="${1:-all}"
[ $# -gt 0 ] && shift
EXTRA="$*"      # extra zxbc arguments (simple words, no spaces inside)
mkdir -p "$OUT"

build() {   # model org limit
  m="$1"; org="$2"; limit="$3"
  bin="$OUT/starfall$m.bin"
  (cd "$ZXBASIC" && poetry run zxbc --arch zx48k -f bin -D ZX$m -H 256 -S "$org" \
      -I "$REPO/lib" -o "$bin" "$HERE/main.bas" $EXTRA) 2>&1 | grep -v "warning:" || true
  [ -f "$bin" ] || { echo "build_zx.sh: the $m build failed" >&2; exit 1; }
  end=$((org + $(wc -c < "$bin")))
  spare=$((limit - end))
  if [ "$spare" -lt 0 ]; then
    echo "build_zx.sh: the $m image ends at $end, $((-spare)) bytes above its limit ($limit)" >&2
    exit 1
  fi
  (cd "$ZXBASIC" && poetry run zxbc --arch zx48k -f tap -B -a -D ZX$m -H 256 -S "$org" \
      -I "$REPO/lib" -o "$OUT/starfall$m.tap" "$HERE/main.bas" $EXTRA) 2>&1 | grep -v "warning:" || true
  rm -f "$bin"
  echo "Spectrum $m: build/starfall$m.tap (image $org..$end, $spare bytes below its limit)"
}

case "$which" in
  48)  build 48 32768 56064 ;;
  128) build 128 31744 49152 ;;
  all) build 48 32768 56064; build 128 31744 49152 ;;
  *)   echo "usage: build_zx.sh [48|128|all] [zxbc arguments]" >&2; exit 2 ;;
esac
