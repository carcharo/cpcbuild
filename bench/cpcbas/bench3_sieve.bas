' Benchmark 3: Sieve of Eratosthenes, primes below 2000.
DIM i, j, count As UInteger
DIM isComposite(2000) As UByte

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

LET count = 0
FOR i = 2 TO 1999
  IF isComposite(i) = 0 THEN
    LET count = count + 1
    LET j = i + i
    WHILE j <= 1999
      LET isComposite(j) = 1
      LET j = j + i
    WEND
  END IF
NEXT i

ASM
    ld hl, MSG_E
    call PRNSTR
END ASM

PRINT count

ASM
    ld hl, MSG_D
    call PRNSTR
END ASM

END
