REM Conformance: GOTO/GOSUB/ON GOTO/ON GOSUB, DO/WHILE/UNTIL loop
REM variants. Expected values computed by hand.

#include "lib/chk.bas"

REM ---- GOTO ----
DIM trail$ AS STRING
trail$ = ""
trail$ = trail$ + "A"
GOTO lblGotoTarget
trail$ = trail$ + "SKIPPED"
lblGotoTarget:
trail$ = trail$ + "B"
CHK("goto_skips", trail$, "AB")

REM ---- GOSUB/RETURN ----
DIM gscount AS UByte
gscount = 0
GOSUB lblSub1
GOSUB lblSub1
CHK("gosub_twice", STR$(gscount), "2")
GOTO lblAfterSubs
lblSub1:
gscount = gscount + 1
RETURN
lblAfterSubs:

REM ---- ON ... GOTO ----
REM ON ... GOTO/GOSUB index from 0 (docs/on_goto.md): 0 = first label;
REM an index >= the number of labels falls through.
DIM og AS UByte
DIM ogResult$ AS STRING
ogResult$ = ""
FOR og = 0 TO 3
  ON og GOTO lblOg1, lblOg2, lblOg3
  ogResult$ = ogResult$ + "?"
  GOTO lblOgNext
  lblOg1:
  ogResult$ = ogResult$ + "1"
  GOTO lblOgNext
  lblOg2:
  ogResult$ = ogResult$ + "2"
  GOTO lblOgNext
  lblOg3:
  ogResult$ = ogResult$ + "3"
  lblOgNext:
NEXT og
CHK("on_goto", ogResult$, "123?")

REM ---- ON ... GOSUB ----
DIM osResult$ AS STRING
osResult$ = ""
ON 1 GOSUB lblOs1, lblOs2, lblOs3
CHK("on_gosub", osResult$, "S2")
GOTO lblOsDone
lblOs1:
osResult$ = osResult$ + "S1"
RETURN
lblOs2:
osResult$ = osResult$ + "S2"
RETURN
lblOs3:
osResult$ = osResult$ + "S3"
RETURN
lblOsDone:

REM ---- DO WHILE ... LOOP (test at top: may run 0 times) ----
DIM w1 AS UByte
DIM wsum AS UInteger
w1 = 0
wsum = 0
DO WHILE w1 < 5
  wsum = wsum + w1
  w1 = w1 + 1
LOOP
CHK("do_while_sum", STR$(wsum), "10")

DIM w2 AS UByte
DIM wran AS UByte
w2 = 10
wran = 0
DO WHILE w2 < 5
  wran = wran + 1
  w2 = w2 + 1
LOOP
CHK("do_while_zero_runs", STR$(wran), "0")

REM ---- DO ... LOOP UNTIL (test at bottom: always runs >=1 time) ----
DIM u1 AS UByte
DIM usum AS UInteger
u1 = 0
usum = 0
DO
  usum = usum + u1
  u1 = u1 + 1
LOOP UNTIL u1 >= 5
CHK("do_until_sum", STR$(usum), "10")

DIM u2 AS UByte
DIM uran AS UByte
u2 = 10
uran = 0
DO
  uran = uran + 1
  u2 = u2 + 1
LOOP UNTIL u2 >= 5
CHK("do_until_runs_once", STR$(uran), "1")

REM ---- WHILE ... END WHILE ----
DIM ww AS UByte
DIM wwsum AS UInteger
ww = 0
wwsum = 0
WHILE ww < 4
  wwsum = wwsum + ww
  ww = ww + 1
END WHILE
CHK("while_endwhile_sum", STR$(wwsum), "6")

PRINT "DONE"
END
