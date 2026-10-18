' ----------------------------------------------------------------
' platform_cpc.bas -- Lamplighter's portable layer for the Amstrad CPC
' (--arch cpc --org 0x40), mode 0
'
' Build switches: -D CPC464 / -D CPC6128 (the same code: firmware builds,
' single-buffered); -D NOGAMEMODE (keep the firmware's interrupt handler
' while playing); -D NOMUSIC (effects only), -D NOSFX (music only), -D
' NOSOUND (silent); profiling: -D NOPACE no frame wait, -D NOFLUSH no
' drawing. -D SHOT=n and -D BENCH are handled by main.bas through PlatShot
' and PlatEnd.
'
' Screen (mode 0, 20 x 25 tile cells of 4 x 8 bytes): the room is cells
' 0-19 x 0-22 (lines 0-183), the HUD rows 23 and 24. A sprite is 4 bytes
' x 16 lines, masked; x is kept in pixels (even) and drawn at byte x / 2.
'
' Single-buffered: a sprite that moved is erased by TileRestore over its
' old rectangle (from the room's map, which game.bas keeps up to date) and
' redrawn masked at the new place, all after the frame wait of
' PlatFrameEnd, so the flicker is confined to the top of the beam's way.
' A sprite that did not move is left alone unless a moved one overlaps it.
' ----------------------------------------------------------------

#ifndef __LAMP_PLATFORM__
#define __LAMP_PLATFORM__

#ifndef __CPC__
#error "platform_cpc.bas is for --arch cpc"
#endif

#ifndef CPC464
#ifndef CPC6128
#define CPC464
#endif
#endif

#define TEXT_QUEUE 1

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/keyboard.bas>
#include <cpcbuild/palette.bas>
#ifndef LAMP_PLUS
#include <cpcbuild/sprites.bas>
#endif
#include <cpcbuild/text.bas>
#include <cpcbuild/tiles.bas>
#include <cpcbuild/fill.bas>
#include <framehook.bas>

' tiles: see make_art.py; sprites: 12 masked frames of 4 x 16
#ifdef LAMP_PLUS
#include "assets/plus/tiles.bas"
#else
#include "assets/tiles.bas"
#include "assets/sprites.bas"
#endif
#include "assets/fontcpc.bas"

#ifdef NOSOUND
#ifndef NOMUSIC
#define NOMUSIC
#endif
#ifndef NOSFX
#define NOSFX
#endif
#endif

' The demo tunes and effects (lib/music, Arkos Tracker 3). The player runs
' on the frame hook, whatever the game does; the songs and the effects bank
' live in main RAM on both models (a few hundred bytes). Effects only sound
' while a song plays: -D NOMUSIC plays an empty one.
#ifndef NOSOUND
#include <music/music.bas>
#ifndef NOMUSIC
#include "assets/title.bas"
#include "assets/gamesong.bas"
#else
#include "assets/quiet.bas"
#endif
#ifndef NOSFX
#include "assets/sfx.bas"
#endif
#endif

#ifdef SHOT
#include "../../tests/screens/lib/shot.bas"
#endif

CONST NSLOT AS UBYTE = 5
DIM bitOf(4) AS UBYTE => {1, 2, 4, 8, 16}

DIM blankPal(459) AS UBYTE            ' zeros: the blank palette (16) and the title's map (460)
DIM roomAddr AS UINTEGER
DIM sNF(4) AS UBYTE      ' to be drawn (frame 255: none)
DIM sNX(4) AS UBYTE
DIM sNY(4) AS UBYTE
DIM sOF(4) AS UBYTE      ' drawn now (frame 255: nothing)
DIM sOX(4) AS UBYTE
DIM sOY(4) AS UBYTE
DIM dMask AS UBYTE       ' bit s: slot s moved or changed since it was drawn
DIM vMask AS UBYTE       ' bit s: slot s is to be shown
DIM sForce AS UBYTE
DIM fT AS UINTEGER                       ' Frames() at the start of this step
DIM curTune AS UBYTE                     ' the music playing: 0 none, 1 title, 2 game
' PlatSfx(n) -> the bank's effect: 1 jump = "shot", 2 lamp = "wave", 3 death
' = "hit", 4 door = "boom"
DIM sfxMap(4) AS UBYTE => {0, 1, 4, 3, 2}
DIM hLit, hTot, hLives, hRoom AS UBYTE

SUB PlatInit()
  DIM i AS UBYTE
  Mode 0
  SetPalette(@tiles_pal(0), tiles_PENS)
  SetBorder 0
  ScreenInit()
  SetTileSet(@tiles(0))
  TextFont(@font(0), font_FIRST, 7, font_FIRST + font_COUNT - 1)
  TextPen(7, 0)
  FOR i = 0 TO 4
    sNF(i) = 255
    sOF(i) = 255
  NEXT i
  sForce = 0
  hLit = 255
#ifndef NOSFX
  SfxInit(@sf_sfx)
#endif
END SUB

' Draws a room: the screen is blanked (all pens black) while the tiles go
' down, then the palette is restored. Sprites are forgotten (not erased: the
' room has just been drawn over them) and all drawn again by the next flush.
SUB PlatRoom(addr AS UINTEGER)
  DIM i AS UBYTE
  roomAddr = addr
  SetPalette(@blankPal(0), 16)
  TileMap(addr, 0, 0, 20, 23)
  SetPalette(@tiles_pal(0), 16)
  FOR i = 0 TO 4
    sOF(i) = 255
  NEXT i
  sForce = 1
  dMask = 0
  hLit = 255
END SUB

' One cell changed. The tile may have covered part of a sprite: all are
' redrawn at the next flush.
SUB PlatTile(cx AS UBYTE, cy AS UBYTE, t AS UBYTE)
  DoTile8(cx, cy, t)
  sForce = 1
END SUB

' A tile at cell (cx, cy), outside the game's map (the title's lamps).
SUB PlatTileRaw(cx AS UBYTE, cy AS UBYTE, t AS UBYTE)
  DoTile8(cx, cy, t)
END SUB

#ifndef LAMP_PLUS     ' (the Plus layer has hardware sprites: platform_plus.bas)
' Sprite slot s shows frame f at pixel x, line y at the next flush.
SUB PlatSprite(s AS UBYTE, f AS UBYTE, x AS UBYTE, y AS UBYTE)
  DIM bit AS UBYTE
  bit = bitOf(s)
  sNF(s) = f
  sNX(s) = x
  sNY(s) = y
  IF f = 255 THEN vMask = vMask BAND (255 - bit) ELSE vMask = vMask BOR bit
  IF f <> sOF(s) OR x <> sOX(s) OR y <> sOY(s) THEN dMask = dMask BOR bit
END SUB

' x/y rectangles (8 x 16) of two sprites overlap?
FUNCTION Overlap(x1 AS UBYTE, y1 AS UBYTE, x2 AS UBYTE, y2 AS UBYTE) AS UBYTE
  IF x1 + 8 <= x2 OR x2 + 8 <= x1 THEN RETURN 0
  IF y1 + 16 <= y2 OR y2 + 16 <= y1 THEN RETURN 0
  RETURN 1
END FUNCTION

' Erases and redraws the sprites that moved (or changed frame), and the
' player if one of them is over it.
SUB PlatFlush()
  DIM s, t, bit AS UBYTE
  IF sForce <> 0 THEN
    dMask = vMask
    FOR s = 0 TO NSLOT - 1
      IF sOF(s) <> 255 THEN dMask = dMask BOR bitOf(s)
    NEXT s
    sForce = 0
  END IF
  IF dMask = 0 THEN RETURN
  ' The player standing still, with a moved enemy over it: redraw it. (An enemy
  ' standing still under another one that moves is only chewed for a step: it
  ' moves on the next. Checking every pair costs ~30,000 T-states a step.)
  IF (dMask BAND 1) = 0 AND (vMask BAND 1) <> 0 THEN
    FOR t = 1 TO NSLOT - 1
      IF (dMask BAND bitOf(t)) <> 0 THEN
        IF Overlap(sNX(0), sNY(0), sNX(t), sNY(t)) <> 0 THEN
          dMask = dMask BOR 1
        ELSEIF sOF(t) <> 255 THEN
          IF Overlap(sNX(0), sNY(0), sOX(t), sOY(t)) <> 0 THEN dMask = dMask BOR 1
        END IF
      END IF
    NEXT t
  END IF
  bit = 1
  FOR s = 0 TO NSLOT - 1
    IF (dMask BAND bit) <> 0 THEN
      IF sOF(s) <> 255 THEN TileRestore(roomAddr, 20, sOX(s) >> 1, sOY(s), 4, 16)
    END IF
    bit = bit + bit
  NEXT s
  bit = 1
  FOR s = 0 TO NSLOT - 1
    IF (dMask BAND bit) <> 0 THEN
      IF sNF(s) <> 255 THEN
        PutSpriteMasked(sNX(s) >> 1, sNY(s), 4, 16, @sprites(CAST(UINTEGER, sNF(s)) << 7))
      END IF
      sOF(s) = sNF(s)
      sOX(s) = sNX(s)
      sOY(s) = sNY(s)
    END IF
    bit = bit + bit
  NEXT s
  dMask = 0
END SUB

#endif

' Hearts and numbers where they changed; the room name when the room did.
SUB PlatHud(lit AS UBYTE, total AS UBYTE, lives AS UBYTE, room AS UBYTE)
  DIM i AS UBYTE
  IF hLit = 255 THEN
    ' the whole HUD
    TextAt(0, 23, "LAMPS")
    TextAt(9, 23, "OF")
    hTot = 255
    hLives = 255
    hRoom = 255
    hLit = 254
  END IF
  IF lit <> hLit THEN
    hLit = lit
    TextAt(6, 23, CHR$(48 + lit / 10))
    TextAt(7, 23, CHR$(48 + lit MOD 10))
  END IF
  IF total <> hTot THEN
    hTot = total
    TextAt(12, 23, CHR$(48 + total / 10))
    TextAt(13, 23, CHR$(48 + total MOD 10))
  END IF
  IF lives <> hLives THEN
    hLives = lives
    FOR i = 0 TO 2
      IF lives > i THEN DoTile8(17 + i, 23, 9) ELSE DoTile8(17 + i, 23, 0)
    NEXT i
  END IF
  IF room <> hRoom THEN
    hRoom = room
    TextAt(0, 24, RoomName(room) + "                    ")
  END IF
END SUB

' Text at a character cell (upper case, digits and - . =)
SUB PlatText(col AS UBYTE, row AS UBYTE, s AS STRING)
  TextAt(col, row, s)
END SUB

' Blanks the whole screen and forgets the sprites and the HUD.
SUB PlatClear()
  DIM i AS UBYTE
  ClearScreen(0)
  roomAddr = @blankPal(0)
  FOR i = 0 TO 4
    sNF(i) = 255
    sOF(i) = 255
  NEXT i
  sForce = 0
  dMask = 0
  vMask = 0
  hLit = 255
END SUB

' Bits: 1 left (O, cursor left, joystick), 2 right (P, cursor right), 4 fire
' (Space, joystick fire), 8 any key, 16 up (Q), 32 down (A).
FUNCTION PlatInput() AS UBYTE
  DIM r AS UBYTE
  ScanKeys()
  r = 0
  IF KeyDown(KEY_O) <> 0 OR KeyDown(KEY_LEFT) <> 0 OR KeyDown(JOY_LEFT) <> 0 THEN r = 1
  IF KeyDown(KEY_P) <> 0 OR KeyDown(KEY_RIGHT) <> 0 OR KeyDown(JOY_RIGHT) <> 0 THEN r = r BOR 2
  IF KeyDown(KEY_SPACE) <> 0 OR KeyDown(JOY_FIRE1) <> 0 THEN r = r BOR 4
  IF KeyDown(KEY_Q) <> 0 OR KeyDown(KEY_UP) <> 0 OR KeyDown(JOY_UP) <> 0 THEN r = r BOR 16
  IF KeyDown(KEY_A) <> 0 OR KeyDown(KEY_DOWN) <> 0 OR KeyDown(JOY_DOWN) <> 0 THEN r = r BOR 32
  IF AnyKeyDown() <> 0 THEN r = r BOR 8
  RETURN r
END FUNCTION

FUNCTION PlatFrames() AS UINTEGER
  RETURN CAST(UINTEGER, Frames())
END FUNCTION

' End of a step: wait until two frames have passed since the last one (25
' steps a second), then draw what GameDraw handed over.
SUB PlatFrameEnd()
#ifndef NOPACE
  DO WHILE CAST(UINTEGER, Frames()) - fT < 2
  LOOP
#endif
  fT = CAST(UINTEGER, Frames())
#ifndef NOFLUSH
#ifdef LAMP_PLUS
  PlatFlushPlus()
#else
  PlatFlush()
#endif
#endif
END SUB

' Game mode while playing (more CPU), unless -D NOGAMEMODE.
SUB PlatPlaying(flag AS UBYTE)
#ifndef NOGAMEMODE
  GameMode(flag)
#endif
END SUB

' 0 off, 1 the title's tune, 2 the game's.
SUB PlatMusic(tune AS UBYTE)
#ifndef NOSOUND
  IF tune = curTune THEN RETURN
  curTune = tune
  IF tune = 0 THEN
    MusicStop()
  ELSEIF tune = 1 THEN
#ifndef NOMUSIC
    MusicInit(@sf_title, 0)
#else
    MusicInit(@bounce_quiet, 0)
#endif
  ELSE
#ifndef NOMUSIC
    MusicInit(@sf_game, 0)
#else
    MusicInit(@bounce_quiet, 0)
#endif
  END IF
#endif
END SUB

' Effects: 1 jump, 2 lamp lit, 3 death, 4 door opens (they replace one
' still playing; heard while a tune plays).
SUB PlatSfx(n AS UBYTE)
#ifndef NOSFX
  IF curTune <> 0 THEN SfxPlay(sfxMap(n), 0, 0)
#endif
END SUB

' Back to the firmware's world, for text output (main.bas under -D BENCH or
' -D SHOT).
#ifdef TESTSW
SUB PlatEnd()
  GameMode(0)
#ifndef NOSOUND
  MusicStop()
#endif
END SUB
#endif

#ifdef SHOT
' Asks the test runner for a screenshot called name.
SUB PlatShot(name AS STRING)
  Shot(name)
END SUB
#endif

#endif
