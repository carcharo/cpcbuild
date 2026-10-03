REM Dumps the firmware's key translation tables (firmware mode only; run it
REM with tools/cpcrun.py on a 464 or 6128): one line per key 0-79 with, for
REM each of the normal, SHIFT and CONTROL tables, "raw:char" -- the table
REM entry as KM_GET_TRANSLATE (&BB2A) / KM_GET_SHIFT (&BB30) / KM_GET_CONTROL
REM (&BB36) return it, and the character __CPC_KEYCHAR makes of it (999 = no
REM character; keypad expansion tokens become the first character of their
REM string). The source of the tables in runtime io/keyboard/kbare.asm and of
REM the EXPECTED data in tests/conformance/keytables.bas (255 = no character
REM and the raw 253/254 for the CAPS LOCK key).
FUNCTION FASTCALL Raw(v AS UINTEGER) AS UINTEGER
  ASM
  ld a, l
  bit 1, h
  jr nz, ctl
  bit 0, h
  jr nz, shf
  call .core.__FW_CALL
  defw $BB2A
  jr dn
shf:
  call .core.__FW_CALL
  defw $BB30
  jr dn
ctl:
  call .core.__FW_CALL
  defw $BB36
dn:
  ld l, a
  ld h, 0
  END ASM
END FUNCTION
FUNCTION FASTCALL Xl(v AS UINTEGER) AS UINTEGER
  ASM
  PROC
  LOCAL none, done
  ld b, l
  ld e, h
  call .core.__CPC_KEYCHAR
  jr nc, none
  ld l, a
  ld h, 0
  jr done
none:
  ld hl, 999
done:
  ENDP
  END ASM
END FUNCTION
DIM k, m AS UINTEGER
DIM q$ AS STRING
q$ = INKEY$
IF LEN(q$) > 5 THEN PRINT q$
FOR k = 0 TO 79
  PRINT k;
  FOR m = 0 TO 2
    PRINT " ";Raw(k + 256 * m);":";Xl(k + 256 * m);
  NEXT m
  PRINT
NEXT k
