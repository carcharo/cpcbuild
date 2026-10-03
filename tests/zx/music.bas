REM MODELS: 128
REM Conformance (ZX Spectrum 128K, --arch zx48k): lib/music/music.bas in
REM manual mode (MusicAuto = 0): MusicInit / MusicFrame / MusicStop,
REM SfxInit / SfxPlay / SfxStop. The same songs as the CPC test
REM (tests/conformance/music.bas); the AY registers are read back through
REM port &FFFD after each MusicFrame. Song data is clock independent, so the
REM volumes, mixer and timing are the CPC's; tone periods are the CPC's
REM x 1.7734 (the Spectrum AY clock), checked as a ratio; sound effects
REM store periods (the bank is a CPC export: 95 is 95).
REM Frame loop: WaitFrame (HALT, ROM IM1 interrupt) then MusicFrame.
REM Compile with: --arch zx48k -I lib  (needs the 128K for the AY).
REM
REM Run: python3 tools/zxrun.py tests/zx/music.bas --model 128

#include <music/music.bas>
#include <zxtest.bas>
#include <zxmusic.bas>
#include "../conformance/assets/music/soft123.bas"
#include "../conformance/assets/music/softhard.bas"
#include "../conformance/assets/music/sfx.bas"

DIM a0(190) AS UBYTE
DIM a1(190) AS UBYTE
DIM a7(190) AS UBYTE
DIM a8(190) AS UBYTE
DIM i AS UINTEGER
DIM c AS UBYTE

SUB Rec(i AS UINTEGER)
  a0(i) = AyRead(0)
  a1(i) = AyRead(1)
  a7(i) = AyRead(7)
  a8(i) = AyRead(8)
END SUB

SUB Run(n AS UINTEGER)
  DIM i AS UINTEGER
  FOR i = 1 TO n
    WaitFrame()
    MusicFrame()
    Rec(i)
  NEXT i
END SUB

FUNCTION Per(ch AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, AyRead(ch * 2 + 1) BAND 15) * 256 + AyRead(ch * 2)
END FUNCTION

FUNCTION VolReg(ch AS UBYTE) AS UBYTE
  RETURN AyRead(8 + ch)
END FUNCTION

REM Frame i: tone A period within 0.5% of cpcper * 1.7734, and volume.
SUB Note(name AS STRING, i AS UINTEGER, cpcper AS UINTEGER, vol AS UBYTE)
  DIM p AS ULONG
  DIM lo, hi AS ULONG
  p = CAST(ULONG, a1(i) BAND 15) * 256 + a0(i)
  lo = CAST(ULONG, cpcper) * 17644 / 10000
  hi = CAST(ULONG, cpcper) * 17824 / 10000
  CHK(name, STR$(p >= lo AND p <= hi) + " " + STR$(a8(i)), "1 " + STR$(vol))
END SUB

MusicAuto = 0

REM ---------------- harmless before any song ----------------
MusicFrame()
MusicStop()
SfxPlay(1, 0, 0)
SfxStop(0)
DIM i0 AS UBYTE
i0 = IReg()

REM ---------------- soft123 ----------------
MusicInit(@soft123, 0)
Run(180)
CHK("s1_f1_mixer", STR$(a7(1)), "62")
Note("s1_f1_C4", 1, 239, 15)
Note("s1_f2", 2, 239, 14)
Note("s1_f15", 15, 239, 1)
CHK("s1_f16_silent", STR$(a8(16)) + " " + STR$(a7(16)), "0 63")
Note("s1_f49_D4", 49, 213, 15)
Note("s1_f91_E4", 91, 190, 15)
Note("s1_f127_F4", 127, 179, 15)
Note("s1_f157_G4", 157, 159, 15)
c = 1
FOR i = 1 TO 180
  IF a7(i) <> 62 AND a7(i) <> 63 THEN c = 0
NEXT i
CHK("s1_only_A", STR$(c), "1")
CHK("s1_B_C_silent", STR$(VolReg(1) + VolReg(2)), "0")
CHK("manual_does_not_touch_I", STR$(IReg()), STR$(i0))

REM ---------------- MusicStop ----------------
MusicInit(@soft123, 0)
Run(3)
MusicStop()
CHK("stop_vols", STR$(VolReg(0) + VolReg(1) + VolReg(2)), "0")
CHK("stop_mixer", STR$(AyRead(7)), "63")
FOR i = 1 TO 4
  WaitFrame()
  MusicFrame()
NEXT i
CHK("stop_stays_silent", STR$(VolReg(0) + VolReg(1) + VolReg(2)), "0")
MusicStop()
MusicInit(@soft123, 0)
Run(2)
Note("restart_f1", 1, 239, 15)
Note("restart_f2", 2, 239, 14)
MusicStop()

REM ---------------- softhard: hardware sounds ----------------
MusicInit(@softhard, 0)
Run(60)
CHK("sh_f1_vol_mixer", STR$(a8(1)) + " " + STR$(a7(1)), "16 62")
CHK("sh_f55_silent", STR$(a8(55)) + " " + STR$(a7(55)), "0 63")
MusicStop()

REM ---------------- sound effects (periods baked: 95) ----------------
SfxInit(@sfx)
MusicInit(@soft123, 0)
Run(20)
SfxPlay(1, 1, 0)
WaitFrame()
MusicFrame()
CHK("sfx_B_period", STR$(Per(1)), "95")
CHK("sfx_B_volume", STR$(VolReg(1)), "15")
CHK("sfx_B_noise", STR$(AyRead(6)), "1")
CHK("sfx_A_C_silent", STR$(VolReg(0) + VolReg(2)), "0")
CHK("sfx_mixer_B_tone_noise", STR$(AyRead(7)), "45")
SfxStop(1)
WaitFrame()
MusicFrame()
CHK("sfxstop_B_silent", STR$(VolReg(1)), "0")
SfxPlay(1, 2, 4)
WaitFrame()
MusicFrame()
CHK("sfx_C_invvol4", STR$(Per(2)) + " " + STR$(VolReg(2)), "95 11")
SfxStop(2)
SfxPlay(0, 1, 0)
SfxPlay(1, 3, 0)
SfxStop(7)
MusicStop()
CHK("final_I", STR$(IReg()), STR$(i0))

TEND()
