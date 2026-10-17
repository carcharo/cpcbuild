; -----------------------------------------------------------------------
; cpcplus library -- 12-bit palette on the ASIC (the sprites are in plusspr.asm)
;
; Written from scratch for this project (MIT); see plus.asm for the ASIC
; page layout, the unlock, the paging rules and the trampoline. Every
; routine here starts with __PL_ENSURE (probe, unlock) and does nothing,
; changing nothing, on a CPC without ASIC. The ASIC page is touched only
; through plus.asm's __PL_POKE / __PL_PEEK / __PL_PUT, which
; run the paging code from the private block, so the program (and this
; library) may be anywhere in memory, &4000-&7FFF included; data that lies
; in &4000-&7FFF is bounced through a buffer. Registers and interrupts as
; documented there.

#include once <cpcplus/plus.asm>

    push namespace core

; ---- the firmware's ink refresh ---------------------------------------------

; __PL_FWDETACH -- firmware mode: stops the firmware rewriting the Gate Array
; inks. The firmware (6128 and Plus alike: same code at &0D42-&0D98 of the
; lower ROM, checked in cpc6128.rom and Caprice32's system.cpr) runs a
; ticker event (block at &B7F9, routine &0D61, chain head &B8B9) that every
; 10 frames, flashing inks or not, writes all 17 inks from its tables to the
; Gate Array, and the Plus ASIC turns each write into a 12-bit palette
; entry, overwriting what SetPalette12 put there within 0.2 s (measured on
; Caprice32 and, as Gate Array writes, with a chipsrun trace). The same
; ticker is started again by SCR_SET_MODE (Mode()), whose reset of the inks
; the program then has to redo anyway. So every palette write for a pen or
; the border takes the block out of the ticker chain first, by hand, the
; way KL DEL TICKER (&BCEC, lower ROM &0388) does, but with interrupts off
; and no firmware call (the firmware's own routine, and the gate, turn
; interrupts on: wrong from a frame hook). Effects: flashing inks stop
; flashing (they keep whichever colour they have), the firmware's ink table
; stays as it was, and a later firmware or SetInk/SetPalette ink change is
; shown by the library's own direct Gate Array write as before. Guard: the
; block's routine address (&B7FF) must be &0D61, else some other firmware
; and nothing is done. Does nothing when the block isn't chained (already
; detached). Bare mode: no firmware, no refresh, nothing to do.
; Hardware: none (RAM only). Registers clobbered: none.
__PL_FWDETACH:
#ifdef CPC_BAREMETAL
    ret
#else
    PROC
    LOCAL __FD_LOOP, __FD_NEXT, __FD_FOUND, __FD_DONE, __FD_GO, __FD_EXIT
    ld   a, ($B7F9)         ; the block's link is &FFFF while it is detached (set
    inc  a                  ; below; KL ADD TICKER, which Mode() runs, overwrites
    jr   nz, __FD_GO        ; it with the chain head): nothing to do, 9 bytes, no DI
    ld   a, ($B7FA)
    inc  a
    ret  z
__FD_GO:
    push af
    push bc
    push de
    push hl
    ld   hl, ($B7FF)
    ld   de, $0D61
    or   a
    sbc  hl, de
    jr   nz, __FD_DONE
    call __PL_DI
    ld   hl, $B8B9          ; address of a "next" link, starting at the head
    ld   de, $B7F9          ; the flash ticker's block
__FD_LOOP:
    ld   a, (hl)
    cp   e
    inc  hl
    ld   a, (hl)            ; A = high byte of the link
    dec  hl
    jr   nz, __FD_NEXT
    cp   d
    jr   z, __FD_FOUND
__FD_NEXT:
    or   a
    jr   z, __FD_EXIT       ; end of the chain: not there
    ld   l, (hl)
    ld   h, a
    jr   __FD_LOOP
__FD_FOUND:
    ld   a, (de)            ; HL = the link that points at the block:
    ld   (hl), a            ; make it point where the block pointed
    inc  de
    inc  hl
    ld   a, (de)
    ld   (hl), a
    ld   hl, $B7F9          ; and mark the block detached: link &FFFF
    ld   a, $FF
    ld   (hl), a
    inc  hl
    ld   (hl), a
__FD_EXIT:
    call __PL_EI
__FD_DONE:
    pop  hl
    pop  de
    pop  bc
    pop  af
    ret
    ENDP
#endif

; ---- palette --------------------------------------------------------------

; __PL_SETCOL -- A = palette entry (0-15 pens, 16 border, 17-31 sprite
; colours 1-15; above 31 ignored), HL = &0RGB: red bits 11-8, green 7-4,
; blue 3-0 (the bits above 11 are ignored). Writes the two palette bytes
; at &6400 + 2 * entry (even byte red << 4 | blue, odd byte green) in ONE
; window (PLW2: interrupts off for about 100 T-states). The fast path (the
; library unlocked and the program not holding the page: PLUS_FAST) does no
; ENSURE; everything else (first call, no ASIC, PlusPageIn in force) takes
; __PL_SETCOL_SLOW, the general routine. Pens and border also detach the
; firmware's ink refresh (firmware mode, 48 T-states once it has been).
; Hardware: ASIC palette RAM, RMR2. Registers clobbered: AF, BC, DE, HL.
__PL_SETCOL:
    PROC
    LOCAL __SC_GO, __SC_SLOW, __SC_CONV
#ifndef CPC_BAREMETAL
    LOCAL __SC_DET
#endif
    cp   32
    ret  nc
    ld   c, a               ; C = entry
    ld   a, (PLUS_FAST)
    or   a
    jr   z, __SC_SLOW
#ifndef CPC_BAREMETAL
    ld   a, c
    cp   17
    jr   nc, __SC_GO
    ld   a, ($B7F9)         ; __PL_FWDETACH's "already detached" test, inline
    inc  a
    jr   nz, __SC_DET
    ld   a, ($B7FA)
    inc  a
    jr   nz, __SC_DET
#endif
__SC_GO:
    ld   a, h               ; __PL_RGB2HW inline (27 T-states saved)
    rrca
    rrca
    rrca
    rrca
    and  $F0
    ld   d, a
    ld   a, l
    and  $0F
    or   d
    ld   e, a
    ld   a, l
    rrca
    rrca
    rrca
    rrca
    and  $0F
    ld   d, a
    ld   a, c
    add  a, a
    ld   l, a
    ld   h, $64
    jp   PLW2
#ifndef CPC_BAREMETAL
__SC_DET:
    push hl
    push bc
    call __PL_FWDETACH
    pop  bc
    pop  hl
    jr   __SC_GO
#endif
__SC_SLOW:                  ; first call, no ASIC, or PlusPageIn in force
    push hl
    push bc
    call __PL_ENSURE
    pop  bc
    pop  hl
    ret  nc
#ifndef CPC_BAREMETAL
    ld   a, c
    cp   17
    jr   nc, __SC_CONV
    push hl
    push bc
    call __PL_FWDETACH
    pop  bc
    pop  hl
#endif
__SC_CONV:
    call __PL_RGB2HW
    ld   a, (PLUS_USER)
    or   a
    jp   z, PLW2
    ld   (hl), e            ; the program holds the page: plain stores
    inc  hl
    ld   (hl), d
    ret
    ENDP

; __PL_RGB2HW -- C = palette entry (0-31), HL = &0RGB -> E = red << 4 |
; blue, D = green, HL = &6400 + 2 * entry (the palette bytes as the ASIC
; holds them, and where). Registers clobbered: AF, DE, HL.
__PL_RGB2HW:
    ld   a, h
    rrca
    rrca
    rrca
    rrca
    and  $F0
    ld   d, a
    ld   a, l
    and  $0F
    or   d
    ld   e, a
    ld   a, l
    rrca
    rrca
    rrca
    rrca
    and  $0F
    ld   d, a
    ld   a, c
    add  a, a
    ld   l, a
    ld   h, $64
    ret

; __PL_GETCOL -- A = entry (0-31, else 0 is returned) -> HL = &0RGB as the
; ASIC returns it (the palette RAM is readable on Caprice32 and CPCEC; a
; real ASIC is expected to match, not verified on hardware). No ASIC: 0.
; Registers clobbered: AF, BC, DE, HL.
__PL_GETCOL:
    PROC
    LOCAL __GC_NO
    ld   hl, 0
    cp   32
    ret  nc
    ld   d, a
    call __PL_ENSURE2
    jr   nc, __GC_NO
    ld   a, d
    add  a, a
    ld   l, a
    ld   h, $64
    call __PL_PEEK
    push af                 ; red << 4 | blue
    inc  hl
    call __PL_PEEK
    ld   c, a               ; green
    pop  af
    ld   b, a
    ld   a, b
    rrca
    rrca
    rrca
    rrca
    and  $0F
    ld   h, a               ; red
    ld   a, c
    and  $0F
    rlca
    rlca
    rlca
    rlca
    ld   l, a               ; green << 4
    ld   a, b
    and  $0F
    or   l
    ld   l, a               ; green << 4 | blue
    ret
__GC_NO:
    ld   hl, 0
    ret
    ENDP

; __PL_PALBLOCK -- HL = source (palette bytes as img2cpc.py makes them: 2
; per entry), D = first entry, E = count: copies to the palette RAM from
; entry D; count is cut at entry 32; a first entry above 31 or a count of
; 0 does nothing. The source may be anywhere (see __PL_PUT).
; Hardware: ASIC palette RAM, RMR2. Window of interrupts off: at most 64
; bytes. Registers clobbered: AF, BC, DE, HL.
__PL_PALBLOCK:
    PROC
    LOCAL __PB_OK
    ld   a, d
    cp   32
    ret  nc
    ld   a, 32
    sub  d                  ; room = 32 - first
    cp   e
    jr   nc, __PB_OK
    ld   e, a               ; count = room
__PB_OK:
    ld   a, e
    or   a
    ret  z
    call __PL_ENSURE2
    ret  nc
    ld   a, d
    cp   17
    call c, __PL_FWDETACH
    ld   a, e
    add  a, a
    ld   c, a
    ld   b, 0               ; BC = 2 * count
    ld   a, d
    add  a, a
    ld   e, a
    ld   d, $64             ; DE = &6400 + 2 * first
    jp   __PL_PUT
    ENDP

    pop namespace
