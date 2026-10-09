; -----------------------------------------------------------------------
; cpcbuild library -- sprite list: sprites on a plain one-colour
; background, drawn by OR and erased by filling their box
;
; Written from scratch for this project (MIT); see core.asm. Lifted from
; the project's own game, Starfall (games/shooter/platform_cpc.bas).
;
; The list: each list entry is 4 bytes, the screen address of the box's
; top-left byte (low, high), the width in bytes and the height in lines.
; The address includes the screen base (CB_BASE) the sprite was drawn on
; and the hardware-scroll offset, so erasing needs no further lookup.
; Two lists, one per screen: with double buffering, the list for the
; hidden screen is chosen by CB_BASE (&C0 -> list 1, &40 -> list 0);
; without it, list 0 holds the one screen's last frame.
;
; Drawing: a box of width 1, 2 or 4 has its own unrolled loop (OR the
; data onto the screen; erase with rows in alternating directions, so the
; pointer is already at the next row's near end), any other width a
; general loop. The step to the next pixel line is the character-row
; carry done inline (add &800 to the address; at the end of a
; character row go back to block 0 and 80 bytes on), which does not wrap
; inside the 2 KB block: with a hardware-scroll offset a box that crosses
; the block's wrap point is drawn wrong (no clipping, no wrap handling).
;
; Each routine reads its parameters from the calling sub's IX frame:
; x = (ix+5), y = (ix+7), w = (ix+9), h = (ix+11), data = (ix+12)
; (16-bit); all but the data are UBYTE parameters of the sub.
;
; __SL_MAX (entries per list, 1-255) is an EQU that spritelist.bas puts
; in its subs' asm blocks from SPRLIST_MAX (the preprocessor's #define
; does not reach asm files, and a defs needs its size defined earlier,
; which the subs, emitted before the required asm, do).

#include once <cpcbuild/core.asm>

    push namespace core

; Block state. SL_N0 and SL_N1 are adjacent (list 0, list 1 counts).
__SL_N0:    defb 0          ; entries in list 0 (double buffering: as stored by End)
__SL_N1:    defb 0          ; entries in list 1
__SL_BUF:   defb 0          ; double buffering: the list being drawn (0, 1)
__SL_OLDN:  defb 0          ; single: entries of the previous frame
__SL_CNT:   defb 0          ; entries so far this frame
__SL_LP:    defw __SL_L0    ; the list being filled
__SL_E:     defw 0          ; the entry being written
__SL_EC:    defb 0          ; erase loop counter
__SL_ROWS:  defb 0          ; rows left (general draw)
__SL_PAPER: defb 0          ; the background byte
__SL_L0:    defs __SL_MAX * 4
__SL_L1:    defs __SL_MAX * 4

; __SL_DRAW -- ORs a sprite onto the screen. HL = data, DE = screen
; address of the top-left byte, C = width (1-255), B = height (1-255).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__SL_DRAW:
    ld   a, c
    dec  a
    jp   z, __SL_DRAW1
    dec  a
    jp   z, __SL_DRAW2
    sub  2
    jp   z, __SL_DRAW4
    ld   a, b               ; general width
    ld   (__SL_ROWS), a
__SLDGR:
    push de
    ld   b, c
__SLDGI:
    ld   a, (de)
    or   (hl)
    ld   (de), a
    inc  hl
    inc  de
    djnz __SLDGI
    pop  de
    ld   a, d
    add  a, 8
    ld   d, a
    and  $38
    jr   nz, __SLDGN
    ld   a, d
    sub  $40
    ld   d, a
    ld   a, e
    add  a, 80
    ld   e, a
    jr   nc, __SLDGN
    inc  d
__SLDGN:
    ld   a, (__SL_ROWS)
    dec  a
    ld   (__SL_ROWS), a
    jr   nz, __SLDGR
    ret

; __SL_DRAW1 / 2 / 4: the unrolled draws for those widths: HL = data,
; DE = screen address, B = height (1-255). (C is not used.)
; Registers clobbered: AF, B (0), DE, HL.
__SL_DRAW1:
__SLD1R:
    ld   a, (de)
    or   (hl)
    ld   (de), a
    inc  hl
    ld   a, d
    add  a, 8
    ld   d, a
    and  $38
    jr   nz, __SLD5
    ld   a, d
    sub  $40
    ld   d, a
    ld   a, e
    add  a, 80
    ld   e, a
    jr   nc, __SLD5
    inc  d
__SLD5:
    djnz __SLD1R
    ret

__SL_DRAW2:
__SLD2R:
    push de
    ld   a, (de)
    or   (hl)
    ld   (de), a
    inc  hl
    inc  de
    ld   a, (de)
    or   (hl)
    ld   (de), a
    inc  hl
    pop  de
    ld   a, d
    add  a, 8
    ld   d, a
    and  $38
    jr   nz, __SLD6
    ld   a, d
    sub  $40
    ld   d, a
    ld   a, e
    add  a, 80
    ld   e, a
    jr   nc, __SLD6
    inc  d
__SLD6:
    djnz __SLD2R
    ret

__SL_DRAW4:
__SLD4R:
    push de
    ld   a, (de)
    or   (hl)
    ld   (de), a
    inc  hl
    inc  de
    ld   a, (de)
    or   (hl)
    ld   (de), a
    inc  hl
    inc  de
    ld   a, (de)
    or   (hl)
    ld   (de), a
    inc  hl
    inc  de
    ld   a, (de)
    or   (hl)
    ld   (de), a
    inc  hl
    pop  de
    ld   a, d
    add  a, 8
    ld   d, a
    and  $38
    jr   nz, __SLD7
    ld   a, d
    sub  $40
    ld   d, a
    ld   a, e
    add  a, 80
    ld   e, a
    jr   nc, __SLD7
    inc  d
__SLD7:
    djnz __SLD4R
    ret


; __SL_ERASE1 / 2 / 4: clear a box of that width, HL = screen address of
; its top-left byte, B = the background byte, C = height (1-255).
; Registers clobbered: AF, C, HL (B kept).
__SL_ERASE1:
__SLE1L:
    ld   (hl), b
    dec  c
    ret  z
    ld   a, h
    add  a, 8
    ld   h, a
    and  $38
    jr   nz, __SLD0
    ld   a, h
    sub  $40
    ld   h, a
    ld   a, l
    add  a, 80
    ld   l, a
    jr   nc, __SLD0
    inc  h
__SLD0:
    jr   __SLE1L

__SL_ERASE2:
__SLE2L:
    ld   (hl), b
    inc  hl
    ld   (hl), b
    dec  c
    ret  z
    ld   a, h
    add  a, 8
    ld   h, a
    and  $38
    jr   nz, __SLD1
    ld   a, h
    sub  $40
    ld   h, a
    ld   a, l
    add  a, 80
    ld   l, a
    jr   nc, __SLD1
    inc  h
__SLD1:
    ld   (hl), b
    dec  hl
    ld   (hl), b
    dec  c
    ret  z
    ld   a, h
    add  a, 8
    ld   h, a
    and  $38
    jr   nz, __SLD2
    ld   a, h
    sub  $40
    ld   h, a
    ld   a, l
    add  a, 80
    ld   l, a
    jr   nc, __SLD2
    inc  h
__SLD2:
    jr   __SLE2L

__SL_ERASE4:
__SLE4L:
    ld   (hl), b
    inc  hl
    ld   (hl), b
    inc  hl
    ld   (hl), b
    inc  hl
    ld   (hl), b
    dec  c
    ret  z
    ld   a, h
    add  a, 8
    ld   h, a
    and  $38
    jr   nz, __SLD3
    ld   a, h
    sub  $40
    ld   h, a
    ld   a, l
    add  a, 80
    ld   l, a
    jr   nc, __SLD3
    inc  h
__SLD3:
    ld   (hl), b
    dec  hl
    ld   (hl), b
    dec  hl
    ld   (hl), b
    dec  hl
    ld   (hl), b
    dec  c
    ret  z
    ld   a, h
    add  a, 8
    ld   h, a
    and  $38
    jr   nz, __SLD4
    ld   a, h
    sub  $40
    ld   h, a
    ld   a, l
    add  a, 80
    ld   l, a
    jr   nc, __SLD4
    inc  h
__SLD4:
    jr   __SLE4L


; __SL_ERASEG -- clears a box of any width: HL = screen address, D =
; width, E = the background byte, C = height. Rows alternate direction.
; Registers clobbered: AF, BC, HL.
__SL_ERASEG:
__SLEGL:
    ld   b, d
__SLEGF:
    ld   (hl), e
    inc  hl
    djnz __SLEGF
    dec  hl                 ; at the row's last byte
    dec  c
    ret  z
    ld   a, h
    add  a, 8
    ld   h, a
    and  $38
    jr   nz, __SLEG1
    ld   a, h
    sub  $40
    ld   h, a
    ld   a, l
    add  a, 80
    ld   l, a
    jr   nc, __SLEG1
    inc  h
__SLEG1:
    ld   b, d
__SLEGB:
    ld   (hl), e
    dec  hl
    djnz __SLEGB
    inc  hl                 ; at the row's first byte
    dec  c
    ret  z
    ld   a, h
    add  a, 8
    ld   h, a
    and  $38
    jr   nz, __SLEG2
    ld   a, h
    sub  $40
    ld   h, a
    ld   a, l
    add  a, 80
    ld   l, a
    jr   nc, __SLEG2
    inc  h
__SLEG2:
    jr   __SLEGL

; __SL_ERASE_ONE -- HL = an entry: erases its box with the background.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__SL_ERASE_ONE:
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   a, (hl)            ; width
    inc  hl
    ld   c, (hl)            ; height
    ex   de, hl             ; HL = screen address
    ld   d, a
    ld   a, (__SL_PAPER)
    ld   b, a
    ld   e, a
    ld   a, d
    dec  a
    jp   z, __SL_ERASE1
    dec  a
    jp   z, __SL_ERASE2
    sub  2
    jp   z, __SL_ERASE4
    jr   __SL_ERASEG

; __SL_ERASEL -- erases a list: HL = its first entry, A = entry count.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__SL_ERASEL:
    or   a
    ret  z
    ld   (__SL_EC), a
__SLELP:
    push hl
    call __SL_ERASE_ONE
    pop  hl
    inc  hl
    inc  hl
    inc  hl
    inc  hl
    ld   a, (__SL_EC)
    dec  a
    ld   (__SL_EC), a
    jr   nz, __SLELP
    ret

; __SL_BEGIN -- SprListBegin. Double buffering: erases the list of the
; screen to draw on and empties it. Single: the count of the frame that
; just ended becomes "previous", and the new frame's count starts at 0.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__SL_BEGIN:
    ld   a, (CB_DBUF)
    or   a
    jr   nz, __SLB_DBL
    ld   a, (__SL_CNT)
    ld   (__SL_OLDN), a
    xor  a
    ld   (__SL_CNT), a
    ld   hl, __SL_L0
    ld   (__SL_LP), hl
    ret
__SLB_DBL:
    ld   a, (CB_BASE)
    rla                     ; carry = base &C0 (list 1), else &40 (list 0)
    ld   hl, __SL_N0
    ld   de, __SL_L0
    ld   a, 0
    jr   nc, __SLB_1
    inc  a
    inc  hl
    ld   de, __SL_L1
__SLB_1:
    ld   (__SL_BUF), a
    ld   (__SL_LP), de
    ld   a, (hl)            ; the count
    ld   (hl), 0
    ex   de, hl             ; HL = the list
    call __SL_ERASEL
    xor  a
    ld   (__SL_CNT), a
    ret

; __SL_END -- SprListEnd. Single: erases the previous frame's entries
; beyond this frame's count. Double: stores the count for this screen.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__SL_END:
    ld   a, (CB_DBUF)
    or   a
    jr   nz, __SLN_DBL
    ld   a, (__SL_OLDN)
    ld   hl, __SL_CNT
    sub  (hl)
    ret  c
    ret  z
    push af
    ld   a, (__SL_CNT)
    ld   l, a
    ld   h, 0
    add  hl, hl
    add  hl, hl
    ld   de, __SL_L0
    add  hl, de
    pop  af
    jp   __SL_ERASEL
__SLN_DBL:
    ld   hl, __SL_N0
    ld   a, (__SL_BUF)
    or   a
    jr   z, __SLN_0
    inc  hl
__SLN_0:
    ld   a, (__SL_CNT)
    ld   (hl), a
    ret

; __SL_RESET -- SprListReset: forgets both lists without erasing.
; Firmware entry called: none. Registers clobbered: AF.
__SL_RESET:
    xor  a
    ld   (__SL_N0), a
    ld   (__SL_N1), a
    ld   (__SL_OLDN), a
    ld   (__SL_CNT), a
    ret

; __SL_DRAW_SPRITE -- SprListDraw(x, y, w, h, spr): the sub's IX frame.
; Does nothing if the list is full or w or h is 0.
; Single buffering: first erases the previous frame's entry in this slot.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__SL_DRAW_SPRITE:
    ld   a, (__SL_CNT)
    cp   __SL_MAX
    ret  nc
    ld   c, (ix+9)          ; width
    ld   b, (ix+11)         ; height
    ld   a, c
    or   a
    ret  z
    ld   a, b
    or   a
    ret  z
    ld   a, (__SL_CNT)
    ld   c, a               ; (C is free again below)
    ld   l, a
    ld   h, 0
    add  hl, hl
    add  hl, hl
    ld   de, (__SL_LP)
    add  hl, de
    ld   (__SL_E), hl
    ld   a, (CB_DBUF)
    or   a
    jr   nz, __SLS_1
    ld   a, (__SL_OLDN)     ; single: erase this slot's previous sprite
    cp   c
    jr   z, __SLS_1
    jr   c, __SLS_1
    call __SL_ERASE_ONE     ; HL = the entry still
__SLS_1:
    ld   c, (ix+5)
    ld   b, (ix+7)
    call __CB_ADDR          ; HL = screen address
    ex   de, hl
    ld   hl, (__SL_E)
    ld   (hl), e
    inc  hl
    ld   (hl), d
    inc  hl
    ld   a, (ix+9)
    ld   (hl), a
    inc  hl
    ld   c, a
    ld   a, (ix+11)
    ld   (hl), a
    ld   b, a
    ld   hl, __SL_CNT
    inc  (hl)
    ld   l, (ix+12)
    ld   h, (ix+13)
    jp   __SL_DRAW

    pop namespace
