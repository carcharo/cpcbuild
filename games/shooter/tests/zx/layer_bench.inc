REM Starfall Spectrum layer benchmark: the cost of one frame's drawing (erase, 25
REM sprites like the game's busiest frame, flip) with the pacing wait removed
REM (-D PZ_NOWAIT, which also means tearing: only the time counts). Prints the
REM 50 Hz ticks per frame (x100 / 100 frames). The game runs at 25 Hz
REM (2 ticks per step), so this must be well under 200 per 100 frames.
REM
REM Layer cost only (no game logic, no music load beyond the IM2 player's tick).
REM (The 48K build has the music stubs, the 128K one plays music.)
#include <zxtest.bas>
#ifndef ZX48
#include "../../../../tests/conformance/assets/music/soft123.bas"
#include "../../../../tests/conformance/assets/music/sfx.bas"
#define PLAT_ZX_SONG_TITLE @soft123
#define PLAT_ZX_SONG_GAME @soft123
#define PLAT_ZX_SFX @sfx
#endif
#include "../../assets/zx/zx_sprites.bas"
#include "../../assets/zx/zx_shots.bas"
#define PLAT_ZX_SPRITES @zx_sprites(0)
#define PLAT_ZX_SHOTS @zx_shots(0)
#include "../../platform_zx.bas"

DIM n, c, r, k AS UBYTE
DIM t0, t1 AS UINTEGER

SUB Scene(f AS UBYTE)
  DIM c, r AS UBYTE
  FOR r = 0 TO 2
    FOR c = 0 TO 5
      PlatSprite(3 - r, (f >> 2) BAND 1, 8 + c * 16 + (f BAND 14), 12 + r * 12 + (f >> 3))
    NEXT c
  NEXT r
  PlatSprite(0, 0, 2 * f BAND 120, 152)
  PlatSprite(4, f BAND 1, 100 - (f BAND 62), 60 + (f BAND 30))
  PlatSprite(5, 0, 60, 140 - (f BAND 63))
  PlatSprite(5, 0, 62, 100 - (f BAND 31))
  PlatSprite(6, 0, 20, 40 + (f BAND 63))
  PlatSprite(6, 0, 70, 30 + (f BAND 31))
  PlatSprite(6, 0, 110, 60 + (f BAND 15))
END SUB

PlatInit()
PlatMusic(2)
FOR n = 1 TO 10
  PlatFrameBegin(): Scene(n): PlatFrameEnd()
NEXT n
t0 = PlatFrames()
FOR n = 1 TO 100
  PlatFrameBegin()
  Scene(n)
  PlatFrameEnd()
NEXT n
t1 = PlatFrames() - t0
TLN("BENCH layer 25 sprites: " + STR$(t1) + " ticks per 100 frames")
CHK("bench_ran", STR$(t1 > 0), "1")
TEND()
