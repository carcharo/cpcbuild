; -----------------------------------------------------------------------
; cpcbuild library -- DoTile16: one 16x16 tile (four 8x8 tiles)
;
; Written from scratch for this project (MIT); see core.asm.
;
; A tile is 8x8 pixels: 1 byte x 8 lines in mode 2, 2 x 8 in mode 1,
; 4 x 8 in mode 0 (width in bytes W = 1 << GFX_XSHIFT, colour.asm). Tile
; data: per tile its 8 rows top first, each row's bytes left to right,
; so a tile is 8 * W bytes. Tile n is at CB_TILESET + n * 8 * W.
; Tile cell (cx, cy) is byte column cx * W, pixel line cy * 8, so a tile
; starts on pixel line 0 of a character row: its 8 lines are in the 8
; successive 2 KB blocks, i.e. the next line is H + 8, with no
; character-row crossing. With a hardware-scroll offset a tile's row can
; still cross the end of its block (core.asm): that is checked once per
; tile and a per-byte path (__CB_INC_X) is used then.
;
; None of these routines calls the firmware, and none uses IX, IY or the
; shadow registers. Cells off the screen draw nothing.
;
; This file: __CB_TILE16, which draws through __CB_TILE_AT (tile8.asm).
#include once <cpcbuild/tile8.asm>

    push namespace core

; __CB_TILE16 -- C = x, B = y, A = tile: a 16x16 tile at 16x16 cell
; (x, y), drawn as the 8x8 tiles 4*tile .. 4*tile+3 (top-left,
; top-right, bottom-left, bottom-right) at 8x8 cells (2x, 2y) ...
; (2x+1, 2y+1); the parts off the screen are skipped.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_TILE16:
    ld   l, a
    ld   h, 0
    add  hl, hl
    add  hl, hl             ; first 8x8 tile number
    ld   a, c
    cp   128
    ret  nc                 ; off the screen anyway (and 2x would overflow)
    ld   a, b
    cp   128
    ret  nc
    sla  c
    sla  b
    push bc
    push hl
    call __CB_TILE_AT       ; top-left
    pop  hl
    pop  bc
    inc  hl
    inc  c
    push bc
    push hl
    call __CB_TILE_AT       ; top-right
    pop  hl
    pop  bc
    inc  hl
    dec  c
    inc  b
    push bc
    push hl
    call __CB_TILE_AT       ; bottom-left
    pop  hl
    pop  bc
    inc  hl
    inc  c
    jp   __CB_TILE_AT       ; bottom-right

    pop namespace
