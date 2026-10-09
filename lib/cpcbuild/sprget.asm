; -----------------------------------------------------------------------
; cpcbuild library -- GetBlock (clipped copy of the screen into a buffer)
;
; Written from scratch for this project (MIT); see core.asm and
; sprcommon.asm (the set-up and the unrolled fast paths all three sprite
; routines share).

#include once <cpcbuild/sprcommon.asm>

    push namespace core

; __CB_GET_BLOCK -- GetBlock's body: copies the visible part of the
; screen area into the buffer, keeping the buffer's w-byte row layout
; (bytes that would come from off-screen are left as they were).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_GET_BLOCK:
    PROC
    LOCAL __CGB_ROW, __CGB_SLOW, __CGB_SLOWLP, __CGB_TAIL, __CGB_FAST, __CGB_FSAME

    ld   a, 1
    call __CB_SPR_PREP
    ret  c
    ld   bc, __CGB_TAB
    call __CB_SPR_UNROLLED  ; width 1/2/4/8, unclipped, no wrap: done
    ret  nc
    call __CB_NOWRAP
    jr   nc, __CGB_ROW
__CGB_FAST:                 ; no row can wrap: no per-row test
    push hl
    ld   bc, (__CBC_CW)
    ldir                    ; HL = screen, DE = buffer
    ld   hl, (__CBS_SKIP)
    add  hl, de
    ex   de, hl
    pop  hl
    ld   a, (__CBC_CH)
    dec  a
    ret  z
    ld   (__CBC_CH), a
    ld   a, h               ; next line: usually just the next 2 KB block
    add  a, 8
    ld   h, a
    and  $38
    jr   nz, __CGB_FSAME
    ld   a, h               ; crossed into the next character row
    sub  8
    ld   h, a
    call __CB_NEXT_LINE
__CGB_FSAME:
    jr   __CGB_FAST
__CGB_ROW:
    push hl                 ; row start
    push de                 ; buffer
    ld   bc, (__CBC_CW)
    call __CB_ROW_WRAPS
    pop  de
    jr   c, __CGB_SLOW
    ldir                    ; HL = screen, DE = buffer
    jr   __CGB_TAIL
__CGB_SLOW:
    ld   b, c
__CGB_SLOWLP:
    ld   a, (hl)
    ld   (de), a
    inc  de
    call __CB_INC_X
    djnz __CGB_SLOWLP
__CGB_TAIL:
    ld   hl, (__CBS_SKIP)
    add  hl, de
    ex   de, hl
    pop  hl
    ld   a, (__CBC_CH)
    dec  a
    ret  z
    ld   (__CBC_CH), a
    call __CB_NEXT_LINE
    jr   __CGB_ROW
    ENDP


; GetBlock inner loops, width N: per row, LDI x N (screen to buffer).
__CGI1:
    ldi
    ld   bc, $800 - 1
    add  hl, bc
    dec  a
    jr   nz, __CGI1
    jp   __CFR_NEXT
__CGI2:
    ldi
    ldi
    ld   bc, $800 - 2
    add  hl, bc
    dec  a
    jr   nz, __CGI2
    jp   __CFR_NEXT
__CGI4:
    ldi
    ldi
    ldi
    ldi
    ld   bc, $800 - 4
    add  hl, bc
    dec  a
    jr   nz, __CGI4
    jp   __CFR_NEXT
__CGI8:
    ldi
    ldi
    ldi
    ldi
    ldi
    ldi
    ldi
    ldi
    ld   bc, $800 - 8
    add  hl, bc
    dec  a
    jr   nz, __CGI8
    jp   __CFR_NEXT

__CGB_TAB:
    DEFW __CGI1, __CGI2, __CGI4, __CGI8


    pop namespace
