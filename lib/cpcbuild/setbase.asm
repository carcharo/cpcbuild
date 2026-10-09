; -----------------------------------------------------------------------
; cpcbuild library -- showing a screen (the CRTC start address)
;
; Written from scratch for this project (MIT); see core.asm and display.asm
; (the notes on double buffering and on bare-metal mode there apply).

#include once <cpcbuild/core.asm>

    push namespace core

; __CB_SET_BASE -- A = base high byte (&00, &40, &80 or &C0): shows that
; 16 KB screen (and, in firmware mode, makes the firmware's text go there
; too). Takes effect at the next frame.
; Firmware entry called: SCR_SET_BASE (&BC08).
; Registers clobbered: AF (main); BC', DE', HL', AF' (the gate).
;
; Bare-metal mode (-D CPC_BAREMETAL): CRTC registers 12 and 13 directly
; (start address = base, plus CB_OFFSET/2 words; the CRTC reads it at the
; start of the next frame, so writing after the flyback is safe). The
; bare runtime's text base (SCREEN_ADDR) is pointed at the same screen,
; so PRINT follows the shown screen as the firmware's does. Hardware
; used: CRTC (&BCxx/&BDxx).
; Registers clobbered: AF, BC, DE, HL.
__CB_SET_BASE:
#ifdef CPC_BAREMETAL
    ld   h, a
    ld   l, 0
    ld   (SCREEN_ADDR), hl
    rrca
    rrca
    and  $30                ; R12 bits 5-4: address bits 15-14
    ld   d, a
    ld   hl, (CB_OFFSET)
    srl  h
    rr   l                  ; offset in words
    ld   a, h
    and  3
    or   d
    ld   d, a               ; R12
    ld   e, l               ; R13
    ld   bc, $BC0C
    out  (c), c
    ld   b, $BD
    out  (c), d
    ld   bc, $BC0D
    out  (c), c
    ld   b, $BD
    out  (c), e
    ret
#else
    call .core.__FW_CALL
    defw $BC08
    ret
#endif

    pop namespace
