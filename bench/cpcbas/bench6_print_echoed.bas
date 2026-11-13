' Benchmark 6 (correctness-check build only -- see bench6_print_clean.bas
' for the timed build). Compiled WITH -D __CPC_PRINTER_ECHO__, so the
' 600 PRINT statements in the timed loop are ALSO mirrored to the
' printer (MC_PRINT_CHAR, once per character via __PRN_ECHO). That
' doubles the firmware calls the loop makes and distorts the timing
' (see README.md) -- this build's S..E interval is NOT used for the
' reported speed-up, only its printed checksum is compared against the
' Locomotive BASIC result to confirm both ran the same algorithm.
DIM i, sum As UInteger

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

LET sum = 0
FOR i = 1 TO 600
  PRINT i;" ";
  LET sum = (sum + i) MOD 10000
NEXT i

ASM
    ld hl, MSG_E
    call PRNSTR
END ASM

PRINT sum

ASM
    ld hl, MSG_D
    call PRNSTR
END ASM

END
