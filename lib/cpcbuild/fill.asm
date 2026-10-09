; -----------------------------------------------------------------------
; cpcbuild library -- rectangle fill
;
; Written from scratch for this project (MIT); see core.asm. The pen
; bytes are in penbyte.asm, the clipping in clip.asm (also used by the
; sprite routines), ClearScreen in clear.asm.

#include once <cpcbuild/core.asm>
#include once <cpcbuild/nowrap.asm>
#include once <cpcbuild/penbyte.asm>
#include once <cpcbuild/clip.asm>

    push namespace core

__CBF_BYTE: DEFB 0

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

    pop namespace
