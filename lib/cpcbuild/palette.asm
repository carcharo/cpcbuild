; -----------------------------------------------------------------------
; cpcbuild library -- palette, firmware and Gate Array together
;
; Written from scratch for this project (MIT); see core.asm. From the
; public documentation of the Gate Array's colour registers and colour
; numbers (cpcwiki.eu), checked in the emulator (tools/palette_check.py).
;
; This file holds the palette upload only; the colour tables and the
; Gate Array write (__CPC_SET_INK, __CPC_GA_SET ...) are the compiler's
; own runtime, src/lib/arch/cpc/runtime/gacolour.asm, shared with SetInk
; and SetBorder in cpc.bas.

#include once <gacolour.asm>

    push namespace core

; __CB_PAL_UPLOAD -- HL = list of firmware colours, B = count, C = first
; pen: pen C gets the first colour, C+1 the next, and so on, each set
; with __CPC_SET_INK. Stops after pen 15; a count of 0 does nothing.
; Firmware entry called: SCR_SET_INK (&BC32), once per pen.
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF' (the gate).
__CB_PAL_UPLOAD:
    PROC
    LOCAL __CPU_LOOP

__CPU_LOOP:
    ld   a, b
    or   a
    ret  z
    ld   a, c
    cp   16
    ret  nc
    push bc
    push hl
    ld   c, (hl)
    call __CPC_SET_INK    ; A = pen, C = colour
    pop  hl
    pop  bc
    inc  hl
    inc  c
    djnz __CPU_LOOP
    ret
    ENDP

    pop namespace
