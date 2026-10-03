REM Conformance: INPUT (the cpc input.bas) with the default INKEY$, in both
REM modes: firmware (firmware key buffer, KM_WAIT_CHAR) and bare-metal
REM (-D CPC_BAREMETAL: its own line editor on the keyboard matrix). cpcrun.py
REM types the lines below, each followed by RETURN (run.py reads them).
REM Held-key auto-repeat can't be tested: the emulators hold a typed key for
REM 2-3 frames only.
REM TYPE: HELLO
REM TYPE: ABCDE
REM TYPE: Hi1!
REM TYPE:

#include <input.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

DIM a$, b$, c$, d$ AS STRING

a$ = INPUT(10)
CHK("input_line", a$, "HELLO")

REM Only 3 characters are accepted; the rest are ignored until RETURN.
b$ = INPUT(3)
CHK("input_maxlen", b$, "ABC")

REM Lower case, a digit and a shifted symbol.
c$ = INPUT(10)
CHK("input_mixed", c$, "Hi1!")

REM Just RETURN: the empty string.
d$ = INPUT(10)
CHK("input_empty", d$, "")

REM Give cap32 time to process CAP32_WAITBREAK before END (see cpcrun.py).
PAUSE 100
PRINT
PRINT results$; "DONE"
END
