#!/bin/sh
# build_cpc.sh -- builds Starfall for the Amstrad CPC: the 6128 build
# (double-buffered), the 464 build (single-buffered), their bare-metal
# twins (-D CPC_BAREMETAL: no firmware), the two disc loaders and one disc
# image with all of it.
#
#   games/shooter/build_cpc.sh [OUTDIR] [-- extra zxbc arguments]
#
# OUTDIR defaults to games/shooter/build (git-ignored). Writes starfall.bin
# (6128), starfa64.bin (464), loader.bin, starfall.dsk (DISC.BIN = the
# loader, STARFALL.BIN, STARFA64.BIN, STARFALL.DAT = the 6128's songs for
# extra RAM bank 0: RUN"DISC"; BARE.BIN = the bare loader, STARBARE.BIN,
# STARBA64.BIN: RUN"BARE") and a .map for each build, and prints where each
# build ends (the 6128 ones must stay below &4000, the back screen).
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

# Where a build's low segment ends: the compiler writes a .map label
# __HIDATA_BACK_0 at the end of the program proper when #pragma hidata puts
# arrays above it (the .bin is then padded out to the end of that high data);
# without high data the file size gives the end.
lowend() {   # name, file end
  v=$(awk '$2 == ".__HIDATA_BACK_0" { sub(":", "", $1); print $1; exit }' "$OUT/$1.map")
  if [ -n "$v" ]; then echo $((0x$v)); else echo "$2"; fi
}

build() {   # name, -D flag
  (cd "$ZX" && poetry run zxbc --arch cpc --org 0x40 -I "$REPO/lib" -D $2 $EXTRA \
      -M "$OUT/$1.map" -o "$OUT/$1.bin" "$HERE/main.bas") 2>&1 | grep -v "W150\|W170\|warning" || true
  [ -f "$OUT/$1.bin" ] || { echo "build_cpc: $1 failed" >&2; exit 1; }
  size=$(wc -c < "$OUT/$1.bin")
  fend=$((0x40 + size))
  low=$(lowend $1 $fend)
  if [ "$low" -lt "$fend" ]; then
    printf "%-10s %6d bytes, low segment &0040-&%04X, high data &8000-&%04X\n" "$1" "$size" $low $fend
  else
    printf "%-10s %6d bytes, &0040-&%04X\n" "$1" "$size" $fend
  fi
}

rm -f "$OUT/starfall.bin" "$OUT/starfa64.bin" "$OUT/starbare.bin" "$OUT/starba64.bin"
build starfall CPC6128
build starfa64 CPC464
build starbare "CPC6128 -D CPC_BAREMETAL"
build starba64 "CPC464 -D CPC_BAREMETAL"
(cd "$ZX" && poetry run zxbasm -o "$OUT/loader.bin" "$HERE/loader.asm")
(cd "$ZX" && poetry run zxbasm -o "$OUT/bare.bin" "$HERE/loader_bare.asm")
python3 "$HERE/pack_dsk.py" "$OUT/starfall.dsk" \
    DISC.BIN="$OUT/loader.bin"@0x9E00 \
    STARFALL.BIN="$OUT/starfall.bin"@0x40 \
    STARFA64.BIN="$OUT/starfa64.bin"@0x40 \
    BARE.BIN="$OUT/bare.bin"@0x9E00 \
    STARBARE.BIN="$OUT/starbare.bin"@0x40 \
    STARBA64.BIN="$OUT/starba64.bin"@0x40 \
    STARFALL.DAT="$HERE/assets/starfall.dat"@0x4000
# the double-buffered builds: the low segment must stay below &4000 (the back
# screen); their high data must end below &9600, where the loaders' AMSDOS
# buffer (&9600-&9DFF) and the loaders (&9E00) are, and below the heap (&8B60
# in a firmware build, &A560 in a bare one: zxbc checks that too, this prints
# the room left)
for b in starfall starbare; do
  fend=$((0x40 + $(wc -c < "$OUT/$b.bin")))
  end=$(lowend $b $fend)
  [ "$end" -le $((0x4000)) ] || { echo "build_cpc: the $b build ends above &4000" >&2; exit 1; }
  printf "headroom below &4000 in %s: %d bytes\n" $b $((0x4000 - end))
  if [ "$fend" -gt "$end" ]; then
    [ "$fend" -le $((0x9600)) ] || { echo "build_cpc: the high data of $b ends above &9600 (loaders' buffer)" >&2; exit 1; }
    case $b in starfall) heap=$((0x8B60));; *) heap=$((0xA560));; esac
    printf "high data of %s: &8000-&%04X, %d bytes below the heap at &%04X\n" $b $fend $((heap - fend)) $heap
  fi
done
# BARE.BIN stages STARFALL.DAT at &8000 (1.2 KB) before it loads the game
# over it; the AMSDOS buffer is at &9600: the songs must end below it
dat=$(wc -c < "$HERE/assets/starfall.dat")
[ $((0x8000 + dat)) -le $((0x9600)) ] || { echo "build_cpc: starfall.dat ($dat bytes) is too big for BARE.BIN's staging area &8000-&95FF" >&2; exit 1; }
# the 464 builds have no high data: they are loaded over &0040 upwards, below the loaders
for b in starfa64 starba64; do
  end=$((0x40 + $(wc -c < "$OUT/$b.bin")))
  [ "$end" -le $((0x9600)) ] || { echo "build_cpc: $b overlaps the loader's buffer at &9600" >&2; exit 1; }
done
