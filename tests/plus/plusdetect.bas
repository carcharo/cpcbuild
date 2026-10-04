REM Plus identity check: --model plus must really be a 6128 Plus. Unlock the
REM ASIC (17-byte sequence through the CRTC register-select port &BCxx), page
REM its register area in at &4000 (RMR2 &B8) and look at &4000, which is
REM sprite 0's pixel RAM there (only its low nibble is stored) and ordinary
REM RAM on a CPC without ASIC; then page it out (RMR2 &A0) and re-lock.
REM MODELS: plus
REM (a 6128 does not survive this program: it resets without the END marker)
#include <cpc.bas>

DIM seen AS UBYTE
DIM plain AS UBYTE

POKE 16384, $5A
plain = PEEK(16384)

ASM
    di
    ld bc, $BC00
    ld hl, plusdetect_seq
    ld d, 17
plusdetect_unlock:
    ld a, (hl)
    out (c), a
    inc hl
    dec d
    jr nz, plusdetect_unlock
    jr plusdetect_go
plusdetect_seq:
    defb $FF, $00, $FF, $77, $B3, $51, $A8, $D4, $62, $39, $9C, $46, $2B, $15, $8A, $CD, $EE
plusdetect_go:
    ld a, $B8
    ld bc, $7F00
    out (c), a
    ld a, ($4000)
    ld (._seen), a
    ld a, $A0
    out (c), a
    ei
END ASM

IF plain = $5A THEN PRINT "PASS ram_poke": ELSE PRINT "FAIL ram_poke got="; plain
IF seen <> $5A THEN PRINT "PASS asic_paged_in": ELSE PRINT "FAIL asic_paged_in got="; seen
PRINT "DONE"
