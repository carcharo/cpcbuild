REM Conformance: the Arkos Tracker 3 music library (lib/music/music.bas):
REM MusicInit / MusicFrame / MusicStop, SfxInit / SfxPlay / SfxStop.
REM
REM Songs: the Arkos repo's own MIT test songs (assets/music/, see
REM LICENSE.arkos there), exported by tools/aks2bas.py --from-asm.
REM   soft123   one note a channel-A tone, volume 15 falling by 1 a frame
REM             (silent from frame 16), notes C4 D4 E4 F4 G4 (periods 239,
REM             213, 190, 179, 159: 1 MHz / (16 * period) = 261.5 Hz ...)
REM             starting on frames 1, 49, 91, 127, 157 (frames counted from
REM             the first MusicFrame after MusicInit).
REM   softhard  software and hardware sounds (hardware envelope, volume
REM             register 16), loops after 384 frames.
REM   sfx       five sound effects (all soft sounds with noise); effect 1
REM             starts with period 95, noise 1, volume 15.
REM Manual mode (MusicAuto = 0): music_hook.bas covers the frame hook.
REM The AY registers are read back with AyRead after each MusicFrame (the
REM player's own writes; no audio check is possible in an emulator). The
REM frame loop is WaitRetrace(1) then MusicFrame(), as music.bas documents.

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <music/music.bas>
#include "lib/chk.bas"
#include "lib/ticks.bas"
#include "assets/music/soft123.bas"
#include "assets/music/softhard.bas"
#include "assets/music/sfx.bas"


DIM a0(410) AS UBYTE
DIM a1(410) AS UBYTE
DIM a6(410) AS UBYTE
DIM a7(410) AS UBYTE
DIM a8(410) AS UBYTE
DIM a11(410) AS UBYTE
DIM a12(410) AS UBYTE
DIM a13(410) AS UBYTE
DIM f AS UINTEGER

REM Record the registers of frame i (what the player left in the AY).
SUB Rec(i AS UINTEGER)
  a0(i) = AyRead(0)
  a1(i) = AyRead(1)
  a6(i) = AyRead(6)
  a7(i) = AyRead(7)
  a8(i) = AyRead(8)
  a11(i) = AyRead(11)
  a12(i) = AyRead(12)
  a13(i) = AyRead(13)
END SUB

REM n frames: WaitRetrace(1), MusicFrame, record, starting at frame number 1.
SUB Run(n AS UINTEGER)
  DIM i AS UINTEGER
  FOR i = 1 TO n
    WaitRetrace(1)
    MusicFrame()
    Rec(i)
  NEXT i
END SUB

REM Tone period of channel ch (0-2) as the AY holds it.
FUNCTION Per(ch AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, AyRead(ch * 2 + 1) BAND 15) * 256 + AyRead(ch * 2)
END FUNCTION

REM Volume register of channel ch.
FUNCTION VolReg(ch AS UBYTE) AS UBYTE
  RETURN AyRead(8 + ch)
END FUNCTION

REM Frame i of the recording: tone A period and volume register.
SUB Note(name AS STRING, i AS UINTEGER, per AS UINTEGER, vol AS UBYTE)
  CHK(name, STR$(CAST(UINTEGER, a1(i) BAND 15) * 256 + a0(i)) + " " + STR$(a8(i)), STR$(per) + " " + STR$(vol))
END SUB

REM Wait n ticks (1/300 s) of the firmware clock; returns 1 if it got there,
REM 0 if the clock never advanced (interrupts off, clock dead).
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

MusicAuto = 0
DIM t0, t1 AS ULONG
DIM ok, c AS UBYTE
DIM i AS UINTEGER

REM ---------------- harmless before any song ----------------
MusicFrame()
MusicStop()
SfxPlay(1, 0, 0)
SfxStop(0)
CHK("noop_before_init_alive", STR$(Wait(5)), "1")

REM ---------------- soft123: notes, decay, timing ----------------
SoundStop
MusicInit(@soft123, 0)
Run(180)
CHK("s1_f1_mixer", STR$(a7(1)), "62")
Note("s1_f1_C4", 1, 239, 15)
Note("s1_f2", 2, 239, 14)
Note("s1_f8", 8, 239, 8)
Note("s1_f15", 15, 239, 1)
Note("s1_f16_silent", 16, 0, 0)
CHK("s1_f16_mixer_all_off", STR$(a7(16)), "63")
c = 1
FOR i = 16 TO 48
  IF a8(i) <> 0 THEN c = 0
NEXT i
CHK("s1_silent_16_48", STR$(c), "1")
Note("s1_f49_D4", 49, 213, 15)
Note("s1_f50", 50, 213, 14)
Note("s1_f64_silent", 64, 0, 0)
Note("s1_f91_E4", 91, 190, 15)
Note("s1_f127_F4", 127, 179, 15)
Note("s1_f157_G4", 157, 159, 15)
Note("s1_f165", 165, 159, 7)
REM only channel A ever sounds
c = 1
FOR i = 1 TO 180
  IF a7(i) <> 62 AND a7(i) <> 63 THEN c = 0
NEXT i
CHK("s1_only_A", STR$(c), "1")
CHK("s1_B_C_silent", STR$(VolReg(1) + VolReg(2)), "0")

REM ---------------- MusicStop ----------------
MusicInit(@soft123, 0)
Run(3)
Note("stop_before_f3", 3, 239, 13)
MusicStop()
CHK("stop_vol_A", STR$(VolReg(0) + VolReg(1) + VolReg(2)), "0")
CHK("stop_mixer", STR$(AyRead(7)), "63")
REM further MusicFrames do nothing
FOR i = 1 TO 4
  WaitRetrace(1)
  MusicFrame()
NEXT i
CHK("stop_stays_silent", STR$(VolReg(0) + VolReg(1) + VolReg(2)), "0")
MusicStop()
CHK("stop_twice_ok", STR$(VolReg(0)), "0")
REM re-init restarts the song from the top
MusicInit(@soft123, 0)
Run(2)
Note("restart_f1", 1, 239, 15)
Note("restart_f2", 2, 239, 14)
MusicStop()

REM ---------------- softhard: hardware sounds, loop ----------------
MusicInit(@softhard, 0)
Run(400)
CHK("sh_f1", STR$(a0(1)) + " " + STR$(a8(1)) + " " + STR$(a7(1)) + " " + STR$(a13(1)) + " " + STR$(a11(1)) + " " + STR$(a12(1)), "239 16 62 8 1 0")
CHK("sh_f28", STR$(a0(28)) + " " + STR$(a8(28)) + " " + STR$(a11(28)) + " " + STR$(a12(28)), "225 16 217 255")
CHK("sh_f55_silent", STR$(a8(55)) + " " + STR$(a7(55)), "0 63")
CHK("sh_f82", STR$(a0(82)) + " " + STR$(a8(82)) + " " + STR$(a11(82)), "213 16 32")
CHK("sh_f136", STR$(a0(136)) + " " + STR$(a1(136)) + " " + STR$(a11(136)) + " " + STR$(a12(136)), "239 5 1 2")
CHK("sh_f163_noise", STR$(a6(163)) + " " + STR$(a7(163)) + " " + STR$(a13(163)), "2 55 12")
CHK("sh_f190_silent", STR$(a8(190)) + " " + STR$(a7(190)), "0 63")
CHK("sh_loop_f385", STR$(a0(385)) + " " + STR$(a8(385)) + " " + STR$(a7(385)) + " " + STR$(a11(385)) + " " + STR$(a13(385)), "239 16 62 1 8")
CHK("sh_loop_f386_equals_f2", STR$(a0(386) = a0(2) AND a8(386) = a8(2) AND a7(386) = a7(2)), "1")
MusicStop()
CHK("sh_stop_silent", STR$(VolReg(0)), "0")

REM ---------------- sound effects ----------------
SfxInit(@sfx)
MusicInit(@soft123, 0)
Run(20)
REM frame 20: song silent. Effect 1 on channel B at full volume.
SfxPlay(1, 1, 0)
WaitRetrace(1)
MusicFrame()
CHK("sfx_B_period", STR$(Per(1)), "95")
CHK("sfx_B_volume", STR$(VolReg(1)), "15")
CHK("sfx_B_noise", STR$(AyRead(6)), "1")
CHK("sfx_A_C_silent", STR$(VolReg(0) + VolReg(2)), "0")
CHK("sfx_mixer_B_tone_noise", STR$(AyRead(7)), "45")
REM inverted volume lowers it
SfxStop(1)
WaitRetrace(1)
MusicFrame()
CHK("sfxstop_B_silent", STR$(VolReg(1)), "0")
SfxPlay(1, 2, 4)
WaitRetrace(1)
MusicFrame()
CHK("sfx_C_invvol4", STR$(Per(2)) + " " + STR$(VolReg(2)), "95 11")
SfxStop(2)
REM while the song sounds: restart, play an effect over the note on A
MusicInit(@soft123, 0)
Run(4)
SfxPlay(2, 2, 0)
WaitRetrace(1)
MusicFrame()
CHK("sfx_over_music_A", STR$(Per(0)) + " " + STR$(VolReg(0)), "239 11")
CHK("sfx_over_music_C", STR$(Per(2)) + " " + STR$(VolReg(2)), "301 15")
SfxStop(2)
WaitRetrace(1)
MusicFrame()
CHK("sfx_stopped_music_goes_on", STR$(Per(0)) + " " + STR$(VolReg(0)) + " " + STR$(VolReg(2)), "239 10 0")
REM bad arguments are ignored
SfxPlay(0, 1, 0)
SfxPlay(1, 3, 0)
SfxStop(7)
WaitRetrace(1)
MusicFrame()
CHK("sfx_bad_args_ignored", STR$(VolReg(0)) + " " + STR$(VolReg(1)) + " " + STR$(VolReg(2)), "9 0 0")
MusicStop()

#ifndef CPC_BAREMETAL
REM ---------------- the firmware sound manager is kept out ----------------
REM A queued firmware note, then MusicInit (which calls SoundStop): the
REM firmware must not touch the chip afterwards.
c = SoundQueue(2, 500, 1000, 15, 0)
Wait(6)
MusicInit(@soft123, 0)
WaitRetrace(1)
MusicFrame()
Wait(60)
CHK("fw_idle_A", STR$(Per(0)) + " " + STR$(VolReg(0)), "239 15")
CHK("fw_idle_B", STR$(Per(1)) + " " + STR$(VolReg(1)), "0 0")
MusicStop()
#endif

REM ---------------- interrupts, clock, tempo ----------------
MusicInit(@softhard, 0)
WaitRetrace(1)
t0 = Ticks()
FOR i = 1 TO 100
  WaitRetrace(1)
  MusicFrame()
NEXT i
t1 = Ticks()
REM 100 frames = 600 ticks of the firmware's 300 Hz clock
CHK("tempo_100_frames_ticks", STR$((t1 - t0) >= 594 AND (t1 - t0) <= 606), "1")
CHK("interrupts_on_after", STR$(Wait(10)), "1")
MusicStop()

REM ---------------- stress: 1500 frames, effects thrown in ----------------
MusicInit(@softhard, 0)
DIM seed AS UINTEGER = 12345
DIM bad AS UBYTE = 0
FOR i = 1 TO 1500
  WaitRetrace(1)
  IF (i BAND 7) = 0 THEN
    seed = seed * 75 + 74
    SfxPlay(1 + (seed >> 8) MOD 5, (seed >> 4) MOD 3, (seed >> 11) BAND 7)
  END IF
  MusicFrame()
  REM the volume registers never hold anything above 16
  IF AyRead(8) > 16 OR AyRead(9) > 16 OR AyRead(10) > 16 THEN bad = 1
  IF (i BAND 15) = 0 THEN SfxStop(i MOD 3)
NEXT i
CHK("stress_regs_sane", STR$(bad), "0")
CHK("stress_alive", STR$(Wait(10)), "1")
MusicStop()
CHK("stress_stop_silent", STR$(VolReg(0) + VolReg(1) + VolReg(2)), "0")

REM ---------------- the cost of a MusicFrame ----------------
REM 500 calls timed on the firmware clock, against a delay loop of
REM 1,400,000 CPC T-states (50000 passes of 28 T: DEC BC 8, LD A,B 4,
REM OR C 4, JP NZ 12), as in cb_sprites.bas. A MusicFrame with no song
REM playing is the empty baseline (the call, the loop). The difference is
REM the player plus the register saving, per call.
FUNCTION Calib() AS UINTEGER
  DIM t0 AS ULONG
  t0 = Ticks()
  ASM
  ld bc, 50000
CAL_LOOP:
  dec bc
  ld a, b
  or c
  jp nz, CAL_LOOP
  END ASM
  RETURN CAST(UINTEGER, Ticks() - t0)
END FUNCTION

FUNCTION Bench500() AS UINTEGER
  DIM t0 AS ULONG
  DIM i AS UINTEGER
  t0 = Ticks()
  FOR i = 1 TO 500
    MusicFrame()
  NEXT i
  RETURN CAST(UINTEGER, Ticks() - t0)
END FUNCTION

DIM tc, te, tp AS UINTEGER
tc = Calib()
te = Bench500()
MusicInit(@soft123, 0)
tp = Bench500()
PRINT "INFO ticks: calibration(1.4M T)="; tc; " empty="; te; " soft123="; tp; " (500 calls, 1/300 s)"
IF tc > 0 THEN
  PRINT "INFO T-states per MusicFrame (soft123, 1 channel, player + saving): "; CAST(ULONG, tp - te) * 2800 / tc
END IF
MusicStop()
MusicInit(@softhard, 0)
tp = Bench500()
IF tc > 0 THEN
  PRINT "INFO T-states per MusicFrame (softhard): "; CAST(ULONG, tp - te) * 2800 / tc
END IF
REM with three effects on top
SfxPlay(1, 0, 0)
SfxPlay(2, 1, 0)
SfxPlay(5, 2, 0)
tp = Bench500()
IF tc > 0 THEN
  PRINT "INFO T-states per MusicFrame (softhard, 3 effects at the start): "; CAST(ULONG, tp - te) * 2800 / tc
END IF
MusicStop()

PRINT "DONE"
