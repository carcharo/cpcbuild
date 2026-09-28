' Benchmark 6 (timed build -- see bench6_print_echoed.bas for the
' correctness-check build). Compiled WITHOUT __CPC_PRINTER_ECHO__: the
' 600 PRINT statements in the loop go to the screen only, exactly as
' they would in a normal (non-benchmark) program, so the firmware-call
' cost matches what Locomotive BASIC's own PRINT pays. S/E/DONE still
' reach the printer because they go through MC_PRINT_CHAR directly,
' bypassing __PRINTCHAR (and therefore the echo mechanism) entirely --
' see fwcall.asm and README.md. No checksum is printed here (it would
' not reach the printer without echo); correctness for this benchmark
' is verified by bench6_print_echoed.bas's build instead.
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

ASM
    ld hl, MSG_D
    call PRNSTR
END ASM

END
