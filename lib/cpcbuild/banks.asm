; -----------------------------------------------------------------------
; cpcbuild library -- the 6128's extra 64 KB (four 16 KB banks)
;
; Written from scratch for this project (MIT), from public documentation
; of the Gate Array's RAM configuration (cpcwiki.eu) and checked against
; the 6128 firmware ROM (see notes.md, 2026-10-03, Phase 5c D4).
;
; Hardware. A write to the Gate Array (port &7Fxx) with bits 7-6 = 11 sets
; the RAM configuration (&C0 + n):
;   &C0       normal: main RAM only
;   &C4..&C7  extra bank 0..3 appears at &4000-&7FFF (everything else
;             stays); this is all the library ever uses
;   &C1..&C3  other layouts (they move &C000 or the whole map); never used
; The configuration is write-only, so the library keeps a shadow byte,
; CBK_CFG, the one source of truth for "what is paged in now". The CRTC
; only displays main RAM; while a bank is in, reads and writes of
; &4000-&7FFF go to the bank (so nothing may draw into the back screen).
;
; Firmware. The 6128 firmware writes the RAM configuration in two places
; only: its reset code (&C0, at &062D of the lower ROM) and KL BANK SWITCH
; (&BD5B, which stores A in its own record at &B8D5 and writes &C0 + A).
; Nothing in the 6128 firmware or AMSDOS ROM calls KL BANK SWITCH, no
; interrupt handler touches the Gate Array's RAM configuration, and the
; record at &B8D5 is read only by KL BANK SWITCH itself. So the library
; writes the Gate Array directly (the firmware's gate would turn
; interrupts on, which the frame hook may not do) and leaves &B8D5 alone.
; A program that calls KL BANK SWITCH itself breaks the shadow.
;
; Where things must be. While a bank is in, &4000-&7FFF is the bank, so
; code, data, the heap, the stack and the AMSDOS buffer must all be
; outside it: the compiler reserves the range for any program that uses
; the library (CbReserve4000), code and data end below &4000, the heap is
; above &8000, the stack is at &A200-&A5FF. The library's own routines
; are in the program image, below &4000.
;
; 464 and 664 have no extra RAM: CPC_INIT_BANKS finds out at start-up
; (CBK_PRESENT), and every routine below does nothing (copies and loads
; report failure) when it is 0.
;
; Interrupts. The shadow and the Gate Array change together under DI.
; The frame hook (the music player) pages its own bank in and puts the
; shadow back, so a bank the main program selected survives it. Copies
; run in chunks of at most 256 bytes (5376 T-states, 1.3 ms, of DI each,
; against 13300 T between two interrupts), so the interrupt latency never
; exceeds one chunk and no interrupt is lost.

#include once <fwcall.asm>
#include once <mem/alloc.asm>
#include once <mem/free.asm>

#init .core.CPC_INIT_BANKS

    push namespace core

; CPC_INIT_BANKS -- start-up: finds out whether extra RAM exists. Writes
; the complement of the byte at &4000 into extra bank 0 and looks whether
; main RAM at &4000 kept its value (it does only when the write went to a
; bank), then whether the write sticks in the bank; every byte it touches is
; put back. Runs with interrupts off, leaves them on (compiled code
; always has them on).
; Firmware entries called: none. Registers clobbered: AF, BC, DE, HL.
CPC_INIT_BANKS:
    PROC
    LOCAL __CIB_ABSENT, __CIB_DONE
    di
    ld   hl, $4000
    ld   d, (hl)            ; D = main RAM's byte
    ld   bc, $7FC4
    out  (c), c             ; extra bank 0 in (a 464/664 ignores this)
    ld   e, (hl)            ; E = bank 0's byte (or main's, no extra RAM)
    ld   a, d
    cpl
    ld   (hl), a            ; the complement
    ld   c, $C0
    out  (c), c             ; main RAM back
    ld   a, (hl)
    cp   d
    jr   nz, __CIB_ABSENT   ; the write went to main RAM: no extra RAM
    ld   c, $C4
    out  (c), c
    ld   a, (hl)
    cpl
    cp   d                  ; Z: it stuck in the bank
    ld   (hl), e            ; bank 0's byte restored
    ld   c, $C0
    out  (c), c
    jr   nz, __CIB_DONE
    ld   a, 1
    ld   (CBK_PRESENT), a
    jr   __CIB_DONE
__CIB_ABSENT:
    ld   (hl), d            ; main RAM's byte restored
__CIB_DONE:
    ei
    ret
    ENDP

; __BK_SETCFG -- A = $C0 (normal) or $C4-$C7: pages it in, shadow and Gate
; Array together, under DI (returns with interrupts on). No-op without
; extra RAM.
; Firmware entries called: none. Registers clobbered: AF, BC.
__BK_SETCFG:
    ld   c, a
    ld   a, (CBK_PRESENT)
    or   a
    ret  z
    ld   a, c
    ld   b, $7F
    di
    ld   (CBK_CFG), a
    out  (c), a
    ei
    ret

; __BK_SELECT -- A = bank 0-3: that bank in at &4000-&7FFF; any other
; value (BankSelect(255)): main RAM. No-op without extra RAM.
; Registers clobbered: AF, BC.
__BK_SELECT:
    cp   4
    jr   nc, __BK_SELECT_OFF
    or   $C4
    jr   __BK_SETCFG
__BK_SELECT_OFF:
    ld   a, $C0
    jr   __BK_SETCFG

; __BK_INWIN -- HL = start, BC = length (> 0): carry set if the whole
; range lies in &4000-&7FFF. Registers clobbered: AF, BC, HL.
__BK_INWIN:
    ld   a, h
    cp   $40
    jr   c, __BK_NO
    cp   $80
    jr   nc, __BK_NO
    dec  bc
    add  hl, bc             ; HL = last byte
    jr   c, __BK_NO
    bit  7, h
    jr   nz, __BK_NO
    scf
    ret
__BK_NO:
    or   a                  ; carry clear
    ret

; __BK_OUTWIN -- HL = start, BC = length (> 0): carry set if the range
; wraps past &FFFF nowhere and doesn't touch &4000-&7FFF. Registers
; clobbered: AF, BC, HL.
__BK_OUTWIN:
    bit  7, h
    jr   z, __BK_OUT_LOW
    dec  bc                 ; start >= &8000: fine unless it wraps
    add  hl, bc
    ccf
    ret                     ; carry set when no overflow
__BK_OUT_LOW:
    dec  bc
    add  hl, bc             ; HL = last byte
    jr   c, __BK_NO
    ld   a, h
    cp   $40
    ret                     ; carry set when last byte < &4000

; __BK_COPY -- A = bank configuration ($C4-$C7), HL = source, DE =
; destination, BC = length (> 0). One side of the copy is in the bank
; window (the caller has checked both ranges). Copies in chunks of at
; most 256 bytes; each chunk pages the bank in, LDIRs, and puts the
; shadow configuration back, all with interrupts off.
; Firmware entries called: none.
; Registers clobbered: AF, BC, DE, HL, and the alternate bank.
__BK_COPY:
    PROC
    LOCAL __BKC_NEXT, __BKC_TAIL, __BKC_DOIT, __BKC_END
    exx
    ld   e, a               ; E' = the bank's configuration
    ld   b, $7F             ; B' = Gate Array port
    exx
    push bc
    exx
    pop  hl                 ; H' = whole chunks left, L' = bytes after them
    exx
__BKC_NEXT:
    exx
    ld   a, h
    or   a
    jr   z, __BKC_TAIL
    dec  h
    exx
    ld   bc, 256
    jr   __BKC_DOIT
__BKC_TAIL:
    ld   a, l
    or   a
    jr   z, __BKC_END
    ld   l, 0
    exx
    ld   c, a
    ld   b, 0
__BKC_DOIT:
    di
    exx
    ld   c, e
    out  (c), c             ; the bank in
    exx
    ldir
    ld   a, (CBK_CFG)
    exx
    ld   c, a
    out  (c), c             ; what the program had in before
    exx
    ei
    jr   __BKC_NEXT
__BKC_END:
    exx
    ret
    ENDP

; Library state, in the program image.
CBK_PRESENT:    defb 0      ; 1 once start-up found the extra 64 KB
CBK_CFG:        defb $C0    ; shadow: the RAM configuration in force
CBK_LBUF:       defw 0      ; BankLoad: heap block (name and 2 KB buffer)
CBK_LLEN:       defb 0      ; BankLoad: name length
CBK_LPREV:      defb 0      ; BankLoad: configuration to restore
CBK_LRES:       defb 0      ; BankLoad: result

    pop namespace
