' Benchmark 4: float maths, 200 iterations of x = SQR(i)*SIN(i) + i/3.
DIM i As FLOAT
DIM x, chk As FLOAT

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

LET chk = 0
FOR i = 1 TO 200
  LET x = SQR(i) * SIN(i) + i / 3
  LET chk = chk + x
NEXT i

ASM
    ld hl, MSG_E
    call PRNSTR
END ASM

PRINT chk

ASM
    ld hl, MSG_D
    call PRNSTR
END ASM

END
