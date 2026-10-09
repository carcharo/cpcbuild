; -----------------------------------------------------------------------
; cpcbuild library -- clear screen
;
; Written from scratch for this project (MIT); see core.asm.
; ClearScreen's body (the pen byte comes from penbyte.asm).

#include once <cpcbuild/core.asm>

    push namespace core

__CBF_SP:  DEFW 0

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
