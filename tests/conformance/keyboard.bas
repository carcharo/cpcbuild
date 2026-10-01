REM Conformance: Phase 4a keyboard input (INPUT from the cpc input.bas,
REM INKEY$). cpcrun.py types the keys below while the program runs, each
REM after a delay and followed by RETURN (run.py reads these lines):
REM TYPE: HELLO
REM TYPE: ABCDE
REM TYPE: Q

#include <input.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

DIM a$, b$, k$, k2$ AS STRING

a$ = INPUT(10)
CHK("input_line", a$, "HELLO")

REM Only 3 characters are accepted; the rest are ignored until RETURN.
b$ = INPUT(3)
CHK("input_maxlen", b$, "ABC")

REM INKEY$ returns each buffered key once: Q, then the RETURN after it.
DO
  k$ = INKEY$
LOOP UNTIL k$ <> ""
CHK("inkey_key", k$, "Q")
DO
  k2$ = INKEY$
LOOP UNTIL k2$ <> ""
CHK("inkey_return", STR$(CODE k2$), "13")
CHK("inkey_then_empty", STR$(LEN(INKEY$)), "0")

REM Give cap32 time to process CAP32_WAITBREAK before END (see cpcrun.py).
PAUSE 100
PRINT
PRINT results$; "DONE"
END
