#!/bin/sh
# build_assets.sh -- regenerates Lamplighter's art and map includes.
# Run from anywhere. make_art.py writes the sources (PNG, palette, tower.tmx),
# img2cpc.py and split_rooms.py (over tools/tmx2bas.py) convert them.
# The outputs are committed.
set -e
cd "$(dirname "$0")/../.."
A=games/lamplighter/assets
I="python3 tools/img2cpc.py"

python3 $A/make_art.py

# mode 0, the 16 fixed pens of lamp.pal shared by all
$I --mode 0 --name tiles --tiles --palette-file $A/lamp.pal $A/tiles.png -o $A/tiles.bas
$I --mode 0 --name sprites --sprite --masked --frame 8x16 --palette-file $A/lamp.pal --no-palette $A/sprites.png -o $A/sprites.bas
python3 $A/split_rooms.py $A/tower.tmx -o $A/rooms.bas
