; -----------------------------------------------------------------------
; cpcbuild library -- rectangle clipping
;
; Written from scratch for this project (MIT); see core.asm.
; The clip shared by FillRect (fill.asm) and the sprite routines
; (sprcommon.asm); kept in a file of its own so that PutSprite doesn't
; carry FillRect.

#include once <cpcbuild/core.asm>

    push namespace core

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

    pop namespace
