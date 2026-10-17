#!/bin/sh
# build_zx.sh -- builds Lamplighter for the ZX Spectrum:
#
#   build/lamplighter48.tap    Spectrum 48K (beeper effects, no music)   -D ZX48
#   build/lamplighter128.tap   Spectrum 128K (AY music and effects)      -D ZX128
#
# Usage: build_zx.sh [48|128|all] [extra zxbc arguments, e.g. -D KEMPSTON]
# (extra arguments go to every build). Load either .tap with LOAD "" (a BASIC
# loader with CLEAR, then the code, autorun). Needs the zxbasic fork next to
# this repo (../zxbasic, or $ZXBASIC) with its `poetry run zxbc`.
#
# ORG 32768 on both; the image has to end below F000, where the sprite
# library's data starts (platform_zx.bas, "Memory"); the script checks. The
# heap is 512 bytes (the HUD makes small strings).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ZXBASIC="${ZXBASIC:-$REPO/../zxbasic}"
export PATH="$HOME/.local/bin:$PATH"
OUT="$HERE/build"
which="${1:-all}"
[ $# -gt 0 ] && shift
EXTRA="$*"      # extra zxbc arguments (simple words, no spaces inside)
mkdir -p "$OUT"

build() {   # model
  m="$1"; org=32768; limit=61440
  bin="$OUT/lamplighter$m.bin"
  rm -f "$bin"
  (cd "$ZXBASIC" && poetry run zxbc --arch zx48k -f bin -D ZX$m -H 512 -S "$org" \
      -I "$REPO/lib" -o "$bin" "$HERE/main.bas" $EXTRA) 2>&1 | grep -v "warning:" || true
  [ -f "$bin" ] || { echo "build_zx.sh: the $m build failed" >&2; exit 1; }
  end=$((org + $(wc -c < "$bin")))
  spare=$((limit - end))
  if [ "$spare" -lt 0 ]; then
    echo "build_zx.sh: the $m image ends at $end, $((-spare)) bytes above its limit ($limit)" >&2
    exit 1
  fi
  (cd "$ZXBASIC" && poetry run zxbc --arch zx48k -f tap -B -a -D ZX$m -H 512 -S "$org" \
      -I "$REPO/lib" -o "$OUT/lamplighter$m.tap" "$HERE/main.bas" $EXTRA) 2>&1 | grep -v "warning:" || true
  rm -f "$bin"
  echo "Spectrum $m: build/lamplighter$m.tap (image $org..$end, $spare bytes below its limit)"
}

case "$which" in
  48)  build 48 ;;
  128) build 128 ;;
  all) build 48; build 128 ;;
  *)   echo "usage: build_zx.sh [48|128|all] [zxbc arguments]" >&2; exit 2 ;;
esac
