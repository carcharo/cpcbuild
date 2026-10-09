; -----------------------------------------------------------------------
; cpcbuild library -- pen bytes (a pen as a screen byte)
;
; Written from scratch for this project (MIT); see core.asm.
; Screen byte layouts are from the public CPC documentation (cpcwiki.eu,
; "Video modes"): the tables below are checked against the firmware's
; SCR_INK_ENCODE by tests/conformance/cb_fill.bas. Kept apart from the
; fill so that PenByte and ClearScreen don't carry FillRect and the
; clipper.

#include once <cpcbuild/core.asm>

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

    pop namespace
