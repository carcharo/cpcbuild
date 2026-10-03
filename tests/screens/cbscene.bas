REM Screen test: a fixed cpcbuild scene in mode 0 -- a tile map (the demo's
REM level), masked sprites (the demo's balls) at fixed places, a plain
REM sprite copied with GetBlock/PutSprite, and FillRect over the top.
#include <cpc.bas>
#include <cpcbuild.bas>
#include "../../examples/assets/bgtiles.bas"
#include "../../examples/assets/level.bas"
#include "../../examples/assets/balls.bas"
#include "lib/shot.bas"

DIM buf(63) AS UBYTE
Mode 0
SetPalette(@bgtiles_pal(0), bgtiles_PENS)
SetBorder 0
ScreenInit()
SetTileSet(@bgtiles(0))
TileMap(@level(0), 0, 0, level_W, level_H)
PutSpriteMasked(6, 12, balls_W, balls_H, @balls(0))
PutSpriteMasked(14, 40, balls_W, balls_H, @balls(balls_SIZE))
PutSpriteMasked(22, 80, balls_W, balls_H, @balls(CAST(UINTEGER, 2) * balls_SIZE))
PutSpriteMasked(30, 120, balls_W, balls_H, @balls(0))
REM overlapping pair, and one clipped off the right edge and one off the top
PutSpriteMasked(60, 100, balls_W, balls_H, @balls(balls_SIZE))
PutSpriteMasked(62, 106, balls_W, balls_H, @balls(0))
PutSpriteMasked(78, 150, balls_W, balls_H, @balls(0))
PutSpriteMasked(40, -8, balls_W, balls_H, @balls(balls_SIZE))
REM copy the tile area under a ball, draw it elsewhere (4x16 bytes max here)
GetBlock(60, 100, 4, 8, @buf(0))
PutSprite(50, 20, 4, 8, @buf(0))
FillRect(10, 170, 20, 6, 5)
FillRect(12, 172, 16, 2, 9)
Shot("cbscene")
