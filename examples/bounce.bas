' ----------------------------------------------------------------
' bounce.bas -- cpcbuild demo (Amstrad CPC, mode 0)
'
' A tiled background with eight shaded balls bouncing around it,
' double-buffered. The graphics come from the asset pipeline: the PNG and
' TMX sources in assets/ are converted by tools/build_assets.sh
' (img2cpc.py, tmx2bas.py) into the .bas includes below. ESC quits.
' Runs at 25 updates a second (every other frame): each ball is erased
' with one TileRestore call and drawn with one PutSpriteMasked.
'
'   zxbasic/tools/cpc/run.sh cpcbuild/examples/bounce.bas
'
' Sound (firmware sound manager, never waiting): a short blip on channel A
' when a ball hits a wall (pitch by ball, an octave lower for the floor and
' ceiling), and a looping four-bar tune on channels B (melody) and C
' (bass), topped up every 8th update from tables below. Build switches:
' -D NOMUSIC = effects only, -D NOSOUND = silent.
'
' Benchmark: built with -D BENCH it runs 250 updates, then prints the
' rate (headless: tools/cpcrun.py examples/bounce.bas --zxbc-arg=-D
' --zxbc-arg=BENCH).
' ----------------------------------------------------------------

#include <cpc.bas>
#include <cpcbuild.bas>

CONST NBALLS AS UBYTE = 8

' bgtiles: 3 tiles x 32 bytes (4 bytes x 8 rows), and bgtiles_pal, the
'   firmware colours of pens 0-15: black, blue, bright blue, sky blue,
'   bright cyan, bright white, red, bright red, orange, bright yellow,
'   green, bright green, magenta, bright magenta, white, cyan.
' level: the 20 x 25 tile map (level_W x level_H), from level.tmx.
' balls: 3 balls x 4 bytes x 16 rows x (mask, pixels), 128 bytes each.
#include "assets/bgtiles.bas"
#include "assets/level.bas"
#include "assets/balls.bas"

#ifdef BENCH
' KL TIME PLEASE (&BD0D): the firmware's 300 Hz clock.
FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION
DIM benchT AS ULONG
DIM benchN AS UINTEGER
#endif

#ifdef NOSOUND
#ifndef NOMUSIC
#define NOMUSIC
#endif
#endif

' --- sound -----------------------------------------------------------
#ifndef NOSOUND
' Volume envelopes (SoundEnvelope: step count, step size, pause in 1/100 s).
' 1: the blip, 8 steps of -2 every 1/100 s. 2: the melody's pluck, 8 steps
' of -1 every 2/100 s.
DIM envBlip(2) AS UBYTE = {8, 254, 1}
DIM envPluck(2) AS UBYTE = {8, 255, 2}

' Tone periods of the balls' blips (62500 / Hz): C5 D5 E5 G5 A5 C6 D6 E6.
DIM ballPer(NBALLS - 1) AS UINTEGER = {119, 106, 95, 80, 71, 60, 53, 47}

' A blip, unless two are already waiting: SoundQueue never waits (it
' returns 0 if the channel's queue is full) but a long queue would play
' blips late, so a bounce with a backlog stays silent.
SUB Blip(per AS UINTEGER)
  DIM r AS UBYTE
  IF SoundFree(1) > 2 THEN r = SoundQueue(1, per, 8, 15, 1)
END SUB
#endif

#ifndef NOMUSIC
' The tune, A minor / F / C / G, 4 bars of 8 eighths (0.16 s): melody
' periods on channel B, and the bass in quarters on channel C (the same
' bar length, 1.28 s). The first note of each bar rendezvouses with the
' other channel's, so they cannot drift apart.
DIM mel(31) AS UINTEGER = { _
  95, 119, 142, 119, 95, 119, 142, 119, _
  90, 119, 142, 119, 90, 119, 142, 119, _
  95, 119, 159, 119, 95, 119, 159, 119, _
  106, 127, 159, 127, 106, 127, 159, 127 }
DIM bas(15) AS UINTEGER = { _
  568, 379, 568, 379, 716, 478, 716, 478, _
  478, 319, 478, 319, 638, 426, 638, 426 }
DIM mi, bi AS UBYTE

' Queues the tune's next notes on whichever of B and C has room.
SUB TopUpMusic()
  DIM r, ch AS UBYTE
  DO WHILE SoundFree(2) > 0
    ch = 2
    IF (mi BAND 7) = 0 THEN ch = 2 + 32
    r = SoundQueue(ch, mel(mi), 16, 13, 2)
    mi = (mi + 1) BAND 31
  LOOP
  DO WHILE SoundFree(4) > 0
    ch = 4
    IF (bi BAND 3) = 0 THEN ch = 4 + 16
    r = SoundQueue(ch, bas(bi), 32, 14, 0)
    bi = (bi + 1) BAND 15
  LOOP
END SUB
#endif

' --- main ------------------------------------------------------------

' Each ball's state is a 16-byte record in st(), reached through a
' pointer with PEEK/POKE: an array element with a variable index costs a
' call to the compiler's general array routine (a few hundred T-states),
' a PEEK through a pointer only a few instructions, and this loop runs
' for 8 balls 12-25 times a second.
CONST BX AS UBYTE = 0                 ' x (bytes)
CONST BY AS UBYTE = 1                 ' y (lines)
CONST VX AS UBYTE = 2                 ' velocities, 8-bit two's complement
CONST VY AS UBYTE = 3                 ' (255 = -1): adding them wraps right
CONST OX AS UBYTE = 4                 ' x last drawn on screen 0, 1 (+4, +5)
CONST OY AS UBYTE = 6                 ' y last drawn on screen 0, 1 (+6, +7);
                                      ' OX = 255: not drawn there yet
CONST SPR AS UBYTE = 8                ' address of its sprite frame (2 bytes)
CONST PER AS UBYTE = 10               ' blip tone period (2 bytes)
CONST REC AS UBYTE = 16

DIM st(NBALLS * REC - 1) AS UBYTE
DIM i, buf, x, y, v, tk AS UBYTE
DIM p AS UINTEGER

Mode 0
SetPalette(@bgtiles_pal(0), bgtiles_PENS)
SetBorder 0
ScreenInit()

SetTileSet(@bgtiles(0))
TileMap(@level(0), 0, 0, level_W, level_H)
EnableDoubleBuffer()

p = @st(0)
FOR i = 0 TO NBALLS - 1
  POKE p + BX, 6 + i * 8
  POKE p + BY, 12 + i * 20
  IF i bAND 1 THEN POKE p + VX, 255 ELSE POKE p + VX, 1
  POKE p + VY, 2 + (i MOD 3)
  POKE p + OX, 255
  POKE p + OX + 1, 255
  POKE UINTEGER p + SPR, @balls(CAST(UINTEGER, i MOD 3) * balls_SIZE)
#ifndef NOSOUND
  POKE UINTEGER p + PER, ballPer(i)
#endif
  p = p + REC
NEXT i

#ifndef NOSOUND
SoundStop
SoundEnvelope 1, @envBlip(0), 1
SoundEnvelope 2, @envPluck(0), 1
#endif
#ifndef NOMUSIC
TopUpMusic()
#endif

buf = 0
#ifdef BENCH
benchT = Ticks()
#endif
DO
  ' erase every ball where this screen last showed it ...
  p = @st(0) + buf
  FOR i = 0 TO NBALLS - 1
    x = PEEK(p + OX)
    IF x <> 255 THEN TileRestore(@level(0), level_W, x, PEEK(p + OY), balls_W, balls_H)
    p = p + REC
  NEXT i
  ' ... then move and draw them all
  p = @st(0)
  FOR i = 0 TO NBALLS - 1
    v = PEEK(p + VX)
    x = PEEK(p + BX) + v
    IF x < 4 OR x > 80 - 4 - 4 THEN
      v = 0 - v
      POKE p + VX, v
      x = x + v + v
#ifndef NOSOUND
      Blip(PEEK(UINTEGER, p + PER))
#endif
    END IF
    v = PEEK(p + VY)
    y = PEEK(p + BY) + v
    IF y < 8 OR y > 200 - 8 - 16 THEN
      v = 0 - v
      POKE p + VY, v
      y = y + v + v
#ifndef NOSOUND
      Blip(PEEK(UINTEGER, p + PER) * 2)
#endif
    END IF
    POKE p + BX, x
    POKE p + BY, y
    PutSpriteMasked(x, y, balls_W, balls_H, PEEK(UINTEGER, p + SPR))
    POKE p + OX + buf, x
    POKE p + OY + buf, y
    p = p + REC
  NEXT i
  FlipBuffer()
  buf = 1 - buf
  ScanKeys()
#ifndef NOMUSIC
  tk = tk + 1
  IF (tk BAND 7) = 0 THEN TopUpMusic()
#endif
#ifdef BENCH
  benchN = benchN + 1
LOOP UNTIL benchN = 250
benchT = Ticks() - benchT
DisableDoubleBuffer()
#ifndef NOSOUND
SoundStop
#endif
PRINT "INFO updates="; benchN; " ticks="; benchT; " per second="; CAST(ULONG, benchN) * 3000 / benchT / 10; "."; (CAST(ULONG, benchN) * 3000 / benchT) MOD 10
#else
LOOP UNTIL KeyDown(KEY_ESC)

DisableDoubleBuffer()
#ifndef NOSOUND
SoundStop
#endif
#endif
