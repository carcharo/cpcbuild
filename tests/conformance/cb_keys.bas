REM BARE: skip checks the firmware key buffer (KM_READ_CHAR) through __FW_CALL
REM Conformance: cpcbuild keyboard (Phase 4c) -- direct matrix scan.
REM cpcrun.py types Q (with SHIFT, it is upper case) then RETURN, and a
REM second later Z then RETURN, into the running program (run.py reads the
REM lines below). The emulator holds each key down for only a frame or
REM two, so the program scans in a tight loop to catch it, for up to about
REM 10 seconds. Interrupts are on in compiled code (Phase 4d), so the
REM firmware's own scan runs alongside and its key buffer gets every key
REM too: the firmware's key buffer, read at the end with KM_READ_CHAR, must
REM hold Q, RETURN, Z, RETURN, which shows the firmware's keyboard still works
REM after thousands of direct scans. (INKEY$ itself is a direct matrix scan
REM now, see inkey.bas, so it is not what reads the buffer here.)
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

REM The next character of the firmware's key buffer (KM_READ_CHAR, &BB09),
REM or 0 if none.
FUNCTION FASTCALL FwKey() AS UBYTE
  ASM
  PROC
  LOCAL got
  call .core.__FW_CALL
  defw $BB09
  jr c, got
  xor a
got:
  ENDP
  END ASM
END FUNCTION

DIM frames AS UINTEGER
DIM seenQ, wWithQ, anyWithQ, shiftWithQ, seenRet, held AS UBYTE
DIM got$ AS STRING
DIM k AS UBYTE

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
  IF KeyDown(KEY_Q) THEN seenQ = 1
  frames = frames + 1
LOOP UNTIL seenQ = 1 OR frames >= 30000
REM The emulator's key press can land between two row reads of a scan
REM (SHIFT's row is read before Q's), so that first scan may show Q
REM without SHIFT. Keep scanning while Q is held and combine the scans.
held = 0
DO WHILE seenQ = 1 AND held < 40
  IF KeyDown(KEY_Q) THEN
    wWithQ = wWithQ bOR KeyDown(KEY_W)
    anyWithQ = anyWithQ bOR AnyKeyDown()
    shiftWithQ = shiftWithQ bOR KeyDown(KEY_SHIFT)
  END IF
  ScanKeys()
  held = held + 1
LOOP
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
REM interrupt-time scan saw every key, and its buffer holds them in order ---
got$ = ""
frames = 0
DO
  WaitRetrace(1)
  k = FwKey()
  IF k THEN got$ = got$ + CHR$(k)
  frames = frames + 1
LOOP UNTIL LEN(got$) >= 4 OR frames >= 500
CHK("firmware_buffer", got$, "Q" + CHR$ 13 + "Z" + CHR$ 13)
CHK("buffer_empty_now", STR$(FwKey()), "0")

REM --- direct scans between firmware calls don't upset it either ---
ScanKeys(): ScanKeys(): ScanKeys()
WaitRetrace(2)
PRINT "print_ok"
CHK("buffer_empty_after_scans", STR$(FwKey()), "0")

PAUSE 100
PRINT
PRINT results$; "DONE"
END
