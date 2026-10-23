; -----------------------------------------------------------------------
; cpcbuild library -- DoTile8: one 8x8 tile at a cell
;
; Written from scratch for this project (MIT); see core.asm.
;
; A tile is W bytes x 8 lines, W = 1 << s with s from __CB_TXS
; (tiledraw.asm): the mode's GFX_XSHIFT (colour.asm) unless SetTileWidth
; fixed it, so by default 8x8 pixels: 1 byte in mode 2, 2 in mode 1, 4 in
; mode 0. Tile data: per tile its 8 rows top first, each row's bytes left to right,
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
; This file: __CB_TILE_AT (place one tile) and __CB_CELL_ADDR; the
; drawers are in tiledraw.asm.
#include once <cpcbuild/core.asm>
#include once <cpcbuild/tiledraw.asm>

    push namespace core

; __CB_TILE_AT -- C = cell x, B = cell y, HL = tile number (0-1023):
; draws it, or nothing if the cell is off the screen (x * W >= 80 or
; y >= 25). One branch per width, each with its own shifts (data address =
; TILESET + n * 8 W, byte column = W x) and straight to its unrolled
; drawer unless the tile is in the last 256 bytes of the block (where it
; could wrap: __CB_TILE_DRAW does the checking).
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_TILE_AT:
    PROC
    LOCAL __CTA_M1, __CTA_M2, __CTA_W, __CTA_FIX

    ld   a, b
    cp   25
    ret  nc                 ; below the screen
    ld   a, (CB_TILEW)      ; __CB_TXS inline (this path is the hot one)
    or   a
    jr   nz, __CTA_FIX
    ld   a, (GFX_XSHIFT)
    or   a
__CTA_W:
    jr   z, __CTA_M2
    dec  a
    jr   z, __CTA_M1
    ld   a, c               ; W = 4: 20 cells
    cp   20
    ret  nc
    add  a, a
    add  a, a
    ld   c, a               ; C = byte column
    add  hl, hl
    add  hl, hl
    add  hl, hl
    add  hl, hl
    add  hl, hl             ; * 32
    ld   de, (CB_TILESET)
    add  hl, de
    ex   de, hl             ; DE = the tile's data
    call __CB_CELL_ADDR     ; HL = its screen address
    ld   a, h
    and  $07
    cp   $07
    jp   nz, __CTD_U4
    jp   __CB_TILE_DRAW
__CTA_M1:
    ld   a, c               ; W = 2: 40 cells
    cp   40
    ret  nc
    add  a, a
    ld   c, a
    add  hl, hl
    add  hl, hl
    add  hl, hl
    add  hl, hl             ; * 16
    ld   de, (CB_TILESET)
    add  hl, de
    ex   de, hl
    call __CB_CELL_ADDR
    ld   a, h
    and  $07
    cp   $07
    jp   nz, __CTD_U2
    jp   __CB_TILE_DRAW
__CTA_M2:
    ld   a, c               ; W = 1: 80 cells
    cp   80
    ret  nc
    add  hl, hl
    add  hl, hl
    add  hl, hl             ; * 8
    ld   de, (CB_TILESET)
    add  hl, de
    ex   de, hl
    call __CB_CELL_ADDR
    ld   a, h
    and  $07
    cp   $07
    jp   nz, __CTD_U1
    jp   __CB_TILE_DRAW
__CTA_FIX:                  ; SetTileWidth's: s + 1 -> s, Z if 0
    dec  a
    jr   __CTA_W
    ENDP

; __CB_CELL_ADDR -- B = cell y (0-24), C = byte column (0-79) -> HL = the
; address of that byte on pixel line 0 of the character row, i.e. in
; block 0: BASE | ((OFFSET + 80 y + x) AND &7FF), with 5 y as a byte and
; 80 y as 16 times that. DE is preserved.
; Firmware entry called: none. Registers clobbered: AF, BC, HL.
__CB_CELL_ADDR:
    ld   a, b
    add  a, a
    add  a, a
    add  a, b               ; 5 y (at most 120)
    ld   l, a
    ld   h, 0
    add  hl, hl
    add  hl, hl
    add  hl, hl
    add  hl, hl             ; 80 y
    ld   b, 0
    add  hl, bc             ; + byte column
    ld   bc, (CB_OFFSET)
    add  hl, bc             ; + scroll offset
    ld   a, h
    and  $07                ; wrap within the 2 KB block
    ld   h, a
    ld   a, (CB_BASE)
    or   h
    ld   h, a
    ret

    pop namespace
