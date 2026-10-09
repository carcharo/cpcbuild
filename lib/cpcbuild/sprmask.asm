; -----------------------------------------------------------------------
; cpcbuild library -- PutSpriteMasked (clipped masked sprite)
;
; Written from scratch for this project (MIT); see core.asm and
; sprcommon.asm (the set-up and the unrolled fast paths all three sprite
; routines share).

#include once <cpcbuild/sprcommon.asm>

    push namespace core

; __CB_PUT_MASKED -- PutSpriteMasked's body: data is (mask, pixels)
; pairs; each screen byte becomes (screen AND mask) OR pixels.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_PUT_MASKED:
    PROC
    LOCAL __CPM_ROW, __CPM_SLOW, __CPM_SLOWLP, __CPM_FASTLP, __CPM_TAIL, __CPM_FAST, __CPM_FLP, __CPM_FSAME

    ld   a, 2
    call __CB_SPR_PREP
    ret  c
    ld   bc, __CPM_TAB
    call __CB_SPR_UNROLLED  ; width 1/2/4/8, unclipped, no wrap: done
    ret  nc
    call __CB_NOWRAP
    jr   nc, __CPM_ROW
__CPM_FAST:                 ; no row can wrap: no per-row test
    push hl
    ex   de, hl             ; HL = data, DE = screen
    ld   a, (__CBC_CW)
    ld   b, a
__CPM_FLP:
    ld   a, (de)
    and  (hl)
    inc  hl
    or   (hl)
    inc  hl
    ld   (de), a
    inc  de
    djnz __CPM_FLP
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
    jr   nz, __CPM_FSAME
    ld   a, h               ; crossed into the next character row
    sub  8
    ld   h, a
    call __CB_NEXT_LINE
__CPM_FSAME:
    jr   __CPM_FAST
__CPM_ROW:
    push hl                 ; row start
    push de                 ; data
    ld   bc, (__CBC_CW)
    call __CB_ROW_WRAPS
    pop  de
    jr   c, __CPM_SLOW
    ex   de, hl             ; HL = data, DE = screen
    ld   b, c
__CPM_FASTLP:
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    djnz __CPM_FASTLP
    ex   de, hl             ; DE = data after the row
    jr   __CPM_TAIL
__CPM_SLOW:
    ld   b, c
__CPM_SLOWLP:
    ld   a, (de)            ; mask
    inc  de
    and  (hl)               ; AND screen
    ld   c, a
    ld   a, (de)            ; pixels
    inc  de
    or   c
    ld   (hl), a
    call __CB_INC_X         ; keeps B and C
    djnz __CPM_SLOWLP
__CPM_TAIL:
    ld   hl, (__CBS_SKIP)
    add  hl, de
    ex   de, hl
    pop  hl
    ld   a, (__CBC_CH)
    dec  a
    ret  z
    ld   (__CBC_CH), a
    call __CB_NEXT_LINE
    jr   __CPM_ROW
    ENDP


; PutSpriteMasked inner loops, width N: the gate __CMWn (A = rows) picks F or
; S; both swap to HL = data, DE = screen (AND (HL) / OR (HL) read the
; data) and come back swapped. F keeps the screen row's low byte in C and
; restores it per row; S steps the screen address back N with the borrow.
__CMW1:
    ld   b, a               ; rows
    ld   a, 255
    cp   l
    jr   c, __CMS1         ; the screen row could cross a page
    ld   a, 239
    cp   e
    jr   c, __CMS1         ; the data could cross a page
__CMF1:
    ex   de, hl             ; HL = data, DE = screen
    ld   c, e               ; screen row start (low byte)
__CMF1L:
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   e, c
    ld   a, d
    add  a, 8               ; next 2 KB block
    ld   d, a
    djnz __CMF1L
    ex   de, hl             ; HL = screen + 2 KB, DE = data
    jp   __CFR_NEXT
__CMS1:
    ex   de, hl             ; HL = data, DE = screen
__CMS1L:
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, e
    sub  1
    ld   e, a
    ld   a, d
    sbc  a, 0               ; borrow from the low byte
    add  a, 8               ; next 2 KB block
    ld   d, a
    djnz __CMS1L
    ex   de, hl             ; HL = screen + 2 KB, DE = data
    jp   __CFR_NEXT
__CMW2:
    ld   b, a               ; rows
    ld   a, 254
    cp   l
    jr   c, __CMS2         ; the screen row could cross a page
    ld   a, 223
    cp   e
    jr   c, __CMS2         ; the data could cross a page
__CMF2:
    ex   de, hl             ; HL = data, DE = screen
    ld   c, e               ; screen row start (low byte)
__CMF2L:
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   e, c
    ld   a, d
    add  a, 8               ; next 2 KB block
    ld   d, a
    djnz __CMF2L
    ex   de, hl             ; HL = screen + 2 KB, DE = data
    jp   __CFR_NEXT
__CMS2:
    ex   de, hl             ; HL = data, DE = screen
__CMS2L:
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, e
    sub  2
    ld   e, a
    ld   a, d
    sbc  a, 0               ; borrow from the low byte
    add  a, 8               ; next 2 KB block
    ld   d, a
    djnz __CMS2L
    ex   de, hl             ; HL = screen + 2 KB, DE = data
    jp   __CFR_NEXT
__CMW4:
    ld   b, a               ; rows
    ld   a, 252
    cp   l
    jr   c, __CMS4         ; the screen row could cross a page
    ld   a, 191
    cp   e
    jr   c, __CMS4         ; the data could cross a page
__CMF4:
    ex   de, hl             ; HL = data, DE = screen
    ld   c, e               ; screen row start (low byte)
__CMF4L:
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   e, c
    ld   a, d
    add  a, 8               ; next 2 KB block
    ld   d, a
    djnz __CMF4L
    ex   de, hl             ; HL = screen + 2 KB, DE = data
    jp   __CFR_NEXT
__CMS4:
    ex   de, hl             ; HL = data, DE = screen
__CMS4L:
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, e
    sub  4
    ld   e, a
    ld   a, d
    sbc  a, 0               ; borrow from the low byte
    add  a, 8               ; next 2 KB block
    ld   d, a
    djnz __CMS4L
    ex   de, hl             ; HL = screen + 2 KB, DE = data
    jp   __CFR_NEXT
__CMW8:
    ld   b, a               ; rows
    ld   a, 248
    cp   l
    jr   c, __CMS8         ; the screen row could cross a page
    ld   a, 127
    cp   e
    jr   c, __CMS8         ; the data could cross a page
__CMF8:
    ex   de, hl             ; HL = data, DE = screen
    ld   c, e               ; screen row start (low byte)
__CMF8L:
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  l
    or   (hl)               ; OR pixels
    inc  l
    ld   (de), a
    inc  e
    ld   e, c
    ld   a, d
    add  a, 8               ; next 2 KB block
    ld   d, a
    djnz __CMF8L
    ex   de, hl             ; HL = screen + 2 KB, DE = data
    jp   __CFR_NEXT
__CMS8:
    ex   de, hl             ; HL = data, DE = screen
__CMS8L:
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, (de)            ; screen
    and  (hl)               ; AND mask
    inc  hl
    or   (hl)               ; OR pixels
    inc  hl
    ld   (de), a
    inc  de
    ld   a, e
    sub  8
    ld   e, a
    ld   a, d
    sbc  a, 0               ; borrow from the low byte
    add  a, 8               ; next 2 KB block
    ld   d, a
    djnz __CMS8L
    ex   de, hl             ; HL = screen + 2 KB, DE = data
    jp   __CFR_NEXT

__CPM_TAB:
    DEFW __CMW1, __CMW2, __CMW4, __CMW8


    pop namespace
