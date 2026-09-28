' Benchmark 2: integer loop -- sum/AND/compare, 1500 iterations.
' Note: Boriel's plain AND is a LOGICAL operator (like Sinclair BASIC's),
' not bitwise -- it returns 0/1. Bitwise AND is the separate `bAND`
' operator (docs/bitwiselogic.md); Locomotive's AND is bitwise natively.
' The mask is 8191 (not 32767): Locomotive's integer is 16-bit SIGNED
' and raises a runtime "Overflow" error the moment a plain add exceeds
' 32767. An earlier version masked with 32767, which only ever clears
' bit 15 -- a no-op for any s below 32768 -- so the running sum kept
' growing unmasked and Locomotive's copy silently hung around i=256,
' having stopped dead on an uncaught Overflow error with nothing left
' to send to the printer (Boriel's UInteger has no such trap and just
' wraps, so only the Locomotive side was affected). Masking with 8191
' keeps s+i always well under 32767 on both sides. See README.md.
DIM i, s As UInteger

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

LET s = 0
FOR i = 1 TO 1500
  LET s = s + i
  LET s = s bAND 8191
  IF s > 4096 THEN LET s = s - 1
NEXT i

ASM
    ld hl, MSG_E
    call PRNSTR
END ASM

PRINT s

ASM
    ld hl, MSG_D
    call PRNSTR
END ASM

END
