' Benchmark 5: strings -- build/append/LEN/clear, 2000 iterations.
DIM i, total As UInteger
DIM s As STRING

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

LET total = 0
FOR i = 1 TO 2000
  LET s = ""
  LET s = s + "ab"
  LET s = s + "cd"
  LET total = total + LEN(s)
NEXT i

ASM
    ld hl, MSG_E
    call PRNSTR
END ASM

PRINT total

ASM
    ld hl, MSG_D
    call PRNSTR
END ASM

END
