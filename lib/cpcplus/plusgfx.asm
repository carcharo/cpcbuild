; -----------------------------------------------------------------------
; cpcplus library -- 12-bit palette and hardware sprites on the ASIC
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

; ---- sprites --------------------------------------------------------------

; __PL_SPRBASE -- A = sprite (masked to 0-15) -> HL = &6000 + 8 * sprite.
; Registers clobbered: AF.
__PL_SPRBASE:
    and  $0F
    add  a, a
    add  a, a
    add  a, a
    ld   l, a
    ld   h, $60
    ret

; __PL_IMG -- A = sprite, HL = source of 256 bytes (one pixel per byte,
; 0 = transparent; the ASIC keeps the low nibble); the source may be
; anywhere (in &4000-&7FFF it is bounced, 64 bytes per window; elsewhere one
; window of 5.4k T-states with interrupts off).
; Hardware: sprite pixel RAM, RMR2. Registers clobbered: AF, BC, DE, HL.
__PL_IMG:
    ld   d, a
    call __PL_ENSURE2
    ret  nc
    ld   a, d
    and  $0F
    or   $40
    ld   d, a
    ld   e, 0               ; DE = &4000 + 256 * sprite
    ld   bc, 256
    jp   __PL_PUT

; __PL_IMGP -- A = sprite, HL = source of 128 bytes, two pixels each, the
; left pixel in the high nibble (img2cpc.py --packed). The source may be
; anywhere: the 256 unpacked pixels are built on the stack (interrupts as the
; caller had them, about 11k T-states) and go into the ASIC in ONE window of
; 1.5 ms (the stack needs about 270 bytes free). While the program holds the
; page (PlusPageIn) the same, with a plain LDIR instead of the window.
; Hardware: sprite pixel RAM, RMR2. Registers clobbered: AF, BC, DE, HL.
__PL_IMGP:
    PROC
    LOCAL __IP_UN, __IP_WIN, __IP_DONE
    ld   d, a
    call __PL_ENSURE2
    ret  nc
    ld   a, d
    and  $0F
    or   $40
    ld   d, a
    ld   e, 0
    push de                 ; the destination: the buffer grows below it
    ld   de, 127
    add  hl, de             ; HL = the last source byte
    ld   b, 64              ; two bytes (four pixels) a turn, from the end: each
__IP_UN:                    ; PUSH writes a pixel pair, the left pixel (the byte's
    ld   a, (hl)            ; high nibble) at the lower address. An interrupt
    dec  hl                 ; pushes below SP, where the pairs are still to come.
    ld   e, a
    and  $0F
    ld   d, a
    ld   a, e
    rrca
    rrca
    rrca
    rrca
    and  $0F
    ld   e, a
    push de
    ld   a, (hl)
    dec  hl
    ld   e, a
    and  $0F
    ld   d, a
    ld   a, e
    rrca
    rrca
    rrca
    rrca
    and  $0F
    ld   e, a
    push de
    djnz __IP_UN
    ld   hl, 256
    add  hl, sp
    ld   e, (hl)
    inc  hl
    ld   d, (hl)            ; DE = the destination
    ld   hl, 0
    add  hl, sp             ; HL = the buffer
    ld   bc, 256
    ld   a, (PLUS_USER)
    or   a
    jr   z, __IP_WIN
    ldir                    ; the program holds the page: interrupts are off already
    jr   __IP_DONE
__IP_WIN:
    call __PL_DI
    call PLX
    call __PL_EI
__IP_DONE:
    ld   hl, 258
    add  hl, sp
    ld   sp, hl
    ret
    ENDP

; __PL_CLAMP -- HL = value, DE = limit + 256 (X 1023, Y 511): HL clamped
; to -256 .. limit. Registers clobbered: AF, BC, HL.
__PL_CLAMP:
    PROC
    LOCAL __CL_OUT, __CL_HIGH
    push hl
    ld   bc, 256
    add  hl, bc
    or   a
    sbc  hl, de             ; carry: value + 256 < limit + 256
    pop  hl
    ret  c
    ret  z
__CL_OUT:
    bit  7, h
    jr   z, __CL_HIGH
    ld   hl, $FF00          ; -256
    ret
__CL_HIGH:
    ex   de, hl
    ld   bc, 256
    or   a
    sbc  hl, bc             ; limit
    ret
    ENDP

; __PL_MOVE -- sprite position. Parameters on the stack frame of the BASIC
; wrapper: IX+5 sprite, IX+6/7 X, IX+8/9 Y (SpriteMove). X is clamped to
; -256..767, Y to -256..255, and both written as 16-bit values (hi bytes
; sign-extended: what Caprice32 and CPCEC both read), the four bytes in one
; window (the block is built on the stack, above SP, and copied from there).
; Hardware: sprite registers &6000+8n, RMR2. Registers clobbered: AF, BC,
; DE, HL (and the clamp's).
; __PL_MOVE -- sprite position. Parameters on the stack frame of the BASIC
; wrapper: IX+5 sprite, IX+6/7 X, IX+8/9 Y (SpriteMove). X is clamped to
; -256..767, Y to -256..255, and both written as 16-bit values (hi bytes
; sign-extended: what Caprice32 and CPCEC both read), the four bytes in one
; window. The common case, all four in range, the library unlocked and the
; page not held by the program (PLUS_FAST), copies the frame's own four
; bytes (X lo, X hi, Y lo, Y hi are consecutive in the frame, IX+6..9)
; with PLW4: in range means X's high byte is &FF, 0, 1 or 2 and Y's is &FF
; or 0 (a 16-bit value then already is its own sign extension). Anything
; else takes __PL_MOVE_SLOW, which clamps.
; Hardware: sprite registers &6000+8n, RMR2. Registers clobbered: AF, BC,
; DE, HL.
__PL_MOVE:
    PROC
    LOCAL __MV_SLOW
    ld   a, (PLUS_FAST)
    or   a
    jr   z, __MV_SLOW
    ld   a, (ix+7)
    inc  a
    cp   4
    jr   nc, __MV_SLOW
    ld   a, (ix+9)
    inc  a
    cp   2
    jr   nc, __MV_SLOW
    ld   a, (ix+5)
    and  $0F
    add  a, a
    add  a, a
    add  a, a
    ld   e, a
    ld   d, $60             ; DE = the sprite's registers
    push ix
    pop  hl
    ld   bc, 6
    add  hl, bc             ; HL = IX + 6: X lo, X hi, Y lo, Y hi
    jp   PLW4               ; (the frame is the program's stack: outside the window)
__MV_SLOW:
    ENDP
    ; falls into the general routine

; __PL_MOVE_SLOW -- the general routine behind __PL_MOVE (same parameters):
; ENSURE, clamping, the block built on the stack and copied from there.
__PL_MOVE_SLOW:
    call __PL_ENSURE2
    ret  nc
    ld   l, (ix+8)
    ld   h, (ix+9)
    ld   de, 511
    call __PL_CLAMP
    push hl                 ; Y
    ld   l, (ix+6)
    ld   h, (ix+7)
    ld   de, 1023
    call __PL_CLAMP
    push hl                 ; X: the block X lo, X hi, Y lo, Y hi is at SP
    ld   a, (ix+5)
    call __PL_SPRBASE
    ex   de, hl             ; DE = register block
    ld   hl, 0
    add  hl, sp             ; HL = the block
    ld   bc, 4
    call __PL_PUT           ; (pushes below SP: the block is above it)
    pop  hl
    pop  hl
    ret


; __PL_MOVEBLK -- SpriteMoveBlock. A = first sprite (masked to 0-15), C =
; count (cut to 16 - first; 0 does nothing), HL = table: 4 bytes a sprite,
; X lo, X hi, Y lo, Y hi (two INTEGERs, as DIM t(n) AS INTEGER holds them,
; x then y), copied to the first four registers of sprites first..first +
; count - 1 in ONE window (about 92 T-states a sprite, plus the window). The
; values are NOT clamped (the ASIC keeps its own 10 and 9 low bits: x
; -256..767, y -256..255 are what it takes, others wrap): use SpriteMove
; for a value that might be out of range. A table that touches
; &4000-&7FFF, or PlusPageIn in force, takes a slower way: one __PL_PUT (its
; own window, bounced if need be) per sprite.
; Hardware: sprite registers, RMR2. Registers clobbered: AF, BC, DE, HL.
__PL_MOVEBLK:
    PROC
    LOCAL __MB_OK, __MB_SLOW, __MB_LOOP
    and  $0F
    ld   b, a               ; B = first
    ld   a, 16
    sub  b                  ; A = room
    cp   c
    jr   nc, __MB_OK
    ld   c, a               ; count = room
__MB_OK:
    ld   a, c
    or   a
    ret  z
    ld   a, b
    add  a, a
    add  a, a
    add  a, a
    ld   e, a               ; E = low byte of the registers' address: 8 * first
    ld   d, c               ; D = count
    call __PL_ENSURE2       ; (BC, DE, HL kept)
    ret  nc
    ld   a, (PLUS_USER)
    or   a
    jr   nz, __MB_SLOW
    ld   a, h               ; the table must not touch &4000-&7FFF (readable while
    cp   $80                ; the page is in): first >= &8000 is the quick yes
    jp   nc, PLWM
    push hl
    ld   a, d
    add  a, a
    add  a, a               ; 4 * count (at most 64)
    ld   c, a
    ld   b, 0
    add  hl, bc
    dec  hl                 ; the last byte
    ld   a, h
    pop  hl
    cp   $40
    jp   c, PLWM            ; last < &4000
__MB_SLOW:                  ; table in the window, or PlusPageIn in force:
    ld   b, d               ; one record at a time through __PL_PUT
    ld   d, $60
__MB_LOOP:
    push bc
    push de
    ld   bc, 4
    call __PL_PUT           ; (HL advances by 4)
    pop  de
    ld   a, e
    add  a, 8
    ld   e, a
    pop  bc
    djnz __MB_LOOP
    ret
    ENDP

; __PL_MAGREG -- A = sprite, E = magnification register value: written to
; &6004 + 8n (0 hides the sprite). Registers clobbered: AF, BC, DE, HL.
__PL_MAGREG:
    ld   d, a
    call __PL_ENSURE2
    ret  nc
    ld   a, d
    call __PL_SPRBASE
    ld   bc, 4
    add  hl, bc
    ld   a, e
    jp   __PL_POKE

; __PL_MAGCODE -- A = 0, 1, 2 or 4 (anything above 2 means 4) -> A = the
; hardware code 0-3. Registers clobbered: AF.
__PL_MAGCODE:
    cp   3
    ret  c
    ld   a, 3
    ret

; __PL_HIDEALL -- magnification 0 for all 16 sprites, one window of about
; 100 T-states each. Registers clobbered: AF, BC, DE, HL.
__PL_HIDEALL:
    PROC
    LOCAL __HA_LOOP
    call __PL_ENSURE2
    ret  nc
    ld   hl, $6004
    ld   e, 16
__HA_LOOP:
    xor  a
    call __PL_POKE          ; AF, BC, D
    ld   a, l
    add  a, 8
    ld   l, a
    dec  e
    jr   nz, __HA_LOOP
    ret
    ENDP

    pop namespace
