; -----------------------------------------------------------------------
; cpcbuild library -- sprites: put, put masked, get block (all clipped)
;
; Written from scratch for this project (MIT); see core.asm.
;
; Sprite data is already in screen-byte format (2 pixels per byte in mode
; 0, 4 in mode 1, 8 in mode 2), row-major, top row first, w bytes per
; row; masked data is (mask, pixels) byte pairs. x is in bytes, y in
; lines, from the top-left, and may be off the screen: the part outside
; 0-79 / 0-199 is clipped away (the source bytes and rows are skipped,
; the data keeps its full w-byte row layout). The clip itself is
; __CB_CLIP_RECT in fill.asm.
;
; Each routine reads its parameters from the calling sub's IX frame:
; x = (ix+4), y = (ix+6) (16-bit), w = (ix+9), h = (ix+11), data or
; buffer address = (ix+12) (16-bit). Three tiers: a sprite of width 1, 2,
; 4 or 8 that is not clipped at its sides, when no row of the screen can
; wrap (__CB_NOWRAP), takes the unrolled loops further down; otherwise
; rows that don't wrap around the end of their 2 KB block (hardware-scroll
; offset) use LDIR / plain increments; rows that do use __CB_INC_X per
; byte. __CB_SPR_PREP skips the clipper for a sprite entirely on the
; screen.

#include once <cpcbuild/fill.asm>

    push namespace core

; __CB_SPR_PREP -- common set-up. A = bytes per item in the data (1, or
; 2 for masked pairs). Clips the rectangle; returns Carry set if nothing
; is visible. Otherwise Carry clear, HL = screen address of the first
; visible byte, DE = address in the data/buffer of the first visible item
; (data + (SY*w + SX) * A), and __CBS_SKIP = bytes to add to the data
; pointer after each row ((w - visible width) * A); __CBC_CH is the
; row count. A sprite entirely on the screen (x, y in 0-255, 1-80 wide, 1-200
; high, fitting) skips the clipper: its address is computed directly and
; __CBS_SKIP is 0.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_SPR_PREP:
    PROC
    LOCAL __CSP_ONE1, __CSP_ONE2, __CSP_NOSY, __CSP_MUL, __CSP_CLIP

    ld   e, a               ; (kept in E for the clipper path)
    ld   a, (ix+5)
    or   (ix+7)
    jr   nz, __CSP_CLIP     ; x or y outside 0-255: needs the clipper
    ld   c, (ix+4)          ; C = x
    ld   b, (ix+6)          ; B = y
    ld   l, (ix+9)          ; L = w
    ld   h, (ix+11)         ; H = h
    ld   a, l
    dec  a
    cp   80
    jr   nc, __CSP_CLIP     ; w is not 1-80
    ld   a, 80
    sub  l                  ; 80 - w: the last x that fits
    cp   c
    jr   c, __CSP_CLIP
    ld   a, h
    dec  a
    cp   200
    jr   nc, __CSP_CLIP     ; h is not 1-200
    ld   a, 200
    sub  h                  ; 200 - h: the last y that fits
    cp   b
    jr   c, __CSP_CLIP
    ld   a, l               ; entirely on screen: nothing to clip
    ld   (__CBC_CW), a
    ld   a, h
    ld   (__CBC_CH), a
    call __CB_ADDR
    ld   de, 0
    ld   (__CBS_SKIP), de
    ld   e, (ix+12)
    ld   d, (ix+13)
    or   a
    ret
__CSP_CLIP:
    ld   a, e
    ld   (__CBS_K), a
    ld   l, (ix+4)
    ld   h, (ix+5)
    ld   e, (ix+6)
    ld   d, (ix+7)
    ld   b, (ix+9)
    ld   c, (ix+11)
    call __CB_CLIP_RECT
    ret  c
    push hl                 ; screen address
    ld   a, (ix+9)
    ld   hl, __CBC_CW
    sub  (hl)               ; w - visible width
    ld   l, a
    ld   h, 0
    ld   a, (__CBS_K)
    dec  a
    jr   z, __CSP_ONE1
    add  hl, hl
__CSP_ONE1:
    ld   (__CBS_SKIP), hl
    ld   hl, 0              ; offset = SY * w + SX
    ld   a, (__CBC_SY)
    or   a
    jr   z, __CSP_NOSY
    ld   e, (ix+9)
    ld   d, 0
    ld   b, a
__CSP_MUL:
    add  hl, de
    djnz __CSP_MUL
__CSP_NOSY:
    ld   a, (__CBC_SX)
    ld   e, a
    ld   d, 0
    add  hl, de
    ld   a, (__CBS_K)
    dec  a
    jr   z, __CSP_ONE2
    add  hl, hl
__CSP_ONE2:
    ld   e, (ix+12)
    ld   d, (ix+13)
    add  hl, de
    ex   de, hl             ; DE = data pointer
    pop  hl                 ; HL = screen address
    or   a
    ret
    ENDP

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

; ---------------------------------------------------------------------
; Unrolled fast paths (PutSprite, PutSpriteMasked, GetBlock)
;
; Used when the whole sprite is drawn without clipping at its sides
; (visible width = w), no row can wrap in its 2 KB block (__CB_NOWRAP)
; and the width is 1, 2, 4 or 8 bytes; anything else takes the generic
; loops above. The choice is made once per call (__CB_SPR_UNROLLED), then
; __CB_FAST_ROWS walks the rows one character row at a time (a "group" of
; up to 8 rows, which are 2 KB apart) and calls the width's inner loop.
; An inner loop gets A = rows in the group (1-8), HL = screen address of
; its first row, DE = data/buffer address; it returns with HL = the first
; row's address + 2 KB per row (the row after the group, in block terms)
; and DE = data after the group. It may clobber AF, BC, DE, HL.
;
; The copy loops are LDI chains (20 CPC T-states a byte, the cheapest way
; to move a byte); the stepping to the next 2 KB block is done with the
; screen address in HL (ADD HL,BC), so it needs no page-crossing care. The
; masked loops come in two forms, chosen per group by the width's gate
; (__CMWn): "F" steps with INC L / INC E and needs the screen row (low
; byte <= 256 - n) and the data of the group (low byte <= 255 - 16 n,
; i.e. 8 rows of 2n bytes) not to cross a 256-byte page; "S" uses
; INC HL / INC DE and handles any address.
; ---------------------------------------------------------------------

; __CB_SPR_UNROLLED -- HL = screen address of the first visible byte,
; DE = data address (as returned by __CB_SPR_PREP), BC = the routine's
; table (the inner loops for widths 1, 2, 4, 8 as four DEFWs). Draws the
; whole sprite and returns Carry clear, or, if this draw does not qualify
; (rows can wrap, clipped at a side, or a width other than 1/2/4/8),
; returns Carry set having drawn nothing (HL, DE preserved).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_SPR_UNROLLED:
    PROC
    LOCAL __CSU_NO, __CSU_GO

    push hl
    push de
    push bc
    call __CB_NOWRAP        ; Carry set if no row can wrap
    pop  hl                 ; HL = table (flags kept)
    jr   nc, __CSU_NO
    ld   de, (__CBS_SKIP)
    ld   a, d
    or   e
    jr   nz, __CSU_NO       ; clipped at a side (leaves D = 0 otherwise)
    ld   a, (__CBC_CW)
    cp   1
    jr   z, __CSU_GO
    ld   e, 2
    cp   2
    jr   z, __CSU_GO
    ld   e, 4
    cp   4
    jr   z, __CSU_GO
    ld   e, 6
    cp   8
    jr   nz, __CSU_NO
__CSU_GO:
    add  hl, de
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    ld   (__CBS_INN), de
    pop  de
    pop  hl
    call __CB_FAST_ROWS
    or   a
    ret
__CSU_NO:
    pop  de
    pop  hl
    scf
    ret
    ENDP

; __CB_FAST_ROWS -- the row driver: HL = screen address of the first
; row, DE = data, __CBC_CH = rows (>= 1), __CBS_INN = the inner loop.
; Draws all the rows, group by group (the first group ends at the end of
; the character row it starts in, the others have 8 rows). Each inner
; loop is entered by a RET (its address pushed) and ends by jumping to
; __CFR_NEXT, which returns to the driver's caller when no rows are left;
; otherwise HL (= the group's first row + 2 KB per row, i.e. in "block 8")
; becomes the first row of the next character row: back 16 KB to block 0
; and on 80 bytes (nothing wraps on this path, so a plain add is right).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_FAST_ROWS:
    PROC
    LOCAL __CFR_GRP, __CFR_CMP, __CFR_FULL, __CFR_GO

    ld   a, h
    cpl
    and  $38
    rrca
    rrca
    rrca                    ; 7 - block: this line's place in its character row
    inc  a                  ; A = rows left in this character row (1-8)
    jr   __CFR_CMP
__CFR_GRP:
    ld   a, 8
__CFR_CMP:
    ld   c, a
    ld   a, (__CBC_CH)      ; rows left
    cp   c
    jr   c, __CFR_FULL
    sub  c
    ld   (__CBC_CH), a      ; this group: C rows, then A are left
    ld   a, c
    jr   __CFR_GO
__CFR_FULL:                 ; fewer than a full group left: all of them
    ld   c, a               ; (A = rows left, 1-7)
    xor  a
    ld   (__CBC_CH), a
    ld   a, c
__CFR_GO:
    ld   bc, (__CBS_INN)
    push bc
    ret
__CFR_NEXT:
    ld   a, (__CBC_CH)
    or   a
    ret  z
    ld   a, h
    sub  $40
    ld   h, a
    ld   bc, 80
    add  hl, bc
    jr   __CFR_GRP
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

__CBS_INN: DEFW 0

__CBS_K:    DEFB 0
__CBS_SKIP: DEFW 0

    pop namespace
