; -----------------------------------------------------------------------
; cpcbuild library -- clipping, pen bytes, rectangle fill, clear screen
;
; Written from scratch for this project (MIT); see core.asm. Screen byte
; layouts are from the public CPC documentation (cpcwiki.eu, "Video
; modes"): the tables below are checked against the firmware's
; SCR_INK_ENCODE by tests/conformance/cb_fill.bas.
;
; Also holds the rectangle clipping shared with sprite.asm (which
; includes this file), because the clip is needed by both and this file
; is the smaller one to link.

#include once <cpcbuild/core.asm>
#include once <cpcbuild/nowrap.asm>

    push namespace core

; __CB_PENBYTE -- A = pen -> A = the screen byte with all its pixels in
; that pen, for the current mode (from GFX_XSHIFT: 2 = mode 0, 1 = mode
; 1, 0 = mode 2). The pen is masked to the mode's range (16/4/2 pens).
; Mode 0: pen bits 0-3 sit in screen bits 7,3,5,1 (left pixel) and
; 6,2,4,0 (right pixel). Mode 1: pen bit 0 in bits 7-4, bit 1 in 3-0
; (left pixel is bits 7 and 3). Mode 2: one bit per pixel. Mode 3 (not
; a library mode) is treated as mode 0.
; Firmware entry called: none.
; Registers clobbered: AF, DE, HL.
__CB_PENBYTE:
    PROC
    LOCAL __PB_M0, __PB_M1, __PB_M2, __PB_T0, __PB_T1, __PB_LOOKUP

    ld   l, a
    ld   a, (GFX_XSHIFT)
    or   a
    jr   z, __PB_M2
    dec  a
    jr   z, __PB_M1
__PB_M0:
    ld   a, l
    and  $0F
    ld   de, __PB_T0
    jr   __PB_LOOKUP
__PB_M1:
    ld   a, l
    and  $03
    ld   de, __PB_T1
__PB_LOOKUP:
    ld   l, a
    ld   h, 0
    add  hl, de
    ld   a, (hl)
    ret
__PB_M2:
    ld   a, l
    rra                     ; pen bit 0 -> carry
    sbc  a, a               ; &FF or 0
    ret
__PB_T0:
    DEFB $00, $C0, $0C, $CC, $30, $F0, $3C, $FC
    DEFB $03, $C3, $0F, $CF, $33, $F3, $3F, $FF
__PB_T1:
    DEFB $00, $F0, $0F, $FF
    ENDP

; __CB_CLIP1 -- clips one axis. HL = position (signed 16-bit), A = size
; (0-255), E = the axis limit (80 bytes across, 200 lines down).
; Returns Carry set if nothing is visible. Otherwise Carry clear,
; L = first visible position (0 if the start was off the left/top),
; D = how many items were cut off at the start, C = the visible count.
; Firmware entry called: none. Registers clobbered: AF, C, D, HL
; (E is preserved).
__CB_CLIP1:
    PROC
    LOCAL __CC1_POS, __CC1_LIMIT, __CC1_EMPTY, __CC1_OK

    or   a
    jr   z, __CC1_EMPTY
    ld   c, a
    bit  7, h
    jr   z, __CC1_POS
    xor  a                  ; negative: HL = -HL
    sub  l
    ld   l, a
    sbc  a, a
    sub  h                  ; (0 - L borrow) folded: A = -H - borrow
    ld   h, a
    or   a
    jr   nz, __CC1_EMPTY    ; cut off 256 or more: more than any size
    ld   a, l
    cp   c
    jr   nc, __CC1_EMPTY    ; cut off all of it
    ld   d, a
    ld   a, c
    sub  d
    ld   c, a               ; visible = size - cut
    ld   l, 0
    jr   __CC1_LIMIT
__CC1_POS:
    ld   a, h
    or   a
    jr   nz, __CC1_EMPTY
    ld   a, l
    cp   e
    jr   nc, __CC1_EMPTY    ; starts at or past the limit
    ld   d, 0
__CC1_LIMIT:
    ld   a, e
    sub  l                  ; room left before the limit (>= 1)
    cp   c
    jr   nc, __CC1_OK
    ld   c, a               ; cut at the far edge
__CC1_OK:
    or   a
    ret
__CC1_EMPTY:
    scf
    ret
    ENDP

; __CB_CLIP_RECT -- clips a rectangle to the screen. HL = x, DE = y
; (signed 16-bit, in bytes and lines), B = width (bytes), C = height
; (lines). Returns Carry set if nothing is visible. Otherwise Carry
; clear, HL = the screen address of the visible top-left byte, and
; the variables __CBC_CW (visible width), __CBC_CH (visible height),
; __CBC_SX (bytes cut off at the left) and __CBC_SY (rows cut off at the
; top) are set.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_CLIP_RECT:
    PROC
    LOCAL __CCR_EMPTY

    ld   a, c
    ld   (__CBC_H), a
    push de                 ; y
    ld   a, b
    ld   e, 80
    call __CB_CLIP1
    jr   c, __CCR_EMPTY
    ld   a, l
    ld   (__CBC_X0), a
    ld   a, d
    ld   (__CBC_SX), a
    ld   a, c
    ld   (__CBC_CW), a
    pop  hl                 ; y
    ld   a, (__CBC_H)
    ld   e, 200
    call __CB_CLIP1
    ret  c
    ld   a, d
    ld   (__CBC_SY), a
    ld   a, c
    ld   (__CBC_CH), a
    ld   b, l               ; first visible line
    ld   a, (__CBC_X0)
    ld   c, a
    jp   __CB_ADDR          ; leaves Carry clear
__CCR_EMPTY:
    pop  hl
    scf
    ret
    ENDP

; Clip results (word-sized where a "ld bc,(...)" wants the high byte 0).
__CBC_CW:  DEFW 0
__CBC_CH:  DEFB 0
__CBC_SX:  DEFB 0
__CBC_SY:  DEFB 0
__CBC_X0:  DEFB 0
__CBC_H:   DEFB 0
__CBF_BYTE: DEFB 0
__CBF_SP:  DEFW 0

; __CB_FILL_RECT -- FillRect's body; reads its parameters from the
; caller's IX frame: x = (ix+4), y = (ix+6) (16-bit), w = (ix+9),
; h = (ix+11), pen = (ix+13). Fills the clipped rectangle with the pen's
; byte, one row at a time: a seeded LDIR for a row that doesn't wrap
; around the end of its 2 KB block, a byte at a time (__CB_INC_X) for
; one that does. When no row on the screen can wrap (__CB_NOWRAP) the
; per-row wrap test is skipped.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_FILL_RECT:
    PROC
    LOCAL __CFR_ROW, __CFR_SLOW, __CFR_NEXT, __CFR_SLOWLP, __CFR_FAST, __CFR_FL1

    ld   l, (ix+4)
    ld   h, (ix+5)
    ld   e, (ix+6)
    ld   d, (ix+7)
    ld   b, (ix+9)
    ld   c, (ix+11)
    call __CB_CLIP_RECT
    ret  c
    push hl
    ld   a, (ix+13)
    call __CB_PENBYTE
    ld   (__CBF_BYTE), a
    pop  hl
    call __CB_NOWRAP
    jr   nc, __CFR_ROW
__CFR_FAST:                 ; no row can wrap
    ld   a, (__CBF_BYTE)
    ld   bc, (__CBC_CW)
    push hl
    ld   (hl), a
    dec  c                  ; B is 0
    jr   z, __CFR_FL1       ; one byte only (LDIR with BC=0 would run 64K)
    ld   d, h
    ld   e, l
    inc  de
    ldir
__CFR_FL1:
    pop  hl
    ld   a, (__CBC_CH)
    dec  a
    ret  z
    ld   (__CBC_CH), a
    ld   a, h               ; next line: usually just the next 2 KB block
    add  a, 8
    ld   h, a
    and  $38
    jr   nz, __CFR_FAST
    ld   a, h               ; crossed into the next character row
    sub  8
    ld   h, a
    call __CB_NEXT_LINE
    jr   __CFR_FAST
__CFR_ROW:
    push hl                 ; row start
    ld   bc, (__CBC_CW)
    call __CB_ROW_WRAPS
    ld   a, (__CBF_BYTE)
    jr   c, __CFR_SLOW
    ld   (hl), a
    dec  c                  ; B is 0
    jr   z, __CFR_NEXT      ; one byte only (LDIR with BC=0 would run 64K)
    ld   d, h
    ld   e, l
    inc  de
    ldir
    jr   __CFR_NEXT
__CFR_SLOW:
    ld   b, c
__CFR_SLOWLP:
    ld   (hl), a
    call __CB_INC_X         ; keeps B, but not A
    ld   a, (__CBF_BYTE)
    djnz __CFR_SLOWLP
__CFR_NEXT:
    pop  hl
    ld   a, (__CBC_CH)
    dec  a
    ret  z
    ld   (__CBC_CH), a
    call __CB_NEXT_LINE
    jr   __CFR_ROW
    ENDP

; __CB_CLEAR -- A = byte -> fills the whole 16 KB drawing screen with
; it, using the stack pointer as a fast fill pointer: 256 chunks of 32
; PUSHes (64 bytes), each with interrupts off and the real SP back
; before they go on again, so the interrupt handler always finds a
; proper stack (about 25 ms in all). Returns with interrupts on.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_CLEAR:
    ld   d, a
    ld   e, a
    ld   (__CBF_SP), sp
    ld   a, (CB_BASE)
    add  a, $40             ; end of the screen (&0000 for &C000)
    ld   h, a
    ld   l, 0
    ld   b, 0               ; 256 chunks of 64 bytes = 16384 bytes
__CCL_LOOP:
    di
    ld   sp, hl
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    push de
    ld   hl, 0
    add  hl, sp             ; HL = where the next chunk ends
    ld   sp, (__CBF_SP)
    ei
    djnz __CCL_LOOP
    ret

    pop namespace
