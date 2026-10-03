REM Conformance: interrupt-driven music (MusicAuto = 1, the default):
REM lib/music/music.bas on the runtime's frame hook (framehook.bas).
REM
REM The song is soft123 (see music.bas's test): note starts on frames 1, 49,
REM 91, 127 and 157, periods 239, 213, 190, 179, 159, volume 15 falling by
REM 1 a frame to 0 on the 16th frame of a note, period register 0 while
REM silent. With the hook nothing calls MusicFrame: the player ticks once
REM per frame at the flyback, with interrupts off. The test reads the song
REM state (AY registers 0, 1, 8) together with Frames() -- Frames() counts
REM the frames the hook has run, and a read of it with interrupts off can't
REM fall inside a hook run -- and checks that state = song position
REM n = Frames() - Frames() at MusicInit, whatever the program was doing:
REM busy loops, PRINT, firmware waits, in normal and in game mode.

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/display.bas>
#include <music/music.bas>
#include "lib/chk.bas"
#include "assets/music/soft123.bas"
#include "assets/music/softhard.bas"
#include "assets/music/sfx.bas"

REM KL TIME PLEASE (&BD0D): DEHL = the 300 Hz clock (stopped in game mode).
FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

REM The frame hook slot, and a hook of our own that counts.
FUNCTION FASTCALL HookAddr() AS UINTEGER
  ASM
  ld hl, (.core.FH_ADDR)
  END ASM
END FUNCTION

FUNCTION FASTCALL MyAddr() AS UINTEGER
  ASM
  ld hl, MY_HOOK
  jp MY_SKIP
MY_HOOK:
  push hl
  ld hl, (MY_COUNT)
  inc hl
  ld (MY_COUNT), hl
  pop hl
  ret
MY_COUNT:
  defw 0
MY_SKIP:
  END ASM
END FUNCTION

FUNCTION FASTCALL MyCount() AS UINTEGER
  ASM
  ld hl, (MY_COUNT)
  END ASM
END FUNCTION

DIM f0 AS ULONG
DIM sn AS UINTEGER
DIM sper, svol AS UINTEGER

REM Song state expected at position n (frames since MusicInit).
FUNCTION ExpPer(n AS UINTEGER) AS UINTEGER
  DIM s, p AS UINTEGER
  s = 1: p = 239
  IF n >= 49 THEN s = 49: p = 213
  IF n >= 91 THEN s = 91: p = 190
  IF n >= 127 THEN s = 127: p = 179
  IF n >= 157 THEN s = 157: p = 159
  IF n - s >= 15 THEN RETURN 0
  RETURN p
END FUNCTION

FUNCTION ExpVol(n AS UINTEGER) AS UINTEGER
  DIM s AS UINTEGER
  s = 1
  IF n >= 49 THEN s = 49
  IF n >= 91 THEN s = 91
  IF n >= 127 THEN s = 127
  IF n >= 157 THEN s = 157
  IF n - s >= 15 THEN RETURN 0
  RETURN 16 - (n - s + 1)
END FUNCTION

REM A consistent snapshot: sn = position, sper/svol = what the AY holds for
REM channel A. Retried if a hook run fell in between.
SUB Sample()
  DIM fa, fb AS ULONG
  DO
    fa = Frames()
    sper = CAST(UINTEGER, AyRead(1) BAND 15) * 256 + AyRead(0)
    svol = AyRead(8)
    fb = Frames()
  LOOP UNTIL fa = fb
  sn = CAST(UINTEGER, fa - f0)
END SUB

REM Waits for the next frame the hook runs.
SUB NextFrame()
  DIM f AS ULONG
  f = Frames()
  DO
  LOOP UNTIL Frames() <> f
END SUB

REM Starts the song just after a hook run, so that no frame falls inside
REM the start-up (position 0 = f0).
SUB Start(song AS UINTEGER)
  DIM ok AS UBYTE
  DO
    NextFrame()
    f0 = Frames()
    MusicInit(song, 0)
    ok = (Frames() = f0)
  LOOP UNTIL ok
END SUB

REM Checks state = song position now; name tags the activity.
SUB Track(name AS STRING)
  Sample()
  CHK(name, STR$(sper) + " " + STR$(svol), STR$(ExpPer(sn)) + " " + STR$(ExpVol(sn)))
END SUB

REM Wait n ticks of the firmware clock (normal mode only); 1 if it ran.
FUNCTION Wait(n AS UINTEGER) AS UBYTE
  DIM t0 AS ULONG
  DIM guard AS UINTEGER
  t0 = Ticks()
  guard = 0
  DO
    guard = guard + 1
    IF guard > 20000 THEN RETURN 0
  LOOP UNTIL Ticks() - t0 >= n
  RETURN 1
END FUNCTION

DIM ok, c AS UBYTE
DIM i, j, n AS UINTEGER
DIM seen(180) AS UBYTE

CHK("default_auto", STR$(MusicAuto), "1")
CHK("no_hook_before", STR$(HookAddr()), "0")

REM ---------------- one tick per frame, nothing else running ----------------
REM Sample every frame by polling Frames(): each position 1..170 seen once,
REM with exactly the state the song has there.
FOR i = 0 TO 180
  seen(i) = 0
NEXT i
c = 1
Start(@soft123)
DO
  Sample()
  IF sn >= 1 AND sn <= 170 THEN
    seen(sn) = seen(sn) + 1
    IF sper <> ExpPer(sn) OR svol <> ExpVol(sn) THEN
      c = 0
      PRINT "FAIL_DETAIL pos="; sn; " per="; sper; " vol="; svol
    END IF
  END IF
LOOP UNTIL sn >= 171
CHK("hooked", STR$(HookAddr() <> 0), "1")
CHK("every_frame_state_right", STR$(c), "1")
c = 1
FOR i = 1 TO 170
  IF seen(i) = 0 THEN c = 0: PRINT "FAIL_DETAIL missed "; i
NEXT i
CHK("no_frame_missed", STR$(c), "1")
MusicStop()

REM ---------------- keeps playing through busy work ----------------
Start(@soft123)
REM a BASIC busy loop (about 15 frames, interrupts on)
FOR i = 1 TO 4000
  j = (j + i) BAND 255
NEXT i
Track("busy_basic")
NextFrame()
Track("busy_basic_next_frame")
REM firmware waits: WaitRetrace is a firmware call
WaitRetrace(3)
Track("waitretrace")
REM PRINT (firmware text output, hook runs from the firmware's event)
MusicStop()
Start(@soft123)
FOR i = 1 TO 3
  PRINT "................................................................................"
NEXT i
Track("print")
MusicStop()

REM ---------------- MusicFrame is a no-op while hooked ----------------
Start(@soft123)
NextFrame()
FOR i = 1 TO 6
  MusicFrame()
NEXT i
Track("musicframe_noop_when_hooked")
MusicFrame()
MusicFrame()
NextFrame()
Track("musicframe_noop_next_frame")
MusicStop()

REM ---------------- MusicStop: silences and unhooks ----------------
Start(@soft123)
WaitRetrace(3)
MusicStop()
CHK("stop_unhooks", STR$(HookAddr()), "0")
CHK("stop_silent", STR$(AyRead(8) + AyRead(9) + AyRead(10)), "0")
CHK("stop_mixer", STR$(AyRead(7)), "63")
WaitRetrace(4)
CHK("stop_stays_silent", STR$(AyRead(8) + AyRead(9) + AyRead(10)), "0")
MusicStop()
CHK("stop_twice_ok", STR$(HookAddr()), "0")
REM restart after a stop
Start(@soft123)
WaitRetrace(2)
Track("restart_after_stop")
MusicStop()

REM MusicStop leaves a hook that isn't the music's alone
Start(@soft123)
FrameHook(MyAddr())
MusicStop()
CHK("foreign_hook_kept", STR$(HookAddr() = MyAddr()), "1")
n = MyCount()
WaitRetrace(5)
CHK("foreign_hook_runs", STR$(MyCount() - n >= 4), "1")
FrameHookOff()

REM ---------------- manual mode still works (MusicAuto = 0) ----------------
MusicAuto = 0
MusicInit(@soft123, 0)
CHK("manual_not_hooked", STR$(HookAddr()), "0")
WaitRetrace(3)
CHK("manual_no_tick_by_itself", STR$(AyRead(8)), "0")
WaitRetrace(1)
MusicFrame()
CHK("manual_first_tick", STR$(AyRead(0)) + " " + STR$(AyRead(8)), "239 15")
MusicStop()
MusicAuto = 1

REM ---------------- sound effects over hooked music ----------------
SfxInit(@sfx)
Start(@soft123)
DO
  Sample()
LOOP UNTIL sn >= 20
REM the song is silent from frame 16 to 48
SfxPlay(1, 1, 0)
NextFrame()
CHK("sfx_B", STR$(AyRead(2)) + " " + STR$(AyRead(9)) + " " + STR$(AyRead(6)), "95 15 1")
SfxStop(1)
NextFrame()
CHK("sfx_stopped", STR$(AyRead(9)), "0")
REM over a sounding note: start again, effect on C at inverted volume 3
Start(@soft123)
SfxPlay(2, 2, 3)
NextFrame()
Sample()
CHK("sfx_over_music", STR$(sper > 0) + " " + STR$(CAST(UINTEGER, AyRead(5) BAND 15) * 256 + AyRead(4)) + " " + STR$(AyRead(10)), "1 301 12")
SfxStop(2)
MusicStop()

REM ---------------- game mode ----------------
GameMode(1)
FOR i = 0 TO 180
  seen(i) = 0
NEXT i
c = 1
Start(@soft123)
DO
  Sample()
  IF sn >= 1 AND sn <= 170 THEN
    seen(sn) = seen(sn) + 1
    IF sper <> ExpPer(sn) OR svol <> ExpVol(sn) THEN
      c = 0
      PRINT "FAIL_DETAIL game pos="; sn; " per="; sper; " vol="; svol
    END IF
  END IF
LOOP UNTIL sn >= 171
CHK("game_every_frame_state_right", STR$(c), "1")
c = 1
FOR i = 1 TO 170
  IF seen(i) = 0 THEN c = 0
NEXT i
CHK("game_no_frame_missed", STR$(c), "1")
MusicStop()
Start(@soft123)
FOR i = 1 TO 4000
  j = (j + i) BAND 255
NEXT i
Track("game_busy_basic")
WaitRetrace(3)
Track("game_waitretrace")
FOR i = 1 TO 2
  PRINT "................................................................................"
NEXT i
Track("game_print")
REM effects in game mode
MusicStop()
Start(@soft123)
DO
  Sample()
LOOP UNTIL sn >= 20
SfxPlay(1, 0, 0)
NextFrame()
CHK("game_sfx_A", STR$(AyRead(0)) + " " + STR$(AyRead(8)), "95 15")
SfxStop(0)
MusicStop()
CHK("game_stop_unhooks", STR$(HookAddr()), "0")
CHK("game_stop_silent", STR$(AyRead(8) + AyRead(9) + AyRead(10)), "0")
GameMode(0)
CHK("game_off_clock_runs", STR$(Wait(10)), "1")

REM ---------------- stress: init/stop churn and effects at random moments ----------------
REM Interrupts land at random points of MusicInit/MusicStop/SfxPlay (the
REM busy loops have random lengths): the player must never run half
REM initialised, the hook must end up off, and nothing may crash.
DIM seed AS UINTEGER = 4321
DIM bad AS UBYTE = 0
FOR i = 1 TO 150
  seed = seed * 75 + 74
  MusicInit(@softhard, 0)
  FOR j = 1 TO (seed >> 6) BAND 511
  NEXT j
  SfxPlay(1 + (seed >> 8) MOD 5, (seed >> 4) MOD 3, 0)
  FOR j = 1 TO (seed >> 3) BAND 255
  NEXT j
  IF AyRead(8) > 16 OR AyRead(9) > 16 OR AyRead(10) > 16 THEN bad = 1
  IF (seed BAND 1) = 0 THEN
    MusicStop()
    IF HookAddr() <> 0 THEN bad = 1
  END IF
NEXT i
CHK("churn_sane", STR$(bad), "0")
MusicStop()
CHK("churn_end_unhooked", STR$(HookAddr()), "0")
CHK("churn_end_silent", STR$(AyRead(8) + AyRead(9) + AyRead(10)), "0")
CHK("churn_alive", STR$(Wait(10)), "1")

REM 1500 frames of hooked softhard with effects thrown in from the main loop
MusicInit(@softhard, 0)
bad = 0
f0 = Frames()
FOR i = 1 TO 1500
  NextFrame()
  IF (i BAND 7) = 0 THEN
    seed = seed * 75 + 74
    SfxPlay(1 + (seed >> 8) MOD 5, (seed >> 4) MOD 3, (seed >> 11) BAND 7)
  END IF
  IF AyRead(8) > 16 OR AyRead(9) > 16 OR AyRead(10) > 16 THEN bad = 1
  IF (i BAND 15) = 0 THEN SfxStop(i MOD 3)
NEXT i
CHK("stress_regs_sane", STR$(bad), "0")
PRINT "INFO stress frames="; Frames() - f0
CHK("stress_frames_counted", STR$(Frames() - f0 >= 1500 AND Frames() - f0 <= 1520), "1")
MusicStop()
CHK("stress_stop_silent", STR$(AyRead(8) + AyRead(9) + AyRead(10)), "0")
CHK("stress_alive", STR$(Wait(10)), "1")

PRINT "DONE"
