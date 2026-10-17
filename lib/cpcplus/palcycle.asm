; -----------------------------------------------------------------------
; cpcplus library -- palette cycling (the routines behind palcycle.bas; see
; its header for what they do and for the calls)
;
; Written from scratch for this project (MIT). The colours reach the ASIC
; through plusgfx.asm's __PL_PALBLOCK (one window per cycle, paging and
; interrupt rules as there). No routine touches IX or IY.
;
; Data: 4 records of 8 bytes: +0 table (word), +2 first palette entry
; (0-15 pens, 17-31 sprite colours), +3 count (0 = unused), +4 period, +5
; frames left, +6 rotation offset, +7 direction (0 forward, 1 backward, 2
; ping-pong up, 3 ping-pong down). And the 32-byte buffer of the rotated
; colours in the ASIC's byte order.
; -----------------------------------------------------------------------

#include once <cpcplus/plusgfx.asm>

    push namespace core

; __PC_REC -- A = id (0-3) -> HL = its record. Registers clobbered: AF, DE.
__PC_REC:
    add  a, a
    add  a, a
    add  a, a
    ld   e, a
    ld   d, 0
    ld   hl, __PC_REC0
    add  hl, de
    ret

; __PC_SEG -- HL = source (words &0RGB), DE = destination, B = how many
; colours (0 allowed): converted to the ASIC's byte order (red * 16 + blue,
; then green). Registers clobbered: AF, BC, HL, DE advanced.
__PC_SEG:
    PROC
    LOCAL __PS_W
    ld   a, b
    or   a
    ret  z
__PS_W:
    push bc
    ld   c, (hl)            ; C = green * 16 + blue
    inc  hl
    ld   a, (hl)            ; A = red
    inc  hl
    add  a, a
    add  a, a
    add  a, a
    add  a, a
    ld   b, a               ; B = red * 16
    ld   a, c
    and  $0F
    or   b
    ld   (de), a
    inc  de
    ld   a, c
    rrca
    rrca
    rrca
    rrca
    and  $0F
    ld   (de), a
    inc  de
    pop  bc
    djnz __PS_W
    ret
    ENDP

; __PC_APPLY -- HL = a record: writes its table rotated by its offset (entry
; first + i gets table((i + offset) mod count)) in one block.
__PC_APPLY:
    ld   e, (hl)
    inc  hl
    ld   d, (hl)            ; DE = table
    inc  hl
    ld   a, (hl)
    ld   (__PC_TE), a
    inc  hl
    ld   a, (hl)
    ld   (__PC_TC), a
    inc  hl
    inc  hl
    inc  hl
    ld   a, (hl)
    ld   (__PC_TO), a
    add  a, a
    ld   l, a
    ld   h, 0
    add  hl, de             ; HL = table + 2 * offset
    push de                 ; the table
    ld   de, __PC_BUF
    ld   a, (__PC_TO)
    ld   b, a
    ld   a, (__PC_TC)
    sub  b
    ld   b, a               ; count - offset colours first
    call __PC_SEG
    pop  hl                 ; then the first `offset` colours
    ld   a, (__PC_TO)
    ld   b, a
    call __PC_SEG
    ld   hl, __PC_BUF
    ld   a, (__PC_TE)
    ld   d, a
    ld   a, (__PC_TC)
    ld   e, a
    jp   __PL_PALBLOCK

; __PC_SET -- the BASIC wrapper's frame: IX+5 id, IX+7 kind, IX+9 first,
; IX+11 count, IX+12/13 table, IX+15 period: PalCycleSet.
__PC_SET:
    PROC
    LOCAL __PE_SPR, __PE_COUNT, __PE_PER, __PE_STORE, __PE_STORE2
    ld   a, (ix+5)
    cp   4
    ret  nc
    call __PC_REC
    ld   (hl), 0            ; (the table word is set below; count 0 = unused)
    inc  hl
    inc  hl
    inc  hl
    ld   (hl), 0
    ld   a, (ix+9)          ; first
    ld   b, a
    ld   a, (ix+7)
    or   a
    jr   nz, __PE_SPR
    ld   a, b               ; pens: first 0-15, count cut to 16 - first
    cp   16
    ret  nc
    jr   __PE_COUNT
__PE_SPR:                   ; sprite colours: first 1-15 (entry 16 + first)
    ld   a, b
    or   a
    ret  z
    cp   16
    ret  nc
__PE_COUNT:
    ld   c, a               ; C = first
    ld   a, 16
    sub  c                  ; room
    ld   b, (ix+11)
    cp   b
    jr   nc, __PE_PER
    ld   b, a               ; count = room
__PE_PER:
    ld   a, b
    cp   2
    ret  c                  ; fewer than two colours: nothing to cycle
    ld   a, (ix+7)
    or   a
    jr   z, __PE_STORE
    ld   a, c
    add  a, 16
    ld   c, a
__PE_STORE:                 ; C = first entry, B = count
    ld   a, (ix+5)
    call __PC_REC           ; HL = record
    ld   a, (ix+12)
    ld   (hl), a
    inc  hl
    ld   a, (ix+13)
    ld   (hl), a
    inc  hl
    ld   (hl), c            ; +2 first entry
    inc  hl
    ld   (hl), b            ; +3 count
    inc  hl
    ld   a, (ix+15)
    or   a
    jr   nz, __PE_STORE2
    inc  a                  ; a period of 0 counts as 1
__PE_STORE2:
    ld   (hl), a            ; +4 period
    inc  hl
    ld   (hl), a            ; +5 frames left
    inc  hl
    xor  a
    ld   (hl), a            ; +6 offset
    inc  hl
    ld   (hl), a            ; +7 forward
    ld   a, (ix+5)
    call __PC_REC
    jp   __PC_APPLY
    ENDP

; __PC_DIR -- A = id, C = direction: PalCycleDir.
__PC_DIR:
    cp   4
    ret  nc
    call __PC_REC
    ld   de, 7
    add  hl, de
    ld   a, c
    cp   3
    jr   c, __PD_OK
    xor  a
__PD_OK:
    ld   (hl), a
    ret

; __PC_STOP -- A = id: PalCycleStop.
__PC_STOP:
    cp   4
    ret  nc
    call __PC_REC
    inc  hl
    inc  hl
    inc  hl
    ld   (hl), 0
    ret

; __PC_STEP -- PalCycleStep: every cycle that is due moves on by one.
__PC_STEP:
    PROC
    LOCAL __PT_LOOP, __PT_DUE, __PT_FWD, __PT_BACK, __PT_UP, __PT_DOWN, __PT_APPLY, __PT_NEXT, __PT_DEC, __PT_STO
    xor  a
    ld   (__PC_TI), a
    ld   hl, __PC_REC0
    ld   (__PC_TR), hl
__PT_LOOP:
    ld   hl, (__PC_TR)
    inc  hl
    inc  hl
    inc  hl
    ld   c, (hl)            ; C = count
    ld   a, c
    or   a
    jr   z, __PT_NEXT
    inc  hl
    inc  hl                 ; HL = frames left
    ld   a, (hl)
    cp   2
    jr   c, __PT_DUE
    dec  (hl)
    jr   __PT_NEXT
__PT_DUE:
    dec  hl
    ld   a, (hl)            ; the period
    inc  hl
    ld   (hl), a            ; frames left = period
    inc  hl                 ; HL = offset
    inc  hl                 ; HL = direction
    ld   a, (hl)
    dec  hl                 ; HL = offset
    or   a
    jr   z, __PT_FWD
    dec  a
    jr   z, __PT_BACK
    dec  a
    jr   z, __PT_UP
__PT_DOWN:                  ; ping-pong, going down
    ld   a, (hl)
    or   a
    jr   nz, __PT_DEC
    inc  hl
    ld   (hl), 2            ; turn: up
    dec  hl
    ld   (hl), 1
    jr   __PT_APPLY
__PT_FWD:
    ld   a, (hl)
    inc  a
    cp   c
    jr   c, __PT_STO
    xor  a
__PT_STO:
    ld   (hl), a
    jr   __PT_APPLY
__PT_BACK:
    ld   a, (hl)
    or   a
    jr   nz, __PT_DEC
    ld   a, c
    dec  a
    ld   (hl), a
    jr   __PT_APPLY
__PT_DEC:
    dec  (hl)
    jr   __PT_APPLY
__PT_UP:
    ld   a, (hl)
    inc  a
    cp   c
    jr   c, __PT_STO        ; offset + 1 < count: on up
    inc  hl
    ld   (hl), 3            ; turn: down
    dec  hl
    ld   a, c
    sub  2
    ld   (hl), a
__PT_APPLY:
    ld   hl, (__PC_TR)
    call __PC_APPLY
__PT_NEXT:
    ld   hl, (__PC_TR)
    ld   de, 8
    add  hl, de
    ld   (__PC_TR), hl
    ld   hl, __PC_TI
    inc  (hl)
    ld   a, (hl)
    cp   4
    jr   c, __PT_LOOP
    ret
    ENDP

; ---- data -------------------------------------------------------------------

__PC_REC0:  defs 32
__PC_BUF:   defs 32
__PC_TI:    defb 0
__PC_TE:    defb 0
__PC_TC:    defb 0
__PC_TO:    defb 0
__PC_TR:    defw 0

    pop namespace
