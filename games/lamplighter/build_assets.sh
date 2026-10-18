#!/bin/sh
# build_assets.sh -- regenerates Lamplighter's art and map includes.
# Run from anywhere. make_art.py writes the sources (PNG, palette, tower.tmx),
# img2cpc.py and split_rooms.py (over tools/tmx2bas.py) convert them.
# The outputs are committed.
#
# This is a CPCBuild Studio project (cpcbuild.json), and every img2cpc line
# below is also an assets/*.cpcimp recipe (Studio's "Regenerate Assets").
# Studio runs img2cpc.py from the project root, so this script does too: the
# generated headers then name the same project-relative paths either way
# (no repo path in them), and Studio writes the same bytes.
set -e
cd "$(dirname "$0")"
A=assets
I="python3 ../../tools/img2cpc.py"

python3 $A/make_art.py

# mode 0, the 16 fixed pens of lamp.cpcpal shared by all
$I --mode 0 --name tiles --tiles --palette-file $A/lamp.cpcpal $A/tiles.png -o $A/tiles.bas
$I --mode 0 --name sprites --sprite --frame 8x16 --masked --palette-file $A/lamp.cpcpal --no-palette $A/sprites.png -o $A/sprites.bas
python3 $A/split_rooms.py $A/tower.tmx -o $A/rooms.bas

# Spectrum: tiles as 1 bit + an attribute per cell (img2cpc picks ink and
# paper per cell), sprites as ink-only silhouettes (colour comes from the
# program: the player and the ghosts have an attribute each)
mkdir -p $A/zx
$I --spectrum --name zx_tiles $A/zx/zx_tiles.png -o $A/zx/zx_tiles.bas
$I --spectrum --zx-sprite --name zx_sprites $A/zx/zx_sprites.png -o $A/zx/zx_sprites.bas

# CPC Plus: the lit lamp's flame in pens 11-14 (cycled), hardware sprites
# (16 x 16, every art pixel 2 wide) and the 12-bit pens
mkdir -p $A/plus
python3 $A/make_plus_art.py
$I --mode 0 --name tiles --tiles --palette-file $A/lamp.cpcpal $A/plus/plus_tiles.png -o $A/plus/tiles.bas
$I --plus-sprite --name lpsprites $A/plus/plus_sprites.png -o $A/plus/lpsprites.bas
