; -----------------------------------------------------------------------
; cpcbuild library -- the extra banks: range checks and the chunked copy
;
; Written from scratch for this project (MIT); see banks.asm (the hardware
; notes there apply). Used by BankCopyIn and BankCopyOut only; split off
; so that BankSelect, BankPeek and the rest don't carry it.

#include once <cpcbuild/banks.asm>

    push namespace core

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

    pop namespace
