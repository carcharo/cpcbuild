REM MODELS: 48
REM ZXBC: -DZX48
REM Conformance (ZX Spectrum 48K, --arch zx48k -D ZX48): music.bas
REM compiles to stubs: every call is a no-op, no IM2 handler is installed
REM (the CPU stays in IM1, I unchanged, FRAMES and the ROM keep working),
REM and the player is not in the program.
REM   python3 tools/zxrun.py tests/zx/music_48k.bas --model 48 --zxbc-arg=-DZX48 \
REM        --zxbc-arg=-I<repo>/lib:<repo>/tests/zx/lib

#ifndef ZX48
#error "compile with -D ZX48"
#endif
#include <music/music.bas>
#include <zxtest.bas>
#include <zxmusic.bas>
#include "../conformance/assets/music/sfx.bas"

DIM i0 AS UBYTE
DIM t AS UINTEGER
i0 = IReg()
MusicInit(0, 0)
MusicFrame()
SfxInit(@sfx)
SfxPlay(1, 0, 0)
SfxStop(0)
CHK("I_untouched", STR$(IReg()), STR$(i0))
t = Frames()
PAUSE 5
t = Frames() - t
CHK("frames_count", STR$(t >= 5 AND t <= 6), "1")
MusicStop()
CHK("auto_default", STR$(MusicAuto), "1")
TEND()
