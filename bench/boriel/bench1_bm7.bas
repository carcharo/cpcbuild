' Benchmark 1: BM7 (Rugg/Feldman), integer arithmetic + GOSUB + array
' fill. Ported from zxbasic/benchmarks/bm7a.bas; the Spectrum-specific
' POKE 23672 timing (frame counter) is dropped -- bench.py times this
' externally via the S/E markers below.
'
' S/E/DONE markers go straight to the printer via MC_PRINT_CHAR
' (&BD2B), through the firmware gate, bypassing PRINT/__PRINTCHAR and
' the -D __CPC_PRINTER_ECHO__ echo entirely -- see fwcall.asm. This
' benchmark's timed section does no screen output anyway, so echo
' would not distort it, but the same marker mechanism is used
' everywhere for consistency (see README.md).

DIM a, k, v, i As UInteger
DIM m(5) As UInteger

ASM
    jr PRNSTR_SKIP
PRNSTR:
    ld a,(hl)
    or a
    ret z
    push hl
    call .core.__FW_CALL
    defw $BD2B
    pop hl
    inc hl
    jr PRNSTR
PRNSTR_SKIP:
MSG_S: defb "S",10,0
MSG_E: defb "E",10,0
MSG_D: defb "DONE",10,0
END ASM

ASM
    ld hl, MSG_S
    call PRNSTR
END ASM

LET a = 0: LET k = 5: LET v = 0
100 LET a = a + 1
LET v = k / 2 * 3 + 4 - 5
GO SUB 1000
FOR i = 1 TO 5
  LET m(i) = a
NEXT i
IF a < 800 THEN GO TO 100

ASM
    ld hl, MSG_E
    call PRNSTR
END ASM

PRINT v
PRINT m(5)

ASM
    ld hl, MSG_D
    call PRNSTR
END ASM

STOP

1000 RETURN
