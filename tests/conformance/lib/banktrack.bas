REM Shared helpers for the bank-music conformance tests (banks.bas,
REM banks_disc.bas): record what the sound chip does, tick by tick, while a
REM song plays from main RAM, then compare other runs (the same song from a
REM bank) with it. Needs cpc.bas, framehook.bas and music.bas.
REM
REM Fold() condenses AY registers 0-10 (periods, noise, mixer, volumes) into
REM one UINTEGER. refs(n) = Fold() after tick n of the reference run (tick 1
REM is the first the player plays after MusicInit). Track* compare a run
REM against refs: tBad = ticks whose state differs, tMissed = ticks not
REM seen, tSeen = ticks compared. In auto mode (frame hook) Frames() is the
REM clock; in manual mode the loop makes the tick itself.

#ifndef __CONFORMANCE_BANKTRACK__
#define __CONFORMANCE_BANKTRACK__

DIM refs(130) AS UINTEGER
DIM f0 AS ULONG
DIM tBad, tMissed, tSeen, tFirstBad AS UINTEGER
DIM tLast AS UINTEGER

FUNCTION Fold() AS UINTEGER
  DIM r AS UINTEGER
  DIM k AS UBYTE
  r = 0
  FOR k = 0 TO 10
    r = r * 31 + AyRead(k)
  NEXT k
  RETURN r
END FUNCTION

REM Waits for the next frame the hook runs.
SUB NextFrame()
  DIM f AS ULONG
  f = Frames()
  DO
  LOOP UNTIL Frames() <> f
END SUB

REM Starts the main-RAM song just after a hook run (no frame inside the
REM start-up): position 0 = f0.
SUB StartMain()
  DIM ok AS UBYTE
  DO
    NextFrame()
    f0 = Frames()
    MusicInit(@bank_tune_main, 0)
    ok = (Frames() = f0)
  LOOP UNTIL ok
END SUB

SUB StartBank(addr AS UINTEGER, bank AS UBYTE)
  DIM ok AS UBYTE
  DO
    NextFrame()
    f0 = Frames()
    MusicInitBank(addr, 0, bank)
    ok = (Frames() = f0)
  LOOP UNTIL ok
END SUB

SUB TrackReset()
  tBad = 0: tMissed = 0: tSeen = 0: tFirstBad = 0: tLast = 0
END SUB

REM One compared (or, with record <> 0, recorded) tick n.
SUB TrackTick(n AS UINTEGER, h AS UINTEGER, record AS UBYTE)
  IF record <> 0 THEN
    refs(n) = h
  ELSE
    IF refs(n) <> h THEN
      tBad = tBad + 1
      IF tFirstBad = 0 THEN tFirstBad = n
    END IF
  END IF
  IF n > tLast + 1 THEN tMissed = tMissed + (n - tLast - 1)
  tLast = n
  tSeen = tSeen + 1
END SUB

REM Auto mode: ticks from tLast+1 up to n, read as they happen. If
REM walk <> 0 the main program selects bank (tick MOD 4) after each one.
SUB Track(n AS UINTEGER, record AS UBYTE, walk AS UBYTE)
  DIM fa, fb AS ULONG
  DIM h, sn AS UINTEGER
  DO
    DO
      fa = Frames()
      h = Fold()
      fb = Frames()
    LOOP UNTIL fa = fb
    sn = CAST(UINTEGER, fa - f0)
    IF sn > tLast AND sn <= n THEN
      TrackTick(sn, h, record)
      IF walk <> 0 THEN BankSelect(CAST(UBYTE, sn BAND 3))
    END IF
  LOOP UNTIL sn >= n
END SUB

REM Manual mode (MusicAuto = 0): the loop plays tick k after each frame.
SUB TrackManual(n AS UINTEGER, record AS UBYTE, walk AS UBYTE)
  DIM k AS UINTEGER
  FOR k = 1 TO n
    NextFrame()
    MusicFrame()
    TrackTick(k, Fold(), record)
    IF walk <> 0 THEN BankSelect(CAST(UBYTE, k BAND 3))
  NEXT k
END SUB

SUB TrackReport(name AS STRING)
  PRINT "INFO "; name; " seen="; tSeen; " bad="; tBad; " missed="; tMissed; " firstbad="; tFirstBad
  IF tBad <> 0 OR tMissed <> 0 OR tSeen = 0 THEN
    PRINT "FAIL "; name; " got=bad "; tBad; " missed "; tMissed; " seen "; tSeen; " want=0 0 >0"
  ELSE
    PRINT "PASS "; name
  END IF
END SUB

#endif
