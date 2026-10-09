; -----------------------------------------------------------------------
; cpcbuild library -- TileMap and TileMapPart: a map of tiles
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
; This file: __CB_TILEMAP / __CB_TILEMAP_S, __CB_TILE_PTR and the fast
; row loops. It draws through the drawers in tiledraw.asm; the single
; tile routine (tile8.asm) is not needed.
#include once <cpcbuild/core.asm>
#include once <cpcbuild/nowrap.asm>
#include once <cpcbuild/tiledraw.asm>

    push namespace core

; __CB_TILE_PTR -- HL = tile number (0-1023) -> DE = its data address.
; Firmware entry called: none.
; Registers clobbered: AF, DE, HL.
__CB_TILE_PTR:
    PROC
    LOCAL __CTP_DONE

    add  hl, hl
    add  hl, hl
    add  hl, hl             ; * 8
    ld   a, (GFX_XSHIFT)
    or   a
    jr   z, __CTP_DONE
    add  hl, hl             ; * 16 (mode 1)
    dec  a
    jr   z, __CTP_DONE
    add  hl, hl             ; * 32 (mode 0)
__CTP_DONE:
    ld   de, (CB_TILESET)
    add  hl, de
    ex   de, hl
    ret
    ENDP

; __CB_TILEMAP -- HL = map (row-major bytes), D = cell
; y, E = cell x, B = height, C = width (in tiles; the map is C bytes per
; row). __CB_TILEMAP_S: the same with A = the map's row length in bytes
; (>= C), for a block out of a wider map. Draws the block of 8x8 tiles with its top-left at cell (x, y),
; skipping cells off the screen. Per row the first address comes from
; __CB_ADDR, then each tile's is the previous plus W. Two row loops:
; when no row of the screen can wrap in its block (__CB_NOWRAP) the fast
; one (__CTM_F4/F2/F1, one per mode, see below) draws each tile with the
; unrolled drawer and no wrap handling; otherwise the general one wraps
; at the block end by clearing bit 3 of H (valid because a tile starts in
; block 0, so a carry out of the block is the only way that bit gets set)
; and draws through __CB_TILE_DRAW, which checks the tile for a wrap.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_TILEMAP:
    PROC
    LOCAL __CTM_LIM, __CTM_LIMD, __CTM_SH, __CTM_SHD, __CTM_ROW
    LOCAL __CTM_TILE, __CTM_V1, __CTM_R1, __CTM_FROW, __CTM_RS, __CTM_RD
    LOCAL __CTM_FM2, __CTM_FM1, __CTM_FNEXT, __CTM_TAIL

    ld   a, c               ; map rows are as long as the block
__CB_TILEMAP_S:             ; (entry with A = map row length)
    ld   (__CTM_ROWMAP), hl
    ld   (__CTM_W), a
    ld   a, d
    cp   25
    ret  nc
    ld   (__CTM_Y), a
    ld   a, 25
    sub  d                  ; rows left on the screen
    cp   b
    jr   nc, __CTM_R1
    ld   b, a
__CTM_R1:
    ld   a, b
    or   a
    ret  z
    ld   (__CTM_ROWS), a
    ld   a, (GFX_XSHIFT)
    ld   d, a
    ld   a, 80
__CTM_LIM:                  ; A = cells per screen row
    dec  d
    jp   m, __CTM_LIMD
    srl  a
    jr   __CTM_LIM
__CTM_LIMD:
    ld   d, a
    ld   a, e
    cp   d
    ret  nc                 ; x off the right edge
    ld   a, d
    sub  e                  ; cells left in the row
    cp   c
    jr   c, __CTM_V1
    ld   a, c
__CTM_V1:
    or   a
    ret  z                  ; width 0
    ld   (__CTM_VIS), a
    ld   a, (GFX_XSHIFT)
    ld   d, a
    ld   a, e               ; x * W: first byte column
    ld   e, 1               ; E = W
__CTM_SH:
    dec  d
    jp   m, __CTM_SHD
    add  a, a
    sla  e
    jr   __CTM_SH
__CTM_SHD:
    ld   (__CTM_XB), a
    ld   d, 0
    ld   (__CTM_WB), de
    ld   a, (GFX_XSHIFT)    ; run length in bytes = visible tiles * W
    ld   b, a
    ld   a, (__CTM_VIS)
    inc  b
__CTM_RS:
    dec  b
    jr   z, __CTM_RD
    add  a, a
    jr   __CTM_RS
__CTM_RD:
    ld   (__CTM_RUNB), a
    call __CB_NOWRAP        ; Carry set: no row can wrap
    ld   a, 0
    adc  a, 0
    ld   (__CTM_FAST), a
__CTM_ROW:
    ld   a, (__CTM_FAST)
    or   a
    jr   nz, __CTM_FROW
    ld   a, (__CTM_Y)
    add  a, a
    add  a, a
    add  a, a
    ld   b, a
    ld   a, (__CTM_XB)
    ld   c, a
    call __CB_ADDR
    ld   a, (__CTM_VIS)
    ld   (__CTM_CNT), a
    ld   de, (__CTM_ROWMAP)
    ld   (__CTM_MPTR), de
__CTM_TILE:
    push hl
    ld   hl, (__CTM_MPTR)
    ld   a, (hl)
    inc  hl
    ld   (__CTM_MPTR), hl
    ld   l, a
    ld   h, 0
    call __CB_TILE_PTR
    pop  hl
    push hl
    call __CB_TILE_DRAW
    pop  hl
    ld   de, (__CTM_WB)
    add  hl, de
    res  3, h               ; wrap at the block end
    ld   a, (__CTM_CNT)
    dec  a
    ld   (__CTM_CNT), a
    jr   nz, __CTM_TILE
__CTM_TAIL:
    ld   a, (__CTM_W)
    ld   e, a
    ld   d, 0
    ld   hl, (__CTM_ROWMAP)
    add  hl, de
    ld   (__CTM_ROWMAP), hl
    ld   a, (__CTM_Y)
    inc  a
    ld   (__CTM_Y), a
    ld   a, (__CTM_ROWS)
    dec  a
    ld   (__CTM_ROWS), a
    jr   nz, __CTM_ROW
    ret
__CTM_FROW:                 ; fast row: the whole run of tiles
    ld   a, (__CTM_Y)
    add  a, a
    add  a, a
    add  a, a
    ld   b, a
    ld   a, (__CTM_XB)
    ld   c, a
    call __CB_ADDR
    ex   de, hl             ; DE = address of the first tile
    ld   a, (__CTM_RUNB)
    add  a, e
    ld   (__CTM_END), a     ; the low byte the run ends at
    ld   hl, (__CTM_ROWMAP)
    ld   a, (GFX_XSHIFT)
    or   a
    jr   z, __CTM_FM1
    dec  a
    jr   z, __CTM_FM2
    call __CTM_F4
    jr   __CTM_FNEXT
__CTM_FM2:
    call __CTM_F2
    jr   __CTM_FNEXT
__CTM_FM1:
    call __CTM_F1
__CTM_FNEXT:
    jp   __CTM_TAIL
    ENDP

; The fast row loops, one per width W = 4, 2, 1 (modes 0, 1, 2): HL = the
; map row, DE = screen address of the first tile; draws tiles until the
; screen address' low byte reaches __CTM_END (the run is at most 80 bytes,
; so the low byte is unambiguous). Per tile: its data address is
; TILESET + n * 8 W (the shift by 3 + log2 W is done by rotating the
; byte, which is shorter than shifting a pair); the drawer leaves DE at
; the tile's address + 7 * 2 KB + W, so the next tile's address is DE - 7 * 2 KB.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CTM_F4:
    ld   a, (hl)
    inc  hl
    push hl
    rrca
    rrca
    rrca                    ; n * 32 as a pair: high = n >> 3, low = n << 5
    ld   l, a
    and  $1F
    ld   h, a
    ld   a, l
    and  $E0
    ld   l, a
    ld   bc, (CB_TILESET)
    add  hl, bc
    call __CTD_G4
    ld   a, d
    sub  $38
    ld   d, a
    pop  hl
    ld   a, (__CTM_END)
    cp   e
    jr   nz, __CTM_F4
    ret
__CTM_F2:
    ld   a, (hl)
    inc  hl
    push hl
    rrca
    rrca
    rrca
    rrca                    ; n * 16: high = n >> 4, low = n << 4
    ld   l, a
    and  $0F
    ld   h, a
    ld   a, l
    and  $F0
    ld   l, a
    ld   bc, (CB_TILESET)
    add  hl, bc
    call __CTD_G2
    ld   a, d
    sub  $38
    ld   d, a
    pop  hl
    ld   a, (__CTM_END)
    cp   e
    jr   nz, __CTM_F2
    ret
__CTM_F1:
    ld   a, (hl)
    inc  hl
    push hl
    rlca
    rlca
    rlca                    ; n * 8: high = n >> 5, low = n << 3
    ld   l, a
    and  $07
    ld   h, a
    ld   a, l
    and  $F8
    ld   l, a
    ld   bc, (CB_TILESET)
    add  hl, bc
    call __CTD_G1
    ld   a, d
    sub  $38
    ld   d, a
    pop  hl
    ld   a, (__CTM_END)
    cp   e
    jr   nz, __CTM_F1
    ret


; Working storage of __CB_TILEMAP (never executed; in the code stream).
__CTM_ROWMAP:  defw 0
__CTM_MPTR:    defw 0
__CTM_WB:      defw 0
__CTM_W:       defb 0
__CTM_VIS:     defb 0
__CTM_CNT:     defb 0
__CTM_Y:       defb 0
__CTM_ROWS:    defb 0
__CTM_XB:      defb 0
__CTM_RUNB:    defb 0
__CTM_END:     defb 0
__CTM_FAST:    defb 0

    pop namespace
