#!/bin/sh
# build_assets.sh -- regenerates every committed generated include (the
# .bas files next to their .png/.tmx sources) with img2cpc.py/tmx2bas.py.
# Run from anywhere; --draw also redraws the source art first.
set -e
cd "$(dirname "$0")/.."
I="python3 tools/img2cpc.py"
T="python3 tools/tmx2bas.py"

if [ "$1" = "--draw" ]; then
  python3 examples/assets/make_sources.py
  python3 examples/assets/make_bounce_aks.py
  python3 tests/conformance/assets/make_sources.py
fi

# examples/bounce.bas: mode 0, the 16 pens of bounce.pal shared by all
A=examples/assets
$I --mode 0 --name bgtiles --tiles --palette-file $A/bounce.pal $A/bgtiles.png -o $A/bgtiles.bas
$I --mode 0 --name balls --sprite --frame 8x16 --masked --palette-file $A/bounce.pal --no-palette $A/balls.png -o $A/balls.bas
$T --name level $A/level.tmx -o $A/level.bas

# bounce's music and effects: make_bounce_aks.py writes the .vt2 sources
# (always, it is plain Python); the Arkos command-line tools turn them into
# .bas includes (skipped, keeping the committed ones, if they aren't installed:
# tools/arkos/fetch.sh installs them).
python3 $A/make_bounce_aks.py
if [ -x "${AT3_TOOLS:-tools/arkos/work/bin}/SongToAkg" ] && [ -x "${AT3_TOOLS:-tools/arkos/work/bin}/SongToSoundEffects" ]; then
  python3 tools/aks2bas.py $A/bounce_music.vt2 $A/bounce_music.bas --name bounce_music
  python3 tools/aks2bas.py $A/bounce_quiet.vt2 $A/bounce_quiet.bas --name bounce_quiet
  python3 tools/aks2bas.py --sfx $A/bounce_sfx.vt2 $A/bounce_sfx.bas --name bounce_sfx
else
  echo "build_assets: Arkos tools not found (run tools/arkos/fetch.sh); keeping the committed bounce_*.bas"
fi

# tests/conformance/banks*.bas: bounce's tune twice -- for main RAM, and
# assembled for the bank window at &4000 (.bas image + raw .bin for BankLoad)
M=tests/conformance/assets/music
if [ -x "${AT3_TOOLS:-tools/arkos/work/bin}/SongToAkg" ]; then
  python3 tools/aks2bas.py $A/bounce_music.vt2 $M/bank_tune_main.bas --name bank_tune_main
  python3 tools/aks2bas.py $A/bounce_music.vt2 $M/bank_tune.bas --name bank_tune --at 0x4000 --bin $M/bank_tune.bin
fi
python3 -c "open('tests/conformance/assets/bankdat.bin','wb').write(bytes(((i*7+(i>>8))&255) for i in range(3000)))"

# tests/conformance/cb_assets.bas
C=tests/conformance/assets
$I --mode 1 --name a_spr1 --palette 0,26,6,18 $C/spr1.png -o $C/spr1.bas
$I --mode 1 --name a_msk1 --masked --palette 0,26,6,18 $C/msk1.png -o $C/msk1.bas
$I --mode 1 --name a_pic --tiles --dedupe $C/pic1.png -o $C/pic1.bas
$T --name a_map $C/level.tmx -o $C/level.bas
$I --mode 0 --name a_spr0 --write-palette $C/pens16.pal $C/spr0.png -o $C/spr0.bas
$I --mode 0 --name a_msk0 --masked --palette-file $C/pens16.pal $C/msk0.png -o $C/msk0.bas

# tests/conformance/plus_asset.bas, screens/plus_palette12.bas (Plus sprites/palette)
python3 $C/make_plus_sources.py
python3 tools/img2cpc.py --plus-sprite --name plusball $C/plus_ball.png -o $C/plus_ball.bas
python3 tools/img2cpc.py --plus-sprite --packed --name plusballpk $C/plus_ball.png -o $C/plus_ballpk.bas
python3 tools/img2cpc.py --plus-palette --name plusbars $C/plus_bars.png -o $C/plus_bars.bas
