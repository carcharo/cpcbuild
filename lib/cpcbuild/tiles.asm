; -----------------------------------------------------------------------
; cpcbuild library -- all the tile routines (DoTile8, DoTile16, TileMap,
; TileMapPart, TileRestore)
;
; Written from scratch for this project (MIT); see core.asm.
;
; The routines live in tile8.asm, tile16.asm, tilemap.asm and
; tilerestore.asm (the drawers they share: tiledraw.asm). tiles.bas
; requires just the ones a program calls; this file pulls in all of them
; for anything that still requires "cpcbuild/tiles.asm" as a whole.

#include once <cpcbuild/tile16.asm>
#include once <cpcbuild/tilemap.asm>
#include once <cpcbuild/tilerestore.asm>
