; -----------------------------------------------------------------------
; cpcbuild library -- TileRestore: redraw the tiles under a rectangle
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
; This file: __CB_TILE_RESTORE, which uses the map routines' fast row
; loops and __CB_TILEMAP_S (tilemap.asm).
#include once <cpcbuild/core.asm>
#include once <cpcbuild/nowrap.asm>
#include once <cpcbuild/tilemap.asm>

    push namespace core

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

    pop namespace
