REM MODELS: 128
REM TYPE: a
REM Conformance (ZX Spectrum 128K): INKEY$ keeps working with the music's
REM IM2 handler installed (the handler ends in the ROM's interrupt routine,
REM which scans the keyboard). Needs the runner to type a key:
REM   python3 tools/zxrun.py tests/zx/music_keys.bas --model 128 --type a
REM The first key read must be "a"; FRAMES must still count while music
REM plays and a key is read.

#include <music/music.bas>
#include <zxtest.bas>
#include <zxmusic.bas>
#include "../conformance/assets/music/soft123.bas"

DIM k AS STRING
DIM i, t AS UINTEGER

MusicInit(@soft123, 0)
t = Frames()
k = ""
FOR i = 1 TO 500
  k = INKEY$
  IF k <> "" THEN EXIT FOR
  WaitFrame()
NEXT i
CHK("inkey_with_im2_music", k, "a")
CHK("frames_counted_while_waiting", STR$(Frames() - t >= 1), "1")
MusicStop()
TEND()
