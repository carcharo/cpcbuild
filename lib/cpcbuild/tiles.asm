; -----------------------------------------------------------------------
; cpcbuild library -- 8x8 tiles drawn straight into screen memory
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

#include once <cpcbuild/core.asm>
#include once <cpcbuild/nowrap.asm>

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

; __CB_TILE_AT -- C = cell x, B = cell y, HL = tile number (0-1023):
; draws it, or nothing if the cell is off the screen (x * W >= 80 or
; y >= 25). One branch per mode, each with its own shifts (data address =
; TILESET + n * 8 W, byte column = W x) and straight to its unrolled
; drawer unless the tile is in the last 256 bytes of the block (where it
; could wrap: __CB_TILE_DRAW does the checking).
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_TILE_AT:
    PROC
    LOCAL __CTA_M1, __CTA_M2

    ld   a, b
    cp   25
    ret  nc                 ; below the screen
    ld   a, (GFX_XSHIFT)
    or   a
    jr   z, __CTA_M2
    dec  a
    jr   z, __CTA_M1
    ld   a, c               ; mode 0: 20 cells of 4 bytes
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
    ld   a, c               ; mode 1: 40 cells of 2 bytes
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
    ld   a, c               ; mode 2: 80 cells of 1 byte
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
; __CB_TILE_RESTORE -- redraws the tiles under a screen rectangle, from
; a map laid out from screen cell (0, 0): HL = map, A = its row length
; in bytes, E = x (byte column), D = y (pixel line), C = width in bytes
; (>= 1), B = height in lines (>= 1). Draws every 8x8 cell the rectangle
; touches (cells x >> s .. (x + w - 1) >> s and y >> 3 .. (y + h - 1) >> 3,
; where the tile is 2^s bytes wide). Meant for erasing a sprite in one
; call, so the usual case is short: when every cell is on the screen and
; no row can wrap (__CB_NOWRAP) it works out the first screen address
; and map byte once and runs the fast row loop of the mode (__CTM_F4/F2/
; F1) row by row, stepping 80 bytes and one map row. Otherwise it goes
; through __CB_TILEMAP_S, which clips and wraps.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_TILE_RESTORE:
    PROC
    LOCAL __CTR_SH, __CTR_SHD, __CTR_CL, __CTR_CLD, __CTR_XS, __CTR_XSD
    LOCAL __CTR_RS, __CTR_RSD, __CTR_FS, __CTR_MUL, __CTR_MULN
    LOCAL __CTR_ROW, __CTR_CALL, __CTR_SLOW, __CTR_SM, __CTR_SMD

    ld   (__CTR_STRIDE), a
    ld   (__CTR_MAP), hl
    ld   a, d               ; last cell row = (y + h - 1) >> 3
    add  a, b
    dec  a
    rrca
    rrca
    rrca
    and  $1F
    ld   b, a
    ld   a, d               ; first cell row = y >> 3
    rrca
    rrca
    rrca
    and  $1F
    ld   d, a
    ld   a, b
    sub  d
    inc  a
    ld   b, a               ; B = cell rows
    ld   a, e               ; C = last byte column, x + w - 1
    add  a, c
    dec  a
    ld   c, a
    ld   a, (GFX_XSHIFT)
__CTR_SH:                   ; to cell columns: C = last, E = first
    or   a
    jr   z, __CTR_SHD
    srl  c
    srl  e
    dec  a
    jr   __CTR_SH
__CTR_SHD:
    ld   a, c
    sub  e
    inc  a
    ld   c, a               ; C = cell columns
    ; --- the short way: every cell on the screen, no row can wrap ---
    ld   a, d
    add  a, b
    cp   26
    jp   nc, __CTR_SLOW     ; below the last cell row
    push bc
    ld   a, (GFX_XSHIFT)    ; cells per screen row: 80 >> s
    ld   b, a
    inc  b
    ld   a, 80
__CTR_CL:
    dec  b
    jr   z, __CTR_CLD
    srl  a
    jr   __CTR_CL
__CTR_CLD:
    ld   b, a
    ld   a, e
    add  a, c
    dec  a                  ; last cell column
    cp   b
    pop  bc
    jp   nc, __CTR_SLOW     ; off the right edge
    call __CB_NOWRAP        ; Carry set: no row can wrap (A only)
    jp   nc, __CTR_SLOW
    ld   a, b
    ld   (__CTR_ROWS), a
    push de
    push bc
    ld   a, d               ; screen address of cell (E, D)
    add  a, a
    add  a, a
    add  a, a
    ld   b, a               ; B = pixel line
    ld   c, e
    ld   a, (GFX_XSHIFT)
__CTR_XS:
    or   a
    jr   z, __CTR_XSD
    sla  c                  ; C = byte column
    dec  a
    jr   __CTR_XS
__CTR_XSD:
    call __CB_ADDR
    ld   (__CTR_SCR), hl
    pop  bc
    ld   a, (GFX_XSHIFT)    ; run length in bytes = columns << s
    ld   h, a
    ld   a, c
__CTR_RS:
    dec  h
    jp   m, __CTR_RSD
    add  a, a
    jr   __CTR_RS
__CTR_RSD:
    ld   (__CTR_RUNB), a
    ld   a, (GFX_XSHIFT)    ; the mode's fast row loop
    ld   hl, __CTM_F1
    or   a
    jr   z, __CTR_FS
    ld   hl, __CTM_F2
    dec  a
    jr   z, __CTR_FS
    ld   hl, __CTM_F4
__CTR_FS:
    ld   (__CTR_CALL + 1), hl
    pop  de
    ld   a, (__CTR_STRIDE)  ; HL = first row * stride (row < 32: 5 steps)
    ld   c, e               ; C = first column
    ld   e, a
    ld   a, d
    add  a, a
    add  a, a
    add  a, a               ; row in the top 5 bits
    ld   d, 0
    ld   hl, 0
    ld   b, 5
__CTR_MUL:
    add  hl, hl
    add  a, a
    jr   nc, __CTR_MULN
    add  hl, de
__CTR_MULN:
    djnz __CTR_MUL
    ld   b, 0
    add  hl, bc             ; + first column
    ld   de, (__CTR_MAP)
    add  hl, de             ; HL = map byte of the first cell
__CTR_ROW:
    push hl
    ld   de, (__CTR_SCR)
    ld   a, (__CTR_RUNB)
    add  a, e
    ld   (__CTM_END), a
__CTR_CALL:
    call __CTM_F4           ; operand set above
    pop  hl
    ld   de, (__CTR_STRIDE) ; the next map row (high byte always 0)
    add  hl, de
    ex   de, hl
    ld   hl, (__CTR_SCR)    ; the next cell row: 80 on, nothing wraps
    ld   bc, 80
    add  hl, bc
    ld   (__CTR_SCR), hl
    ex   de, hl
    ld   a, (__CTR_ROWS)
    dec  a
    ld   (__CTR_ROWS), a
    jr   nz, __CTR_ROW
    ret
    ; --- the general way, through __CB_TILEMAP_S ---
__CTR_SLOW:
    push bc
    push de
    ld   a, d               ; HL = map + first row * stride + first column
    ld   d, 0
    ld   hl, (__CTR_MAP)
    add  hl, de
    ld   de, (__CTR_STRIDE)
__CTR_SM:
    or   a
    jr   z, __CTR_SMD
    add  hl, de
    dec  a
    jr   __CTR_SM
__CTR_SMD:
    pop  de
    pop  bc
    ld   a, (__CTR_STRIDE)
    jp   __CB_TILEMAP_S
    ENDP

__CTR_STRIDE:  defw 0       ; low byte only; the high byte stays 0
__CTR_MAP:     defw 0
__CTR_SCR:     defw 0
__CTR_RUNB:    defb 0
__CTR_ROWS:    defb 0
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
