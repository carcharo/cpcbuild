; -----------------------------------------------------------------------
; cpcbuild library -- PutSprite (clipped copy of a sprite onto the screen)
;
; Written from scratch for this project (MIT); see core.asm and
; sprcommon.asm (the set-up and the unrolled fast paths all three sprite
; routines share).

#include once <cpcbuild/sprcommon.asm>

    push namespace core

; __CB_PUT_SPRITE -- PutSprite's body: copies the visible part of the
; w*h bytes at data onto the screen, overwriting.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_PUT_SPRITE:
    PROC
    LOCAL __CPS_ROW, __CPS_SLOW, __CPS_SLOWLP, __CPS_TAIL, __CPS_FAST, __CPS_FSAME

    ld   a, 1
    call __CB_SPR_PREP
    ret  c
    ld   bc, __CPS_TAB
    call __CB_SPR_UNROLLED  ; width 1/2/4/8, unclipped, no wrap: done
    ret  nc
    call __CB_NOWRAP
    jr   nc, __CPS_ROW
__CPS_FAST:                 ; no row can wrap: no per-row test
    push hl
    ex   de, hl             ; HL = data, DE = screen
    ld   bc, (__CBC_CW)
    ldir
    ex   de, hl             ; DE = data after the row
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
    jr   nz, __CPS_FSAME
    ld   a, h               ; crossed into the next character row
    sub  8
    ld   h, a
    call __CB_NEXT_LINE
__CPS_FSAME:
    jr   __CPS_FAST
__CPS_ROW:
    push hl                 ; row start
    push de                 ; data
    ld   bc, (__CBC_CW)
    call __CB_ROW_WRAPS
    pop  de
    jr   c, __CPS_SLOW
    ex   de, hl             ; HL = data, DE = screen
    ldir
    ex   de, hl             ; DE = data after the row
    jr   __CPS_TAIL
__CPS_SLOW:
    ld   b, c
__CPS_SLOWLP:
    ld   a, (de)
    inc  de
    ld   (hl), a
    call __CB_INC_X         ; keeps B
    djnz __CPS_SLOWLP
__CPS_TAIL:
    ld   hl, (__CBS_SKIP)
    add  hl, de
    ex   de, hl             ; DE = data at the next row
    pop  hl                 ; row start
    ld   a, (__CBC_CH)
    dec  a
    ret  z
    ld   (__CBC_CH), a
    call __CB_NEXT_LINE
    jr   __CPS_ROW
    ENDP


; PutSprite inner loops, width N: per row, LDI x N, then on to the next 2 KB block.
__CPI1:
__CPI1L:
    ex   de, hl             ; HL = data, DE = screen
    ldi
    ex   de, hl             ; HL = screen + N, DE = data
    ld   bc, $800 - 1
    add  hl, bc
    dec  a
    jr   nz, __CPI1L
    jp   __CFR_NEXT
__CPI2:
__CPI2L:
    ex   de, hl             ; HL = data, DE = screen
    ldi
    ldi
    ex   de, hl             ; HL = screen + N, DE = data
    ld   bc, $800 - 2
    add  hl, bc
    dec  a
    jr   nz, __CPI2L
    jp   __CFR_NEXT
__CPI4:
__CPI4L:
    ex   de, hl             ; HL = data, DE = screen
    ldi
    ldi
    ldi
    ldi
    ex   de, hl             ; HL = screen + N, DE = data
    ld   bc, $800 - 4
    add  hl, bc
    dec  a
    jr   nz, __CPI4L
    jp   __CFR_NEXT
__CPI8:
__CPI8L:
    ex   de, hl             ; HL = data, DE = screen
    ldi
    ldi
    ldi
    ldi
    ldi
    ldi
    ldi
    ldi
    ex   de, hl             ; HL = screen + N, DE = data
    ld   bc, $800 - 8
    add  hl, bc
    dec  a
    jr   nz, __CPI8L
    jp   __CFR_NEXT

__CPS_TAB:
    DEFW __CPI1, __CPI2, __CPI4, __CPI8


    pop namespace
