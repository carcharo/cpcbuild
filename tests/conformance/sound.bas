REM Conformance: non-blocking firmware sound on the CPC (zxbasic
REM runtime/fwsound.asm, stdlib/cpc.bas: SoundQueue, SoundFree,
REM SoundBusy, SoundEnvelope, SoundStop).
REM The firmware's sound manager plays from the 300 Hz interrupt
REM handler, so what is checked is behaviour: that SoundQueue returns at
REM once (timed with KL TIME PLEASE, &BD0D), the queue counts, and what
REM the AY chip holds while notes play (read back with AyRead: tone
REM period regs 0-5, volume regs 8-10). No audio check is possible (the
REM emulator can't record sound). Period = 62500 / frequency, as BEEP.

#include <cpc.bas>
#include "lib/chk.bas"

REM KL TIME PLEASE (&BD0D): DEHL = the 300 Hz clock.
FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

REM Wait n ticks (1/300 s) of the clock.
SUB Wait(n AS UINTEGER)
  DIM t0 AS ULONG
  t0 = Ticks()
  DO
  LOOP UNTIL Ticks() - t0 >= n
END SUB

REM Tone period of channel ch (0-2) as the AY holds it.
FUNCTION Per(ch AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, AyRead(ch * 2 + 1) BAND 15) * 256 + AyRead(ch * 2)
END FUNCTION

REM Volume of channel ch (0-2).
FUNCTION Vol(ch AS UBYTE) AS UBYTE
  RETURN AyRead(8 + ch) BAND 15
END FUNCTION

REM The volume the AY holds for a note's start volume v with no volume
REM envelope. 664/6128: v. 464 (firmware 1.0): its volumes are 0-7, doubled
REM into the AY's 0-15, and SoundQueue passes min(7, (v + 1) / 2), so the
REM AY gets the even volume nearest v. With an envelope all models use v
REM as 0-15. The 464 is told by its firmware's interrupt handler address
REM (&B939; &B941 on the 664/6128), as SoundQueue does.
FUNCTION FASTCALL FwIsrAddr() AS UINTEGER
  ASM
  ld hl, (.core.__CPC_ISR_ORIG + 1)
  END ASM
END FUNCTION
DIM is464 AS UBYTE
FUNCTION Want(v AS UBYTE) AS UBYTE
  DIM h AS UBYTE
  IF is464 THEN
    h = (v + 1) >> 1
    IF h > 7 THEN h = 7
    RETURN h * 2
  END IF
  RETURN v
END FUNCTION

DIM decay(2) AS UBYTE = {15, 255, 10}     REM 15 steps of -1, 0.1 s each
DIM two(5) AS UBYTE = {5, 254, 5, 5, 2, 5} REM 5 x -2 then 5 x +2, 0.05 s
DIM seq(7) AS UINTEGER
DIM i, n, r, ok, prev, v AS UBYTE
DIM t0, t1 AS ULONG
DIM p, last AS UINTEGER

REM ---------------- idle ----------------
is464 = (FwIsrAddr() = $B939)
PRINT "INFO is464="; is464
CHK("idle_free_A", STR$(SoundFree(1)), "4")
CHK("idle_free_B", STR$(SoundFree(2)), "4")
CHK("idle_free_C", STR$(SoundFree(4)), "4")
CHK("idle_busy", STR$(SoundBusy(1) + SoundBusy(2) + SoundBusy(4)), "0")

REM ---------------- BEEP before ----------------
t0 = Ticks()
BEEP 0.2, 0
t1 = Ticks()
CHK("beep_before_waits", STR$((t1 - t0) >= 55 AND (t1 - t0) <= 75), "1")
CHK("beep_before_idle", STR$(SoundBusy(1)), "0")

REM ---------------- returns at once ----------------
t0 = Ticks()
r = SoundQueue(1, 239, 1000, 15, 0)       REM a 10 second note
t1 = Ticks()
CHK("queue_result", STR$(r), "1")
CHK("queue_returns_at_once", STR$((t1 - t0) <= 3), "1")
CHK("busy_playing", STR$(SoundBusy(1)), "1")
CHK("free_while_playing", STR$(SoundFree(1)), "4")
CHK("other_channels_idle", STR$(SoundBusy(2) + SoundBusy(4)), "0")
Wait(10)
CHK("period_regs", STR$(Per(0)), "239")
CHK("volume_reg", STR$(Vol(0)), STR$(Want(15)))
CHK("other_volume_silent", STR$(Vol(1) + Vol(2)), "0")

REM ---------------- full queue ----------------
ok = 1
FOR i = 1 TO 4
  t0 = Ticks()
  r = SoundQueue(1, 300 + i, 1000, 15, 0)
  t1 = Ticks()
  IF r <> 1 OR SoundFree(1) <> 4 - i OR (t1 - t0) > 3 THEN
    ok = 0
    PRINT "FAIL fill i="; i; " r="; r; " free="; SoundFree(1)
  END IF
NEXT i
CHK("fill_4", STR$(ok), "1")
t0 = Ticks()
r = SoundQueue(1, 399, 1000, 15, 0)
t1 = Ticks()
CHK("full_returns_0", STR$(r), "0")
CHK("full_returns_at_once", STR$((t1 - t0) <= 3), "1")
CHK("full_free_0", STR$(SoundFree(1)), "0")
CHK("full_still_busy", STR$(SoundBusy(1)), "1")
CHK("full_B_unaffected", STR$(SoundFree(2)), "4")
REM the rejected note changed nothing: still playing the first one
CHK("full_period_unchanged", STR$(Per(0)), "239")

REM ---------------- SoundStop ----------------
SoundStop
CHK("stop_free", STR$(SoundFree(1)), "4")
CHK("stop_busy", STR$(SoundBusy(1)), "0")
CHK("stop_silent", STR$(Vol(0) + Vol(1) + Vol(2)), "0")
CHK("queue_after_stop", STR$(SoundQueue(1, 200, 50, 15, 0)), "1")
SoundStop

REM ---------------- channels independent ----------------
CHK("q_A", STR$(SoundQueue(1, 300, 1000, 15, 0)), "1")
CHK("q_B", STR$(SoundQueue(2, 400, 1000, 12, 0)), "1")
CHK("q_C", STR$(SoundQueue(4, 500, 1000, 9, 0)), "1")
Wait(10)
CHK("ind_period_A", STR$(Per(0)), "300")
CHK("ind_period_B", STR$(Per(1)), "400")
CHK("ind_period_C", STR$(Per(2)), "500")
CHK("ind_vol_A", STR$(Vol(0)), STR$(Want(15)))
CHK("ind_vol_B", STR$(Vol(1)), STR$(Want(12)))
CHK("ind_vol_C", STR$(Vol(2)), STR$(Want(9)))
REM fill A only: B and C keep their free slots
FOR i = 1 TO 4
  r = SoundQueue(1, 300, 1000, 15, 0)
NEXT i
CHK("ind_A_full", STR$(SoundFree(1)), "0")
CHK("ind_B_free", STR$(SoundFree(2)), "4")
CHK("ind_C_free", STR$(SoundFree(4)), "4")
SoundStop
REM several channels in one call: the same note on A and C
r = SoundQueue(5, 250, 1000, 14, 0)
Wait(10)
CHK("multi_A", STR$(Per(0)) + " " + STR$(Vol(0)), "250 " + STR$(Want(14)))
CHK("multi_C", STR$(Per(2)) + " " + STR$(Vol(2)), "250 " + STR$(Want(14)))
CHK("multi_B_silent", STR$(SoundBusy(2)) + " " + STR$(Vol(1)), "0 0")
SoundStop

REM ---------------- period clamp ----------------
r = SoundQueue(1, 5000, 1000, 15, 0)
Wait(10)
CHK("period_clamped", STR$(Per(0)), "4095")
SoundStop

REM ---------------- volume envelope ----------------
SoundEnvelope 1, @decay(0), 1
decay(0) = 0: decay(1) = 0: decay(2) = 0     REM the data was copied
r = SoundQueue(1, 239, 200, 15, 1)
t0 = Ticks()
ok = 1
prev = 255
n = 0
DO
  v = Vol(0)
  IF v > prev THEN ok = 0
  IF v < prev THEN n = n + 1
  prev = v
LOOP UNTIL Ticks() - t0 >= 450
CHK("env_decreasing", STR$(ok), "1")
CHK("env_steps_seen", STR$(n >= 8), "1")
CHK("env_reaches_0", STR$(prev), "0")
REM the note lasts 2 s, the envelope 1.5 s, so it is still playing at 1.5 s
SoundStop
REM start volume 15, first step comes after the first pause
decay(0) = 15: decay(1) = 255: decay(2) = 10
SoundEnvelope 2, @decay(0), 1
r = SoundQueue(1, 239, 200, 15, 2)
Wait(5)
CHK("env_starts_high", STR$(Vol(0) >= 14), "1")
SoundStop

REM two sections: down by 2 for 5 steps, then up by 2 for 5 steps
SoundEnvelope 3, @two(0), 2
r = SoundQueue(2, 239, 100, 10, 3)
t0 = Ticks()
prev = Vol(1)
ok = 1
n = 0
DO
  v = Vol(1)
  IF v <> prev THEN
    IF v < prev AND n = 1 THEN ok = 0
    IF v > prev THEN n = 1
    prev = v
  END IF
LOOP UNTIL Ticks() - t0 >= 100
CHK("env2_down_then_up", STR$(ok) + STR$(n), "11")
SoundStop

REM ---------------- order and duration ----------------
REM four notes of 0.15 s on A: the AY holds each period in turn
r = SoundQueue(1, 201, 15, 15, 0)
r = SoundQueue(1, 202, 15, 15, 0)
r = SoundQueue(1, 203, 15, 15, 0)
r = SoundQueue(1, 204, 15, 15, 0)
t0 = Ticks()
n = 0
last = 0
DO
  p = Per(0)
  IF p <> last AND n < 8 THEN
    seq(n) = p
    n = n + 1
    last = p
  END IF
LOOP UNTIL Ticks() - t0 >= 240
CHK("order_count", STR$(n), "4")
CHK("order", STR$(seq(0)) + " " + STR$(seq(1)) + " " + STR$(seq(2)) + " " + STR$(seq(3)), "201 202 203 204")
REM 4 x 0.15 s = 0.6 s = 180 ticks: all done at 240
CHK("order_done", STR$(SoundBusy(1)), "0")
CHK("order_free", STR$(SoundFree(1)), "4")
REM duration: one 0.3 s note, polled until it is done
r = SoundQueue(1, 239, 30, 15, 0)
t0 = Ticks()
DO
LOOP UNTIL SoundBusy(1) = 0 OR Ticks() - t0 > 300
t1 = Ticks() - t0
CHK("duration_0.3s", STR$(t1 >= 80 AND t1 <= 105), "1")

REM ---------------- rendezvous ----------------
REM A (rendezvous with B = 16) holds until B (rendezvous with A = 8) arrives
r = SoundQueue(1 + 16, 239, 1000, 15, 0)
Wait(15)
CHK("rv_A_waits", STR$(Vol(0)), "0")
r = SoundQueue(2 + 8, 300, 1000, 15, 0)
Wait(15)
CHK("rv_both_start", STR$(Vol(0)) + " " + STR$(Vol(1)), STR$(Want(15)) + " " + STR$(Want(15)))
SoundStop

REM ---------------- BEEP after ----------------
r = SoundQueue(1, 239, 1000, 15, 0)
SoundStop
t0 = Ticks()
BEEP 0.2, 0
t1 = Ticks()
CHK("beep_after_waits", STR$((t1 - t0) >= 55 AND (t1 - t0) <= 75), "1")
CHK("beep_after_idle", STR$(SoundBusy(1)), "0")
CHK("queue_after_beep", STR$(SoundQueue(1, 239, 20, 15, 0)), "1")
SoundStop

PRINT "DONE"
