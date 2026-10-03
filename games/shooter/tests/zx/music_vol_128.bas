REM MODELS: 128
REM TIMEOUT: 30
REM Starfall in-game song on the Spectrum 128K: peak AY volume registers (B melody,
REM C bass, A empty for the effects) over about 580 frames, read back through port
REM &FFFD after each MusicFrame (manual mode). Prints INFO peakB= peakC= peakA= and
REM checks 9..12 (audible, clearly under the effects' 15). The song is the CPC's.
#include <music/music.bas>
#include <zxtest.bas>
#include <zxmusic.bas>
#include "../../assets/gamesong.bas"

DIM pa, pb, pc, v AS UBYTE
DIM f AS UINTEGER
MusicAuto = 0
MusicInit(@sf_game, 0)
FOR f = 1 TO 580
  WaitFrame()
  MusicFrame()
  v = AyRead(8): IF v > pa THEN pa = v
  v = AyRead(9): IF v > pb THEN pb = v
  v = AyRead(10): IF v > pc THEN pc = v
NEXT f
MusicStop()
TLN("INFO peakB=" + STR$(pb) + " peakC=" + STR$(pc) + " peakA=" + STR$(pa))
CHK("peak_A_silent", STR$(pa), "0")
CHK("peak_B_melody", STR$(pb >= 9 AND pb <= 12), "1")
CHK("peak_C_bass", STR$(pc >= 9 AND pc <= 12), "1")
TEND()
