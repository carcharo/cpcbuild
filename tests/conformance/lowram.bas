REM Conformance: the restart area &0000-&003F survives a run, whatever the
REM program's origin (build with --org 0x40 to put code right above it).
REM
REM It holds the firmware's restarts and RAM vectors; our runtime owns
REM &0030 (RST 6, FP calculator: jp) and &0038 (IM 1 vector: jp); the
REM firmware's ISR calls the external-interrupt vector at &003B. A copy is
REM taken first thing, then floats (RST 6), printing, PAUSE (interrupts)
REM and firmware calls run, and every byte must still match.

#include "lib/chk.bas"

DIM snap(63) AS UBYTE
DIM i AS UINTEGER
DIM bad AS UINTEGER
DIM f AS FLOAT

FOR i = 0 TO 63
  snap(i) = PEEK i
NEXT i

CHK("rst6_is_jp", STR$(PEEK 48), "195")
CHK("im1_is_jp", STR$(PEEK 56), "195")

f = 1.5
f = f * 3.25 + SQR(16.0)
CHK("float_works", STR$(f), "8.875")
PRINT "restart area test"
PAUSE 30
FOR i = 1 TO 20
  PRINT i;
NEXT i
PRINT
PAUSE 20

bad = 0
FOR i = 0 TO 63
  IF snap(i) <> PEEK i THEN
    PRINT "FAIL lowram_byte_"; i; " was="; snap(i); " now="; PEEK i
    bad = bad + 1
  END IF
NEXT i
CHK("lowram_unchanged", STR$(bad), "0")
PRINT "DONE"
END
