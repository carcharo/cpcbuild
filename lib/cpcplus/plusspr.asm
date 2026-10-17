; -----------------------------------------------------------------------
; cpcplus library -- hardware sprites on the ASIC (split from plusgfx.asm,
; so a program that only sets 12-bit colours does not link the sprite code)
;
; Written from scratch for this project (MIT); see plus.asm for the ASIC
; page layout, the unlock, the paging rules and the trampoline, and
; plusgfx.asm for the palette routines and the conventions shared here.
; -----------------------------------------------------------------------

#include once <cpcplus/plus.asm>

    push namespace core

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
