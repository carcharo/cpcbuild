; -----------------------------------------------------------------------
; cpcbuild library -- 8x8 tile drawers (the core of DoTile8, DoTile16, TileMap)
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
; This file: the unrolled drawers per mode and __CB_TILE_DRAW. The cell
; address and placement are in tile8.asm, the maps in tilemap.asm.
#include once <cpcbuild/core.asm>

    push namespace core

; Unrolled tile drawers, one per width W (4, 2, 1 bytes). The tile's 8 rows
; are copied with LDI chains; the screen address is stepped to the next
; row (+2 KB) between rows through HL (ADD HL,BC), so no page-crossing
; care is needed. The caller guarantees no row wraps in its 2 KB block.
; __CTD_Gn: HL = the tile's data, DE = its screen address (on pixel line 0
; of a character row). On return DE = screen address + 7 * 2 KB + W (so
; the tile's address plus W is D - $38) and HL = the data after the tile.
; __CTD_Un: HL = screen address, DE = data (swaps, then as Gn).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CTD_U4:
    ex   de, hl
__CTD_G4:
    ldi
    ldi
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 4
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 4
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 4
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 4
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 4
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 4
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 4
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ldi
    ldi
    ret
__CTD_U2:
    ex   de, hl
__CTD_G2:
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 2
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 2
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 2
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 2
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 2
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 2
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ex   de, hl
    ld   bc, $800 - 2
    add  hl, bc
    ex   de, hl
    ldi
    ldi
    ret
__CTD_U1:
    ex   de, hl
__CTD_G1:
    ldi
    ex   de, hl
    ld   bc, $800 - 1
    add  hl, bc
    ex   de, hl
    ldi
    ex   de, hl
    ld   bc, $800 - 1
    add  hl, bc
    ex   de, hl
    ldi
    ex   de, hl
    ld   bc, $800 - 1
    add  hl, bc
    ex   de, hl
    ldi
    ex   de, hl
    ld   bc, $800 - 1
    add  hl, bc
    ex   de, hl
    ldi
    ex   de, hl
    ld   bc, $800 - 1
    add  hl, bc
    ex   de, hl
    ldi
    ex   de, hl
    ld   bc, $800 - 1
    add  hl, bc
    ex   de, hl
    ldi
    ex   de, hl
    ld   bc, $800 - 1
    add  hl, bc
    ex   de, hl
    ldi
    ret

; __CB_TILE_DRAW -- HL = screen address of the tile's first byte (on
; pixel line 0 of a character row), DE = its data -> draws the tile.
; The row-wrap test is only needed in the last 256 bytes of a block; a
; tile that can't wrap goes to the unrolled drawer for the mode.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_TILE_DRAW:
    PROC
    LOCAL __CTD_FAST, __CTD_F1, __CTD_F2
    LOCAL __CTD_L4, __CTD_SLOW, __CTD_SL, __CTD_SI, __CTD_W

    ld   a, h
    and  $07
    cp   $07
    jr   nz, __CTD_FAST     ; only the block's last 256 bytes can wrap
    ld   a, (GFX_XSHIFT)
    ld   c, 1
    or   a
    jr   z, __CTD_W
__CTD_SL:
    sla  c
    dec  a
    jr   nz, __CTD_SL
__CTD_W:                    ; C = width in bytes
    push de
    call __CB_ROW_WRAPS
    pop  de
    jr   c, __CTD_SLOW
__CTD_FAST:
    ld   a, (GFX_XSHIFT)
    or   a
    jr   z, __CTD_F1
    dec  a
    jr   z, __CTD_F2
    jp   __CTD_U4
__CTD_F2:
    jp   __CTD_U2
__CTD_F1:
    jp   __CTD_U1
__CTD_SLOW:                 ; C = width; per-byte, wrapping in the block
    ld   b, 8
__CTD_SI:
    push hl
    push bc
__CTD_L4:
    ld   a, (de)
    ld   (hl), a
    inc  de
    call __CB_INC_X
    dec  c
    jr   nz, __CTD_L4
    pop  bc
    pop  hl
    ld   a, h
    add  a, 8
    ld   h, a
    djnz __CTD_SI
    ret
    ENDP

    pop namespace
