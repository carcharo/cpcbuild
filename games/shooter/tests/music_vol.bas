REM Starfall in-game song: peak AY volume registers (B = melody, C = bass, A must
REM stay silent for the effects) over one and a half loops of the song (about 580
REM frames). Prints "INFO peakB= peakC= peakA=" and checks the peaks are 9..12
REM (clearly audible, clearly under the effects' 15). Run with
REM   python3 tools/cpcrun.py games/shooter/tests/music_vol.bas --emu chips --model 6128 --org 0x40
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <music/music.bas>
#include "../assets/gamesong.bas"

DIM i, pa, pb, pc, v AS UBYTE
DIM f AS UINTEGER
MusicAuto = 0
SoundStop
MusicInit(@sf_game, 0)
FOR f = 1 TO 580
  WaitRetrace(1)
  MusicFrame()
  v = AyRead(8): IF v > pa THEN pa = v
  v = AyRead(9): IF v > pb THEN pb = v
  v = AyRead(10): IF v > pc THEN pc = v
NEXT f
MusicStop()
PRINT "INFO peakB="; pb; " peakC="; pc; " peakA="; pa
IF pa = 0 AND pb >= 9 AND pb <= 12 AND pc >= 9 AND pc <= 12 THEN
  PRINT "PASS in_game_volume"
ELSE
  PRINT "FAIL in_game_volume"
END IF
PRINT "DONE"
