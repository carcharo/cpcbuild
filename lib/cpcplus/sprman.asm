; -----------------------------------------------------------------------
; cpcplus library -- hardware sprite slot manager (the routines behind
; sprman.bas; see its header for what they do and for the calls)
;
; Written from scratch for this project (MIT). Everything goes through
; plusspr.asm's routines (__PL_IMG, __PL_IMGP, __PL_MOVE, __PL_MAGREG), so
; the paging rules, the interrupt handling, the no-ASIC no-op and the
; firmware / bare behaviour are theirs. No routine here touches IX or IY
; (the BASIC wrappers' frame is IX); BC, DE, HL and the temporaries below
; are clobbered, which is why none of them may run from a raster handler or
; a frame hook that interrupted a call of this module.
;
; Data (16 records of 10 bytes, indexed by the hardware sprite number, so
; the slots the manager does not own stay unused):
;   +0 flags  +1 magnification register value (0 hides; 5 = 1x1)
;   +2 picture address (0 = the slot holds none)   +4 age (the value of the
;   free-clock when it was freed)   +6 X (integer)   +8 Y (integer)
; Flags: 1 allocated, 2 the picture is packed, 4 upload pending, 8 has a
; position, 16 shown (the ASIC has its position and magnification).
; -----------------------------------------------------------------------

#include once <cpcplus/plusspr.asm>

    push namespace core

__SM_USED   EQU 1
__SM_PACK   EQU 2
__SM_PEND   EQU 4
__SM_POS    EQU 8
__SM_SHOWN  EQU 16

; __SM_REC -- A = slot (0-15) -> HL = its record. Registers clobbered: AF, BC.
__SM_REC:
    ld   l, a
    ld   h, 0
    ld   b, h
    ld   c, l
    add  hl, hl
    add  hl, hl
    add  hl, bc             ; 5 * slot
    add  hl, hl             ; 10 * slot
    ld   bc, __SM_REC0
    add  hl, bc
    ret

; __SM_OWN -- A = slot: carry set if the manager owns it (A kept).
; Registers clobbered: BC, HL.
__SM_OWN:
    ld   b, a
    ld   a, (__SM_FIRST)
    ld   c, a
    ld   a, b
    sub  c                  ; a slot below first wraps to 241 or more
    ld   hl, __SM_COUNT
    cp   (hl)               ; carry if slot - first < count
    ld   a, b
    ret

; __SM_INIT -- A = first, C = count: SprMgrInit.
__SM_INIT:
    PROC
    LOCAL __SI_1, __SI_2, __SI_LOOP
    cp   16
    jr   c, __SI_1
    ld   a, 15
    ld   c, 0
__SI_1:
    ld   b, a               ; B = first
    ld   a, 16
    sub  b                  ; room
    cp   c
    jr   nc, __SI_2
    ld   c, a               ; count = room
__SI_2:
    ld   a, b
    ld   (__SM_FIRST), a
    ld   a, c
    ld   (__SM_COUNT), a
    xor  a
    ld   (__SM_PENDN), a
    ld   h, a
    ld   l, a
    ld   (__SM_CLOCK), hl
    ld   (__SM_UP), hl
    ld   hl, __SM_REC0
    ld   de, __SM_REC0 + 1
    ld   (hl), a
    ld   bc, 159
    ldir
    ld   a, (__SM_COUNT)
    or   a
    ret  z
    ld   b, a
    ld   a, (__SM_FIRST)
    ld   c, a
__SI_LOOP:                  ; hide the slots it owns
    push bc
    ld   a, c
    ld   e, 0
    call __PL_MAGREG
    pop  bc
    inc  c
    djnz __SI_LOOP
    ret
    ENDP

; __SM_ALLOC -- HL = picture, C = 0 (unpacked) or 2 (packed): A = a slot, or
; 255. A free slot holding that picture is taken as it is; else the free slot
; with no picture, else the one freed longest ago, gets an upload queued.
__SM_ALLOC:
    PROC
    LOCAL __SA_NONE, __SA_LOOP, __SA_CAND, __SA_AGE, __SA_SC, __SA_TAKE, __SA_NEXT, __SA_HIT
    ld   a, h
    or   l
    jp   z, __SA_NONE
    ld   a, (__SM_COUNT)
    or   a
    jp   z, __SA_NONE
    ld   (__SM_TIMG), hl
    ld   a, c
    ld   (__SM_TPK), a
    ld   a, 255
    ld   (__SM_TBEST), a
    ld   a, (__SM_FIRST)
    ld   (__SM_TS), a
    call __SM_REC
    ld   (__SM_TREC), hl
    ld   a, (__SM_COUNT)
    ld   b, a
__SA_LOOP:
    push bc
    ld   hl, (__SM_TREC)    ; HL = record
    ld   a, (hl)
    and  __SM_USED
    jp   nz, __SA_NEXT
    push hl
    inc  hl
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)            ; DE = the slot's picture
    ld   hl, (__SM_TIMG)
    or   a
    sbc  hl, de
    pop  hl                 ; HL = record
    jr   nz, __SA_CAND
    ld   a, (hl)
    and  __SM_PACK
    ld   b, a
    ld   a, (__SM_TPK)
    cp   b
    jp   z, __SA_HIT
__SA_CAND:                  ; a candidate: score 65535 if empty, else the age
    inc  hl
    inc  hl
    ld   a, (hl)
    inc  hl
    or   (hl)               ; Z if no picture
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)            ; DE = freed at
    jr   nz, __SA_AGE
    ld   hl, $FFFF
    jr   __SA_SC
__SA_AGE:
    ld   hl, (__SM_CLOCK)
    or   a
    sbc  hl, de             ; how long ago
    ld   a, h
    and  l
    inc  a
    jr   nz, __SA_SC
    dec  hl                 ; at most 65534: an empty slot always wins
__SA_SC:
    ld   a, (__SM_TBEST)
    inc  a
    jp   z, __SA_TAKE       ; the first candidate
    ld   de, (__SM_TSCORE)
    ex   de, hl             ; HL = best so far, DE = this one
    or   a
    sbc  hl, de
    jp   nc, __SA_NEXT      ; this one is no older: keep the best
    ex   de, hl
__SA_TAKE:
    ld   (__SM_TSCORE), hl
    ld   a, (__SM_TS)
    ld   (__SM_TBEST), a
__SA_NEXT:
    ld   a, (__SM_TS)
    inc  a
    ld   (__SM_TS), a
    ld   hl, (__SM_TREC)
    ld   de, 10
    add  hl, de
    ld   (__SM_TREC), hl
    pop  bc
    dec  b
    jp   nz, __SA_LOOP
    ld   a, (__SM_TBEST)
    cp   255
    ret  z
    call __SM_REC           ; the chosen slot
    ld   a, (__SM_TPK)
    or   __SM_USED + __SM_PEND
    ld   (hl), a
    inc  hl
    ld   (hl), 5
    inc  hl
    ld   de, (__SM_TIMG)
    ld   (hl), e
    inc  hl
    ld   (hl), d
    ld   hl, __SM_PENDN
    inc  (hl)
    ld   a, (__SM_TBEST)
    ret
__SA_HIT:                   ; HL = record, BC still on the stack
    ld   a, (__SM_TPK)
    or   __SM_USED
    ld   (hl), a
    inc  hl
    ld   (hl), 5
    pop  bc
    ld   a, (__SM_TS)
    ret
__SA_NONE:
    ld   a, 255
    ret
    ENDP

; __SM_FREE -- A = slot: SprFree.
__SM_FREE:
    PROC
    LOCAL __SF_KEEP, __SF_AGE, __SF_NOHIDE
    call __SM_OWN
    ret  nc
    ld   (__SM_TS), a
    call __SM_REC
    ld   a, (hl)
    and  __SM_USED
    ret  z
    ld   a, (hl)
    and  __SM_SHOWN
    jr   z, __SF_NOHIDE
    ld   a, (__SM_TS)
    ld   e, 0
    call __PL_MAGREG
    ld   a, (__SM_TS)
    call __SM_REC
__SF_NOHIDE:
    ld   a, (hl)
    and  __SM_PEND
    jr   z, __SF_KEEP
    ld   hl, __SM_PENDN
    dec  (hl)
    ld   a, (__SM_TS)       ; waiting for an upload: the slot holds nothing
    call __SM_REC
    xor  a
    ld   (hl), a
    inc  hl
    inc  hl
    ld   (hl), a
    inc  hl
    ld   (hl), a
    jr   __SF_AGE
__SF_KEEP:                  ; keeps its picture (and whether it is packed)
    ld   a, (hl)
    and  __SM_PACK
    ld   (hl), a
__SF_AGE:
    ld   hl, (__SM_CLOCK)
    inc  hl
    ld   (__SM_CLOCK), hl
    ex   de, hl
    ld   a, (__SM_TS)
    call __SM_REC
    inc  hl
    inc  hl
    inc  hl
    inc  hl
    ld   (hl), e
    inc  hl
    ld   (hl), d
    ret
    ENDP

; __SM_SETIMG -- A = slot, HL = picture, C = 0 or 2: SprSetImage(Packed).
__SM_SETIMG:
    PROC
    LOCAL __SS_CHANGE, __SS_WAS
    ld   (__SM_TIMG), hl
    ex   de, hl
    ld   hl, __SM_TPK
    ld   (hl), c
    ld   h, d
    ld   l, e
    ld   b, a
    ld   a, h
    or   l
    ret  z                  ; a picture of 0 is refused
    ld   a, b
    call __SM_OWN
    ret  nc
    call __SM_REC
    ld   a, (hl)
    and  __SM_USED
    ret  z
    push hl
    inc  hl
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    ld   hl, (__SM_TIMG)
    or   a
    sbc  hl, de
    pop  hl
    jr   nz, __SS_CHANGE
    ld   a, (hl)
    and  __SM_PACK
    ld   b, a
    ld   a, (__SM_TPK)
    cp   b
    ret  z                  ; it holds this picture already
__SS_CHANGE:
    push hl
    inc  hl
    inc  hl
    ld   de, (__SM_TIMG)
    ld   (hl), e
    inc  hl
    ld   (hl), d
    pop  hl
    ld   a, (hl)
    and  __SM_PEND
    jr   nz, __SS_WAS
    ld   a, (__SM_PENDN)
    inc  a
    ld   (__SM_PENDN), a
__SS_WAS:
    ld   a, (hl)
    and  __SM_USED + __SM_POS + __SM_SHOWN
    or   __SM_PEND
    ld   b, a
    ld   a, (__SM_TPK)
    or   b
    ld   (hl), a
    ret
    ENDP

; __SM_MOVE -- SprMove, parameters on the BASIC wrapper's frame as for
; SpriteMove (IX+5 slot, IX+6/7 X, IX+8/9 Y).
__SM_MOVE:
    PROC
    LOCAL __SV_NOTSHOWN
    ld   a, (ix+5)
    call __SM_OWN
    ret  nc
    call __SM_REC
    ld   a, (hl)
    and  __SM_USED
    ret  z
    push hl
    ld   de, 6
    add  hl, de
    ld   a, (ix+6)
    ld   (hl), a
    inc  hl
    ld   a, (ix+7)
    ld   (hl), a
    inc  hl
    ld   a, (ix+8)
    ld   (hl), a
    inc  hl
    ld   a, (ix+9)
    ld   (hl), a
    pop  hl
    ld   a, (hl)
    or   __SM_POS
    ld   (hl), a
    and  __SM_SHOWN
    jr   z, __SV_NOTSHOWN
    jp   __PL_MOVE          ; shown: the new position is all there is to do
__SV_NOTSHOWN:
    ld   a, (hl)
    and  __SM_PEND
    ret  nz                 ; waiting for its picture: it appears when that is up
    push hl
    call __PL_MOVE
    pop  hl
    ld   a, (hl)
    or   __SM_SHOWN
    ld   (hl), a
    inc  hl
    ld   e, (hl)
    ld   a, (ix+5)
    jp   __PL_MAGREG
    ENDP

; __SM_MAG -- SprMag, frame as SpriteMag (IX+5 slot, IX+7 magx, IX+9 magy).
__SM_MAG:
    PROC
    LOCAL __SG_OFF, __SG_GO
    ld   a, (ix+7)
    call __PL_MAGCODE
    add  a, a
    add  a, a
    ld   e, a
    ld   a, (ix+9)
    call __PL_MAGCODE
    or   e
    ld   e, a
    ld   a, (ix+7)
    or   a
    jr   z, __SG_OFF
    ld   a, (ix+9)
    or   a
    jr   nz, __SG_GO
__SG_OFF:
    ld   e, 0
__SG_GO:
    ld   a, (ix+5)
    call __SM_OWN
    ret  nc
    call __SM_REC
    ld   a, (hl)
    and  __SM_USED
    ret  z
    inc  hl
    ld   (hl), e
    dec  hl
    ld   a, (hl)
    and  __SM_SHOWN
    ret  z
    ld   a, (ix+5)
    jp   __PL_MAGREG
    ENDP

; __SM_SHOWREC -- HL = the record of slot (__SM_TS) that has a position: puts
; its position and magnification into the ASIC and marks it shown. A frame
; for __PL_MOVE is built on the stack (it reads its parameters at IX+5..9).
__SM_SHOWREC:
    push hl
    ld   de, 6
    add  hl, de
    ld   e, (hl)
    inc  hl
    ld   d, (hl)            ; DE = X
    inc  hl
    ld   c, (hl)
    inc  hl
    ld   b, (hl)            ; BC = Y
    push ix
    push bc
    push de
    ld   a, (__SM_TS)
    ld   h, a
    ld   l, 0
    push hl                 ; the slot, as IX+5
    ld   ix, -4
    add  ix, sp
    call __PL_MOVE
    ld   hl, 6
    add  hl, sp
    ld   sp, hl
    pop  ix
    pop  hl                 ; the record
    ld   a, (hl)
    or   __SM_SHOWN
    ld   (hl), a
    inc  hl
    ld   e, (hl)
    ld   a, (__SM_TS)
    jp   __PL_MAGREG

; __SM_FLUSH -- A = budget: SprFlush.
__SM_FLUSH:
    PROC
    LOCAL __SL_LOOP, __SL_UNP, __SL_UP, __SL_NEXT
    ld   b, a
    ld   a, (__SM_PENDN)
    or   a
    ret  z
    ld   a, b
    or   a
    ret  z
    ld   (__SM_TBUD), a
    ld   a, (__SM_FIRST)
    ld   (__SM_TS), a
    ld   a, (__SM_COUNT)
    ld   (__SM_TN), a
__SL_LOOP:
    ld   a, (__SM_TS)
    call __SM_REC
    ld   a, (hl)
    and  __SM_PEND
    jr   z, __SL_NEXT
    ld   a, (hl)
    and  __SM_PACK
    inc  hl
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    ex   de, hl             ; HL = the picture
    jr   nz, __SL_UNP
    ld   a, (__SM_TS)
    call __PL_IMG
    jr   __SL_UP
__SL_UNP:
    ld   a, (__SM_TS)
    call __PL_IMGP
__SL_UP:
    ld   hl, (__SM_UP)
    inc  hl
    ld   (__SM_UP), hl
    ld   hl, __SM_PENDN
    dec  (hl)
    ld   a, (__SM_TS)
    call __SM_REC
    ld   a, (hl)
    and  255 - __SM_PEND
    ld   (hl), a
    and  __SM_POS + __SM_SHOWN
    cp   __SM_POS
    call z, __SM_SHOWREC
    ld   hl, __SM_TBUD
    dec  (hl)
    ret  z
    ld   a, (__SM_PENDN)
    or   a
    ret  z
__SL_NEXT:
    ld   hl, __SM_TS
    inc  (hl)
    ld   hl, __SM_TN
    dec  (hl)
    jp   nz, __SL_LOOP
    ret
    ENDP

; ---- data (in the program image, zero at load) ------------------------------

__SM_REC0:  defs 160
__SM_FIRST: defb 0
__SM_COUNT: defb 0
__SM_PENDN: defb 0
__SM_CLOCK: defw 0
__SM_UP:    defw 0
; temporaries
__SM_TS:    defb 0
__SM_TN:    defb 0
__SM_TBUD:  defb 0
__SM_TPK:   defb 0
__SM_TBEST: defb 0
__SM_TIMG:  defw 0
__SM_TSCORE: defw 0
__SM_TREC:  defw 0

    pop namespace
