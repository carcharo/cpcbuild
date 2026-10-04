#!/bin/sh
# build.sh -- builds the CPC Plus demo (examples/plusdemo.bas):
#   examples/plusdemo/build.sh           the assets (sprites.bas, landscape.bas from
#                                        the PNGs) and build/plusdemo.cpr, the cartridge
#   examples/plusdemo/build.sh --assets  only the assets (the .bas files are committed)
# The disc version needs no build step: tools/cpcrun.py examples/plusdemo.bas
# --model plus --bare (see the header of plusdemo.bas).
set -e
cd "$(dirname "$0")/../.."
D=examples/plusdemo
python3 $D/make_assets.py
python3 tools/img2cpc.py --plus-sprite --packed --name dsprite $D/sprites.png -o $D/sprites.bas
python3 tools/img2cpc.py --mode 1 --sprite --name landscape --palette 0,26,4,10 --no-palette \
  $D/landscape.png -o $D/landscape.bas
[ "$1" = "--assets" ] && exit 0

# The cartridge: a bare build with the program's own font (no firmware ROM in a
# cartridge-only machine), then the .cpr wrapper (boot stub that copies it to RAM).
# (extra arguments go to zxbc: -D DEMO_FRAMES=100 -D __CPC_PRINTER_ECHO__ makes a
# cartridge that ends by itself, as tests/plus does for cpcrun.py --cpr)
ROOT=$(pwd)
mkdir -p build
(cd ../zxbasic && poetry run zxbc --arch cpc -D CPC_BAREMETAL -D CPC_OWNFONT "$@" \
  -I "$ROOT/lib" -M "$ROOT/build/plusdemo.map" -o "$ROOT/build/plusdemo.bin" "$ROOT/examples/plusdemo.bas")
python3 tools/mkcpr.py build/plusdemo.bin -o build/plusdemo.cpr
ls -l build/plusdemo.bin build/plusdemo.cpr
