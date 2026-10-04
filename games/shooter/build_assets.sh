#!/bin/sh
# build_assets.sh -- regenerates Starfall's art and music includes.
# Run from anywhere. make_art.py and make_music.py write the sources (PNG,
# .vt2); img2cpc.py and aks2bas.py (Arkos tools: tools/arkos/fetch.sh)
# convert them. The outputs are committed. --draw redraws the sources.
set -e
cd "$(dirname "$0")/../.."
A=games/shooter/assets
Z=$A/zx
I="python3 tools/img2cpc.py"

python3 $A/make_art.py
python3 $A/make_music.py

# CPC: mode 0, the 16 fixed pens of starfall.pal shared by all
$I --mode 0 --name sprites --sprite --frame 8x8 --palette-file $A/starfall.pal $A/sprites.png -o $A/sprites.bas
$I --mode 0 --name shots --sprite --frame 2x4 --palette-file $A/starfall.pal --no-palette $A/shots.png -o $A/shots.bas
$I --mode 0 --name tiles --tiles --palette-file $A/starfall.pal $A/tiles.png -o $A/tiles.bas

# CPC Plus: hardware sprites (12-bit colours, 16x16, packed) and the playfield's
# 12-bit pens; make_plus_art.py draws plus_sprites.png from the same pictures
python3 $A/make_plus_art.py
$I --plus-sprite --packed --name plsprites $A/plus_sprites.png -o $A/plsprites.bas

# Spectrum: 1-bit sprite art (see make_art.py for the layout); --zx-sprite
# keeps every sprite pixel as ink (the picture rule would invert dense cells)
$I --spectrum --zx-sprite --name zx_sprites $Z/zx_sprites.png -o $Z/zx_sprites.bas
$I --spectrum --zx-sprite --name zx_shots $Z/zx_shots.png -o $Z/zx_shots.bas
$I --spectrum --zx-sprite --name zx_icon $Z/zx_icon.png -o $Z/zx_icon.bas

# Music and effects (skipped, keeping the committed ones, without the Arkos tools)
T="${AT3_TOOLS:-tools/arkos/work/bin}"
if [ -x "$T/SongToAkg" ] && [ -x "$T/SongToSoundEffects" ]; then
  python3 tools/aks2bas.py $A/title.vt2 $A/title.bas --name sf_title
  python3 tools/aks2bas.py $A/game.vt2 $A/gamesong.bas --name sf_game
  # the 6128 build keeps the songs in extra RAM bank 0: title at &4000, game at
  # &4400, one disc file starfall.dat (the includes written here are not used)
  python3 tools/aks2bas.py $A/title.vt2 /dev/null --name sf_title --at 0x4000 --bin $A/title_bank.bin
  python3 tools/aks2bas.py $A/game.vt2 /dev/null --name sf_game --at 0x4400 --bin $A/game_bank.bin
  python3 - <<PY
t = open("$A/title_bank.bin", "rb").read()
g = open("$A/game_bank.bin", "rb").read()
assert len(t) <= 0x400
open("$A/starfall.dat", "wb").write(t + bytes(0x400 - len(t)) + g)
PY
  python3 tools/aks2bas.py --sfx $A/sfx.vt2 $A/sfx.bas --name sf_sfx
  python3 tools/aks2bas.py --sfx $Z/sfx_zx.vt2 $Z/sfx_zx.bas --name sf_sfx
else
  echo "build_assets: Arkos tools not found (run tools/arkos/fetch.sh); keeping the committed music .bas"
fi
