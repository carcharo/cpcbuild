' ----------------------------------------------------------------
' main.bas -- Lamplighter: title, game loop, game over (portable)
'
' The game rules are in game.bas, everything platform-specific in
' platform_cpc.bas (the portable layer of DESIGN.md).
'
'   zxbc --arch cpc --org 0x40 -D CPC464 main.bas      (see build_cpc.sh)
'
' Test switches: -D START_ROOM=n (start in room n at its start cell instead
' of the cellar, 9), -D SHOT=n (a screenshot after n logic steps, then END),
' -D SHOT_LIT (with SHOT: the room's lamps lit first, the door open), -D
' SHOT_CLIMB (the player halfway up room 10's ladder), -D SHOT_WALK (the
' player walks right from the start and jumps after 8 steps: sprites moving,
' a lamp lit on the way), -D SHOT_TITLE (the
' title screen, after a second), -D BENCH (250 logic steps of a scripted game with four enemies, then the
' step rate). Platform extras used by those: PlatEnd() and PlatShot(name).
' ----------------------------------------------------------------

#ifdef SHOT
#define TESTSW
#endif
#ifdef BENCH
#ifndef TESTSW
#define TESTSW
#endif
#endif

#ifdef START_ROOM
CONST FIRST_ROOM AS UBYTE = START_ROOM
#else
#ifdef BENCH
CONST FIRST_ROOM AS UBYTE = 0
#else
CONST FIRST_ROOM AS UBYTE = 9
#endif
#endif

#include once "assets/rooms.bas"
#ifdef __CPC__
#include "platform_cpc.bas"
#else
#include "platform_zx.bas"
#endif
#include "game.bas"

#ifdef SHOT
DIM shotN AS UINTEGER
#endif
#ifdef BENCH
DIM benchT AS UINTEGER
DIM benchN AS UINTEGER
DIM benchLast AS UINTEGER
DIM benchLate AS UINTEGER      ' steps that took more than two frames
DIM benchMax AS UINTEGER       ' the longest step, in frames
DIM benchAt(15) AS UINTEGER    ' -D BENCHLOG: the first late steps (number, frames)
#endif

#ifdef SHOT
' Test set-ups: the state a screenshot is taken in
SUB ShotSetup()
  DIM c, r AS UBYTE
#ifdef SHOT_LIT
  FOR r = 0 TO ROOM_H - 1
    FOR c = 0 TO ROOM_W - 1
      IF TileAttr(c, r) = 16 THEN LightLamp(c, r)
    NEXT c
  NEXT r
#endif
#ifdef SHOT_CLIMB
  pX = 56
  pY = 140
  pClimb = 1
#endif
END SUB
#endif

#ifdef TESTSW
SUB Tick()
#ifdef SHOT
  shotN = shotN + 1
  IF shotN = SHOT THEN
    PlatShot("room")
    PlatEnd()
#ifdef __ZX48K__
    TEND()
#endif
    END
  END IF
#endif
#ifdef BENCH
  DIM t, r, d AS UINTEGER
  IF benchN = 0 THEN
    benchT = PlatFrames()
    benchLast = benchT
  ELSE
    d = PlatFrames() - benchLast
    benchLast = PlatFrames()
    IF d > 2 THEN
#ifdef BENCHLOG
      IF benchLate < 8 THEN
        benchAt(benchLate * 2) = benchN
        benchAt(benchLate * 2 + 1) = d
      END IF
#endif
      benchLate = benchLate + 1
    END IF
    IF d > benchMax THEN benchMax = d
  END IF
  benchN = benchN + 1
  IF benchN = 251 THEN
    t = PlatFrames() - benchT
    PlatEnd()
    r = 62500 / (t >> 1)
#ifdef __CPC__
    PRINT "INFO steps="; benchN - 1; " frames="; t; " per second="; r / 10; "."; r - (r / 10) * 10; " late="; benchLate; " longest="; benchMax
#else
    TLN("INFO steps=" + STR$(benchN - 1) + " frames=" + STR$(t) + " per second=" + STR$(r / 10) + "." + STR$(r - (r / 10) * 10) + " late=" + STR$(benchLate) + " longest=" + STR$(benchMax))
#endif
#ifdef BENCHLOG
    FOR t = 0 TO 7
#ifdef __CPC__
      IF t < benchLate THEN PRINT "LATE step "; benchAt(t * 2); " frames "; benchAt(t * 2 + 1)
#else
      IF t < benchLate THEN TLN("LATE step " + STR$(benchAt(t * 2)) + " frames " + STR$(benchAt(t * 2 + 1)))
#endif
    NEXT t
#endif
#ifdef __ZX48K__
    TEND()
#endif
    END
  END IF
#endif
END SUB
#endif

#ifdef BENCH
' A scripted walk from the start cell (x 136): left to x 104, right back to
' 136, a jump every 25 steps (never to the room's edge: no room change)
DIM benchDir AS UBYTE
FUNCTION BenchInput(n AS UINTEGER) AS UBYTE
  DIM r AS UBYTE
  IF pX <= 104 THEN benchDir = 0
  IF pX >= 136 THEN benchDir = 1
  IF benchDir = 1 THEN r = I_LEFT ELSE r = I_RIGHT
  IF CAST(UBYTE, n) MOD 25 = 24 THEN r = r BOR I_FIRE
  RETURN r
END FUNCTION
#endif

DIM inp, st AS UBYTE

' The title screen. Returns when fire (or any key) is pressed.
SUB TitleScreen()
  DIM released, f AS UBYTE
  DIM idle AS UINTEGER
  PlatClear()
  PlatMusic(1)
  PlatText(4, 3, "LAMPLIGHTER")
  PlatText(1, 7, "LIGHT EVERY LAMP IN")
  PlatText(3, 9, "THE DARK TOWER")
  PlatTileRaw(8, 12, T_LIT)
  PlatTileRaw(11, 12, T_LAMP)
  PlatText(5, 17, "PRESS FIRE")
#ifdef __CPC__
  PlatText(1, 20, "O P Q A OR CURSORS")
#else
  PlatText(1, 20, "O P Q A OR KEMPSTON")
#endif
  PlatText(1, 22, "SPACE JUMPS")
  released = 0
  idle = 0
  DO
    inp = PlatInput()
    f = (idle >> 3) BAND 1
    PlatSprite(0, f + 1, 36, 96)
    PlatSprite(1, F_ENEMY + f, 108, 96)
    PlatFrameEnd()
    idle = idle + 1
#ifdef SHOT_TITLE
    IF idle = 50 THEN
      PlatShot("room")
      PlatEnd()
#ifdef __ZX48K__
      TEND()
#endif
      END
    END IF
#endif
    IF (inp BAND 8) = 0 THEN released = 1
  LOOP UNTIL released = 1 AND (inp BAND 8) <> 0
END SUB

' A game: from the cellar until the lives or the tower's dark run out.
SUB RunGame()
  DIM ov AS UBYTE
  PlatClear()
  PlatMusic(2)
  PlatPlaying(1)
  GameInit(FIRST_ROOM)
#ifdef SHOT
  ShotSetup()
#endif
#ifdef BENCH
  ' room 0 has two enemies; two more make the worst case of DESIGN.md (four):
  ' a walker on the left of the floor and a bat over the middle
  nEn = 4
  eK(2) = 1
  eX0(2) = 48
  eY0(2) = 160
  eR(2) = 0
  eK(3) = 3
  eX0(3) = 48
  eY0(3) = 72
  eR(3) = 64
  ResetEnemies()
#endif
  ov = 0
  DO
    inp = PlatInput()
#ifdef SHOT_WALK
    ' walking right from the start, a jump after 8 steps
    inp = I_RIGHT
    IF shotN = 8 THEN inp = I_RIGHT BOR I_FIRE
#endif
#ifdef BENCH
    inp = BenchInput(benchN)
    gLives = 3
#endif
    st = GameStep(inp)
    GameDraw()
    PlatFrameEnd()
#ifdef TESTSW
    Tick()
#endif
    IF st <> S_PLAY THEN
      IF ov = 0 THEN
        IF st = S_OVER THEN
          PlatText(5, 9, "GAME OVER")
        ELSE
          PlatText(3, 9, "THE TOWER IS LIT")
        END IF
      END IF
      ov = ov + 1
      IF ov > 100 THEN EXIT DO
      IF ov > 30 AND (inp BAND I_FIRE) <> 0 THEN EXIT DO
    END IF
  LOOP
  PlatPlaying(0)
  PlatMusic(0)
END SUB

PlatInit()

#ifdef BENCH
DO
  RunGame()
LOOP
#else
#ifdef SHOT_TITLE
TitleScreen()
#else
#ifdef SHOT
' a screenshot of the first room: the game starts without the title
RunGame()
#else
DO
  TitleScreen()
  RunGame()
LOOP
#endif
#endif
#endif
