REM Conformance: a program written for zx48k's keys.bas, compiled unchanged
REM for the CPC. It uses only the zx48k library's API and constant names
REM (GetKey, MultiKeys, GetKeyScanCode, KEYQ, KEYENTER, KEYSPACE, KEYCAPS,
REM KEYSYMBOL); the values behind the names differ per machine. The same
REM source compiles with --arch zx48k (checked by hand). cpcrun.py types the keys below, each followed by RETURN; the
REM emulator holds a key for only a few frames, so the program polls.
REM TYPE: q
REM TYPE: m

#include <keys.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

DIM n AS UINTEGER
DIM held, other, enter, orv AS UBYTE
DIM sc AS UINTEGER
DIM k AS UBYTE

REM nothing held
CHK("idle_multikeys", STR$(MultiKeys(KEYQ)), "0")
CHK("idle_scancode", STR$(GetKeyScanCode()), "0")

REM Q held
n = 0
DO
  n = n + 1
LOOP UNTIL MultiKeys(KEYQ) OR n > 30000
held = MultiKeys(KEYQ) <> 0
sc = GetKeyScanCode()
other = MultiKeys(KEYW)
orv = MultiKeys(KEYQ bOR KEYQ) <> 0
CHK("q_held", STR$(held), "1")
CHK("q_other_key_not_held", STR$(other), "0")
CHK("q_scancode", STR$(sc = KEYQ), "1")
CHK("q_or_same", STR$(orv), "1")

REM then RETURN
n = 0
DO
  n = n + 1
LOOP UNTIL MultiKeys(KEYENTER) OR n > 3000
enter = MultiKeys(KEYENTER) <> 0
CHK("enter_held", STR$(enter), "1")

REM wait until RETURN is released, or GetKey would return it
n = 0
DO
  n = n + 1
LOOP UNTIL MultiKeys(KEYENTER) = 0 OR n > 3000

REM GetKey waits for M and returns its character code
k = GetKey()
CHK("getkey_m", STR$(k), STR$(CODE "m"))

REM constants are distinct and usable
CHK("constants_distinct", STR$(KEYQ <> KEYW AND KEYENTER <> KEYSPACE AND KEYCAPS <> KEYSYMBOL AND KEYQ <> KEYCAPS), "1")

REM Give cap32 time to process CAP32_WAITBREAK before END (see cpcrun.py).
PAUSE 100
PRINT
PRINT results$; "DONE"
END
