REM Text output for bare-metal tests that must not need PRINT: characters go
REM straight to the printer port through the runtime's .core.__CPC_PRN_CHAR
REM (bareboot.asm; A = character), which the harness captures like PRINT's
REM echo. Only for -D CPC_BAREMETAL builds.
REM
REM   BPutCh(c)              one character (10 = newline)
REM   BPrint(s)              a string, no newline
REM   BNum(v)                a signed decimal number (no strings, no heap)
REM   BLine(s)               a string and a newline
REM   BCHK(name, got, want)  "PASS name" / "FAIL name got=G want=W" (numbers)
REM   BRng(name, v, lo, hi)  PASS if lo <= v <= hi
REM   BDone()                "DONE" and a newline
REM   BState()               asks chipsrun for a state dump (see chipsrun.c);
REM                          then spin ~10 frames so the dump sees this state

#ifndef __CONFORMANCE_BAREOUT__
#define __CONFORMANCE_BAREOUT__

#include <framehook.bas>

#ifndef CPC_BAREMETAL
#error "bareout.bas is for -D CPC_BAREMETAL builds only"
#endif

SUB FASTCALL BPutCh(c AS UBYTE)
  ASM
  call .core.__CPC_PRN_CHAR
  END ASM
END SUB

SUB BPrint(s AS STRING)
  DIM i AS UINTEGER
  IF LEN(s) = 0 THEN RETURN
  FOR i = 0 TO LEN(s) - 1
    BPutCh(CODE(s(i TO i)))
  NEXT i
END SUB

SUB BLine(s AS STRING)
  BPrint(s)
  BPutCh(10)
END SUB

SUB BNum(v AS LONG)
  DIM u AS ULONG
  DIM d(10) AS UBYTE
  DIM n AS UBYTE
  IF v < 0 THEN
    BPutCh(45)
    u = CAST(ULONG, 0 - v)
  ELSE
    u = CAST(ULONG, v)
  END IF
  n = 0
  DO
    d(n) = CAST(UBYTE, u MOD 10)
    u = u / 10
    n = n + 1
  LOOP WHILE u > 0
  DO
    n = n - 1
    BPutCh(48 + d(n))
  LOOP WHILE n > 0
END SUB

SUB BCHK(name AS STRING, got AS LONG, want AS LONG)
  IF got = want THEN
    BPrint("PASS ")
    BLine(name)
  ELSE
    BPrint("FAIL ")
    BPrint(name)
    BPrint(" got=")
    BNum(got)
    BPrint(" want=")
    BNum(want)
    BPutCh(10)
  END IF
END SUB

SUB BRng(name AS STRING, v AS LONG, lo AS LONG, hi AS LONG)
  IF v >= lo AND v <= hi THEN
    BPrint("PASS ")
    BLine(name)
  ELSE
    BPrint("FAIL ")
    BPrint(name)
    BPrint(" got=")
    BNum(v)
    BPrint(" want=")
    BNum(lo)
    BPrint("..")
    BNum(hi)
    BPutCh(10)
  END IF
END SUB

SUB BDone()
  BLine("DONE")
END SUB

SUB BState()
  DIM t AS ULONG
  BPutCh(4)
  BPrint("STATE")
  BPutCh(10)
  t = Frames() + 10
  DO
  LOOP UNTIL Frames() >= t
END SUB

#endif
