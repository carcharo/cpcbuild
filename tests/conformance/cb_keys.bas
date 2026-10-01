REM Conformance: cpcbuild keyboard (Phase 4c) -- direct matrix scan.
REM cpcrun.py types Q (with SHIFT, it is upper case) then RETURN, and a
REM second later Z then RETURN, into the running program (run.py reads the
REM lines below). The emulator presses each key only for a moment, and its
REM key is gone once the Z80 has read it, so the program scans in a tight
REM loop with interrupts off (as compiled code runs) to catch it, for up to
REM about 10 seconds. The firmware's own scan never runs during that loop,
REM so Q and its RETURN do not reach the firmware's key buffer; Z, typed
REM after the loop, does: that shows the firmware still works afterwards.
REM TYPE: Q
REM TYPE: Z

#include <cpcbuild/display.bas>
#include <cpcbuild/keyboard.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

DIM frames AS UINTEGER
DIM seenQ, wWithQ, anyWithQ, shiftWithQ, seenRet AS UBYTE
DIM got$, k$ AS STRING

REM --- nothing typed yet: the first scan sees an idle keyboard ---
ScanKeys()
CHK("idle_any", STR$(AnyKeyDown()), "0")
CHK("idle_space", STR$(KeyDown(KEY_SPACE)), "0")
CHK("out_of_range", STR$(KeyDown(200)), "0")
CHK("key_numbers", STR$(KEY_Q) + " " + STR$(KEY_W) + " " + STR$(KEY_RETURN) + " " + STR$(JOY_FIRE1), "67 59 18 76")

REM --- wait for Q (up to ~10 s of scans) ---
seenQ = 0
frames = 0
DO
  ScanKeys()
  IF KeyDown(KEY_Q) THEN
    seenQ = 1
    wWithQ = KeyDown(KEY_W)
    anyWithQ = AnyKeyDown()
    shiftWithQ = KeyDown(KEY_SHIFT)
  END IF
  frames = frames + 1
LOOP UNTIL seenQ = 1 OR frames >= 30000
CHK("q_seen", STR$(seenQ), "1")
CHK("w_not_with_q", STR$(wWithQ), "0")
CHK("any_with_q", STR$(anyWithQ), "1")
CHK("shift_with_q", STR$(shiftWithQ), "1")

REM --- then RETURN, typed right after Q ---
frames = 0
seenRet = 0
DO
  ScanKeys()
  IF KeyDown(KEY_RETURN) THEN seenRet = 1
  frames = frames + 1
LOOP UNTIL seenRet = 1 OR frames >= 3000
CHK("return_seen", STR$(seenRet), "1")

REM --- released again ---
FOR frames = 1 TO 200
  ScanKeys()
NEXT frames
CHK("released_any", STR$(AnyKeyDown()), "0")
CHK("released_q", STR$(KeyDown(KEY_Q)), "0")

REM --- the firmware still works after thousands of direct scans: its
REM interrupt (on during WaitRetrace) now sees Z, and INKEY$ returns it ---
got$ = ""
frames = 0
DO
  WaitRetrace(1)
  got$ = got$ + INKEY$
  frames = frames + 1
LOOP UNTIL LEN(got$) >= 2 OR frames >= 500
CHK("firmware_inkey", got$, "Z" + CHR$ 13)
CHK("inkey_empty_now", STR$(LEN(INKEY$)), "0")

REM --- direct scans between firmware calls don't upset it either ---
ScanKeys(): ScanKeys(): ScanKeys()
WaitRetrace(2)
PRINT "print_ok"
CHK("inkey_after_scans", STR$(LEN(INKEY$)), "0")

PAUSE 100
PRINT
PRINT results$; "DONE"
END
