; -----------------------------------------------------------------------
; cpcplus library -- programmable raster interrupts, bare-metal mode only
;
; Written from scratch for this project (MIT); see plus.asm for the ASIC
; page, the unlock and the paged access (PLX1W: one byte written to the
; ASIC page from the private block, no interrupt flag change). The whole
; file is only assembled with -D CPC_BAREMETAL: in firmware mode the six
; interrupts per frame drive the firmware's keyboard scan, clock and sound
; queue, and a non-zero PRI stops them.
;
; The hardware (Caprice32 crtc.cpp match_hsw, CPCEC cpcec.c; notes.md
; Phase 7 P3). PRI (&6800) = a scan line 1-255 counted from the first line
; of the picture (0 = off). While it is non-zero the Gate Array's own
; interrupt every 52 lines is not generated (both emulators), and one
; interrupt is raised at that line's horizontal sync, every frame, for
; the same PRI value. So one interrupt a frame comes at a time, and to
; have several lines per frame the handler writes the next line into PRI
; each time (a line already passed fires next frame). In IM 1 the Z80's
; own interrupt acknowledge clears the request (CPCEC z80_irq_ack:
; PRI always; Caprice32: the request is a one-shot flag); no write to
; DCSR is needed, and the IVR is not used.
;
; The handler (this file's __RI_ISR, which RasterIntAt puts in the vector at
; &0039 instead of the bare runtime's __CPC_ISR, and puts back when the last
; raster handler is removed): keeps a table of up to RI_MAX - 1 user lines
; and one frame entry, sorted by line. On an interrupt it runs every entry
; of the line that fired (user handlers called by address, the frame entry
; __CPC_FH_RUN: FH_FRAMES + 1, GM_COUNT 0 and the frame hook), but first
; writes the next entry's line into PRI (the first line again after the
; last, for the next frame) so that a long handler delays the next entry
; instead of losing it. User handlers run with interrupts off and with every
; register (AF, BC, DE, HL, IX, IY and the alternate set) saved around them,
; exactly like the frame hook; they must end with RET, must not call the
; firmware, and must not change the table (RasterIntAt/Off/Move/Clear) or use
; the paging calls with DI/EI of the library (the library's calls that
; need interrupts-on state are safe from the frame hook, which has them
; off; from a raster handler too). The frame entry is at line RI_FRAME_LINE
; (the vertical blank of the standard screen: sync starts at line 240),
; so Frames(), PAUSE, BEEP and the frame hook keep their 50 Hz.
;
; State (program image): RI_N entries in the table (0 = raster mode off:
; &0039 holds __CPC_ISR, PRI is 0), RI_IDX the entry that fires next, RI_LINE
; the lines, RI_HAND the handler addresses (0 = the frame entry).
; Switching on programs PRI, lets one possible pending ordinary interrupt
; go to the ordinary handler (EI, NOP, DI, only if the caller had
; interrupts on), then patches the vector and registers __RI_EXIT in
; CPC_EXIT_VEC, which END's reset calls to put PRI back to 0.
; Everything that changes the table runs with interrupts off.
; Locking the ASIC (PlusLock) clears the raster interrupts first.
; -----------------------------------------------------------------------

#ifdef CPC_BAREMETAL

#include once <cpcplus/plus.asm>
#include once <framecore.asm>

    push namespace core

RI_FRAME_LINE   EQU 243     ; the frame entry's line
RI_MAX          EQU 16      ; table size: 15 user lines + the frame entry

; __RI_UCALL -- HL = handler: calls it with everything saved around it.
; (Interrupts are off; the caller has saved AF, BC, DE, HL.)
; Registers clobbered: none.
__RI_UCALL:
    push ix
    push iy
    exx
    push bc
    push de
    push hl
    exx
    ex   af, af'
    push af
    ex   af, af'
    call __RI_JPHL
    ex   af, af'
    pop  af
    ex   af, af'
    exx
    pop  hl
    pop  de
    pop  bc
    exx
    pop  iy
    pop  ix
    ret
__RI_JPHL:
    jp   (hl)

; __RI_ISR -- the IM 1 handler while raster interrupts are on (entered
; with interrupts off, through the vector at &0038). Hardware: PRI &6800
; (one byte through the trampoline). Registers clobbered: none.
__RI_ISR:
    PROC
    LOCAL __RI_GRP, __RI_GEND, __RI_NOW, __RI_RUN, __RI_USER, __RI_NEXT
    push af
    push bc
    push de
    push hl
    ld   a, (RI_IDX)
    ld   e, a               ; E = first entry of the line that fired
    ld   c, a
    ld   b, 0
    ld   hl, RI_LINE
    add  hl, bc
    ld   d, (hl)            ; D = that line
    ld   a, (RI_N)
    ld   b, a               ; B = entries
__RI_GRP:                   ; entries on the same line run together
    inc  c
    inc  hl
    ld   a, c
    cp   b
    jr   nc, __RI_GEND
    ld   a, (hl)
    cp   d
    jr   z, __RI_GRP
__RI_GEND:
    ld   a, c
    sub  e
    ld   d, a               ; D = how many, E = the first
    push de
    ld   a, c
    cp   b
    jr   c, __RI_NOW
    ld   c, 0               ; wrapped: next frame, first entry
__RI_NOW:
    ld   a, c
    ld   (RI_IDX), a
    ld   b, 0
    ld   hl, RI_LINE
    add  hl, bc
    ld   a, (hl)
    ld   hl, $6800
    call PLX1W              ; PRI = the next entry's line
    pop  de
__RI_RUN:
    push de
    ld   d, 0
    ld   hl, RI_HAND
    add  hl, de
    add  hl, de
    ld   a, (hl)
    inc  hl
    ld   h, (hl)
    ld   l, a               ; HL = handler
    or   h
    jr   nz, __RI_USER
    call __CPC_FH_RUN       ; the frame entry (saves everything itself)
    jr   __RI_NEXT
__RI_USER:
    call __RI_UCALL
__RI_NEXT:
    pop  de
    inc  e
    dec  d
    jr   nz, __RI_RUN
    pop  hl
    pop  de
    pop  bc
    pop  af
    ei
    ret
    ENDP

; __RI_PRIIDX -- PRI = the line of the entry RI_IDX. Interrupts must be off.
; Registers clobbered: AF, BC, HL.
__RI_PRIIDX:
    ld   a, (RI_IDX)
    ld   c, a
    ld   b, 0
    ld   hl, RI_LINE
    add  hl, bc
    ld   a, (hl)
    ld   hl, $6800
    jp   PLX1W

; __RI_STOP -- raster mode off: PRI = 0, the ordinary handler back in the
; vector, table empty, no exit routine. Interrupts must be off; the ASIC
; unlocked. Registers clobbered: AF, BC, HL.
__RI_STOP:
    xor  a
    ld   hl, $6800
    call PLX1W
    ld   hl, __CPC_ISR
    ld   ($0039), hl
    ld   hl, 0
    ld   (CPC_EXIT_VEC), hl
    xor  a
    ld   (RI_N), a
    ld   (RI_IDX), a
    ret

; __RI_EXIT -- CPC_EXIT_VEC's routine (END's reset, interrupts off).
__RI_EXIT:
    jp   __RI_STOP

; __RI_CLEAR -- RasterIntClear: all raster interrupts off, back to the
; ordinary six interrupts a frame. Registers clobbered: AF, BC, DE, HL.
__RI_CLEAR:
    ld   a, (RI_N)
    or   a
    ret  z
    call __PL_DI
    call __RI_STOP
    jp   __PL_EI

; __RI_AT -- RasterIntAt: A = line (1-255, else nothing), HL = handler (not
; 0). Adds the line to the table, or replaces its handler. Switches raster
; mode on if it was off. Table full (15 user lines): nothing happens.
; Hardware: PRI &6800 (one byte), CRTC/ASIC state through __PL_ENSURE.
; Registers clobbered: AF, BC, DE, HL.
__RI_AT:
    PROC
    LOCAL __RA_FIND, __RA_LOOP, __RA_FOUND, __RA_INS, __RA_L2, __RA_H2, __RA_DONE
    LOCAL __RA_PRI, __RA_NOEI
    or   a
    ret  z
    ld   (RI_TL), a
    ld   (RI_TH), hl
    ld   a, h
    or   l
    ret  z
    call __PL_ENSURE
    ret  nc
    call __PL_DI
    xor  a
    ld   (RI_NEW), a
    ld   a, (RI_N)
    or   a
    jr   nz, __RA_FIND
    ld   a, RI_FRAME_LINE   ; a fresh table: the frame entry alone
    ld   (RI_LINE), a
    ld   hl, 0
    ld   (RI_HAND), hl
    ld   a, 1
    ld   (RI_N), a
    ld   (RI_NEW), a
    xor  a
    ld   (RI_IDX), a
__RA_FIND:
    ld   a, (RI_N)
    ld   b, a               ; B = entries
    ld   c, 0               ; C = position
    ld   hl, RI_LINE
    ld   a, (RI_TL)
    ld   d, a
__RA_LOOP:
    ld   a, c
    cp   b
    jr   nc, __RA_INS       ; the end: append
    ld   a, (hl)
    cp   d
    jr   nc, __RA_FOUND     ; first entry at or after the line
    inc  hl
    inc  c
    jr   __RA_LOOP
__RA_FOUND:
    jr   nz, __RA_INS       ; a later line: insert before it
    ld   e, c               ; the same line: replace a user handler,
    ld   d, 0               ; or go in before the frame entry
    ld   hl, RI_HAND
    add  hl, de
    add  hl, de
    ld   a, (hl)
    inc  hl
    or   (hl)
    jr   z, __RA_INS
    ld   de, (RI_TH)
    ld   (hl), d
    dec  hl
    ld   (hl), e
    jp   __RA_DONE
__RA_INS:
    ld   a, (RI_N)
    cp   RI_MAX
    jp   nc, __RA_DONE
    ld   a, c
    ld   (RI_TP), a
    ld   a, (RI_N)          ; move LINE[p..N-1] up by one
    ld   e, a
    ld   d, 0
    ld   hl, RI_LINE
    add  hl, de
    ld   d, h
    ld   e, l
    dec  hl                 ; HL = last entry, DE = the slot after it
    ld   a, (RI_N)
    ld   b, a
    ld   a, (RI_TP)
    ld   c, a
    ld   a, b
    sub  c                  ; A = N - p
    jr   z, __RA_L2
    ld   c, a
    ld   b, 0
    lddr
__RA_L2:
    ld   a, (RI_TP)
    ld   e, a
    ld   d, 0
    ld   hl, RI_LINE
    add  hl, de
    ld   a, (RI_TL)
    ld   (hl), a
    ld   a, (RI_N)          ; move HAND[p..N-1] up by one entry
    add  a, a
    ld   e, a
    ld   d, 0
    ld   hl, RI_HAND
    add  hl, de             ; HL = HAND + 2N
    ld   d, h
    ld   e, l
    inc  de                 ; DE = HAND + 2N + 1
    dec  hl                 ; HL = HAND + 2N - 1
    ld   a, (RI_N)
    ld   b, a
    ld   a, (RI_TP)
    ld   c, a
    ld   a, b
    sub  c
    add  a, a               ; A = 2 * (N - p)
    jr   z, __RA_H2
    ld   c, a
    ld   b, 0
    lddr
__RA_H2:
    ld   a, (RI_TP)
    add  a, a
    ld   e, a
    ld   d, 0
    ld   hl, RI_HAND
    add  hl, de
    ld   de, (RI_TH)
    ld   (hl), e
    inc  hl
    ld   (hl), d
    ld   hl, RI_N
    inc  (hl)
    ld   a, (RI_NEW)
    or   a
    jp   nz, __RA_DONE      ; fresh: the first entry fires next
    ld   a, (RI_TP)         ; running: an entry inserted before the one
    ld   b, a               ; that fires next must not make it skip it
    ld   a, (RI_IDX)
    cp   b
    jp   c, __RA_DONE
    inc  a
    ld   (RI_IDX), a
__RA_DONE:
    ld   a, (RI_NEW)
    or   a
    jr   z, __RA_PRI
    call __RI_PRIIDX        ; switching on: PRI first,
    ld   a, (PLUS_IFF)
    or   a
    jr   z, __RA_NOEI
    push af                 ; then let a pending ordinary interrupt go to
    ei                      ; the ordinary handler (one instruction),
    nop
    di
    pop  af
    ld   (PLUS_IFF), a      ; (a frame hook may have used the library)
__RA_NOEI:
    ld   hl, __RI_ISR       ; then the raster handler takes over
    ld   ($0039), hl
    ld   hl, __RI_EXIT
    ld   (CPC_EXIT_VEC), hl
    jp   __PL_EI
__RA_PRI:
    call __RI_PRIIDX
    jp   __PL_EI
    ENDP

; __RI_OFF -- RasterIntOff: A = line: removes that user line (not the
; frame entry); raster mode ends when no user line is left.
; Registers clobbered: AF, BC, DE, HL.
__RI_OFF:
    PROC
    LOCAL __RO_LOOP, __RO_NEXT, __RO_FOUND, __RO_H, __RO_FIN, __RO_NOT, __RO_IDXOK, __RO_ON
    or   a
    ret  z
    ld   (RI_TL), a
    ld   a, (RI_N)
    or   a
    ret  z
    call __PL_DI
    ld   a, (RI_N)
    ld   b, a
    ld   c, 0
    ld   hl, RI_LINE
__RO_LOOP:
    ld   a, c
    cp   b
    jp   nc, __RO_NOT
    ld   a, (RI_TL)
    cp   (hl)
    jr   nz, __RO_NEXT
    ld   e, c               ; the line: a user entry or the frame entry?
    ld   d, 0
    ld   hl, RI_HAND
    add  hl, de
    add  hl, de
    ld   a, (hl)
    inc  hl
    or   (hl)
    jr   nz, __RO_FOUND
    jp   __RO_NOT           ; the frame entry only
__RO_NEXT:
    inc  hl
    inc  c
    jr   __RO_LOOP
__RO_FOUND:
    ld   a, c
    ld   (RI_TP), a
    ld   a, (RI_N)          ; LINE[p+1..N-1] down by one
    ld   hl, RI_TP
    sub  (hl)
    dec  a                  ; A = N - p - 1
    jr   z, __RO_H
    ld   c, a
    ld   b, 0
    ld   a, (RI_TP)
    ld   e, a
    ld   d, 0
    ld   hl, RI_LINE
    add  hl, de
    ld   d, h
    ld   e, l
    inc  hl
    ldir
    ld   a, (RI_N)          ; HAND likewise
    ld   hl, RI_TP
    sub  (hl)
    dec  a
    add  a, a
    ld   c, a
    ld   b, 0
    ld   a, (RI_TP)
    add  a, a
    ld   e, a
    ld   d, 0
    ld   hl, RI_HAND
    add  hl, de
    ld   d, h
    ld   e, l
    inc  hl
    inc  hl
    ldir
__RO_H:
    ld   hl, RI_N
    dec  (hl)
    ld   a, (RI_IDX)        ; the entry that fires next stays the same
    ld   hl, RI_TP
    cp   (hl)
    jr   c, __RO_IDXOK      ; before the removed one
    jr   z, __RO_IDXOK      ; the removed one: its successor moved here
    dec  a
__RO_IDXOK:
    ld   hl, RI_N
    cp   (hl)
    jr   c, __RO_ON
    xor  a                  ; past the end: the next frame's first
__RO_ON:
    ld   (RI_IDX), a
    ld   a, (RI_N)
    dec  a
    jr   z, __RO_FIN        ; only the frame entry left: raster mode off
    call __RI_PRIIDX
    jp   __RO_NOT
__RO_FIN:
    call __RI_STOP
__RO_NOT:
    jp   __PL_EI
    ENDP

RI_N:       defb 0          ; entries in the table, 0 = raster mode off
RI_IDX:     defb 0          ; the entry that fires next
RI_TL:      defb 0          ; scratch for RasterIntAt/Off (interrupts off)
RI_TP:      defb 0
RI_NEW:     defb 0
RI_TQ:      defb 0          ; scratch for RasterIntMove (interrupts off)
RI_MV:      defw 0          ; new line, old line
RI_TH:      defw 0
RI_LINE:    defs RI_MAX, 0
RI_HAND:    defs RI_MAX * 2, 0

    pop namespace

#endif
