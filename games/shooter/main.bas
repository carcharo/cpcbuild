' ----------------------------------------------------------------
' main.bas -- Starfall: title, game loop, game ov (portable)
'
' One source for the CPC 6128 / 464 and the Spectrum 128K / 48K. The game
' rules are in game.bas, everything platform-specific in platform_cpc.bas
' or platform_zx.bas (the portable layer of DESIGN.md).
'
'   zxbc --arch cpc --org 0x40 -D CPC6128 main.bas      (see build_cpc.sh)
'
' Test switches (every build): -D DEMO (attract mode from the start, fixed
' random seed), -D SHOT=n (a screenshot after n logic steps, then END;
' without DEMO it is of the title screen), -D BENCH (250 logic steps of an
' attract-style game with the in-game music, then the step rate).
' Platform extras used by those: PlatEnd() (back to the machine's own
' world before printing) and PlatShot(name).
' ----------------------------------------------------------------

#ifdef __CPC__
#ifdef PLUS
#include "platform_plus.bas"
#else
#include "platform_cpc.bas"
#endif
' Text cells (20 x 25), the legend's sprite x and text column
CONST TX_TITLE_C AS UBYTE = 6
CONST TX_TITLE_R AS UBYTE = 3
CONST TX_LEG_C AS UBYTE = 9           ' "= 30" next to the sprites
CONST LEG_X AS UBYTE = 40             ' logical x of the legend sprites
CONST LEG_Y AS UBYTE = 40             ' and y of the first (text row r is at y = 8 r - 16)
CONST TX_PRESS_C AS UBYTE = 5
CONST TX_PRESS_R AS UBYTE = 15
CONST TX_KEYS_C AS UBYTE = 3
CONST TX_KEYS_R AS UBYTE = 17
CONST TX_OVER_C AS UBYTE = 5
CONST TX_OVER_R AS UBYTE = 9
CONST TX_NEW_C AS UBYTE = 3
CONST TX_NEW_R AS UBYTE = 12
#else
#include "platform_zx.bas"
CONST TX_TITLE_C AS UBYTE = 12
CONST TX_TITLE_R AS UBYTE = 3
CONST TX_LEG_C AS UBYTE = 15
CONST LEG_X AS UBYTE = 48
CONST LEG_Y AS UBYTE = 24             ' text row r is at y = 8 r - 32
CONST TX_PRESS_C AS UBYTE = 11
CONST TX_PRESS_R AS UBYTE = 15
CONST TX_KEYS_C AS UBYTE = 7
CONST TX_KEYS_R AS UBYTE = 17
CONST TX_OVER_C AS UBYTE = 11
CONST TX_OVER_R AS UBYTE = 9
CONST TX_NEW_C AS UBYTE = 8
CONST TX_NEW_R AS UBYTE = 12
#endif

#include "game.bas"

#ifdef SHOT
DIM shotN AS UINTEGER
#endif
#ifdef BENCH
DIM benchT AS UINTEGER
DIM benchN AS UINTEGER
#endif

#ifdef BENCH_ERR
SUB BenchErr(n AS UBYTE)
  ASM
  ld a, (ix+5)
  call .core.__ERROR
  END ASM
END SUB
#endif

' Per-step bookkeeping for the test switches. w: 0 title, 1 play.
SUB Tick(w AS UBYTE)
#ifdef SHOT
  shotN = shotN + 1
  IF shotN = SHOT THEN
    IF w = 0 THEN PlatShot("title") ELSE PlatShot("play")
    PlatEnd()
    END
  END IF
#endif
#ifdef BENCH
  DIM t, r AS UINTEGER
  IF benchN = 0 THEN benchT = PlatFrames()
  benchN = benchN + 1
  IF benchN = 251 THEN
    t = PlatFrames() - benchT
    PlatEnd()
#ifdef BENCH_ERR
    ' no PRINT (a bare 6128 build with the text code would not fit below
    ' &4000): the frames as "Error n", n = frames - 400, on the printer echo
    BenchErr(CAST(UBYTE, t - 400))
#else
    r = 62500 / (t >> 1)
    PRINT "INFO steps="; benchN - 1; " frames="; t; " per second="; r / 10; "."; r - (r / 10) * 10
#endif
    END
  END IF
#endif
END SUB

DIM inp, st AS UBYTE
DIM tstep AS UINTEGER

' The title screen. Returns 0 when the player starts, 1 after a few
' seconds idle (the attract mode).
FUNCTION TitleScreen() AS UBYTE
  DIM released, f, tx AS UBYTE
  DIM idle AS UINTEGER
  PlatClear()
  PlatMusic(1)
  PlatText(TX_TITLE_C, TX_TITLE_R, "STARFALL")
#ifdef PLUS
  PlatText(TX_TITLE_C + 3, TX_TITLE_R + 2, "PLUS")
#endif
  PlatText(TX_LEG_C, 7, "= 30")
  PlatText(TX_LEG_C, 9, "= 20")
  PlatText(TX_LEG_C, 11, "= 10")
  PlatText(TX_LEG_C, 13, "= 50")
  PlatText(TX_PRESS_C, TX_PRESS_R, "PRESS FIRE")
  PlatText(TX_KEYS_C, TX_KEYS_R, "O P OR CURSORS")
  PlatText(TX_KEYS_C, TX_KEYS_R + 2, "SPACE OR FIRE")
  released = 0
  idle = 0
  DO
    PlatFrameBegin()
    inp = PlatInput()
    f = (idle >> 3) BAND 1
    PlatSprite(K_ENEMY + 2, f, LEG_X, LEG_Y)
    PlatSprite(K_ENEMY + 1, f, LEG_X, LEG_Y + 16)
    PlatSprite(K_ENEMY, f, LEG_X, LEG_Y + 32)
    PlatSprite(K_DIVER, f, LEG_X, LEG_Y + 48)
    tx = CAST(UBYTE, idle) BAND 127
    IF tx > 63 THEN tx = 127 - tx
    PlatSprite(K_SHIP, 0, 28 + (tx BAND 126), SHIP_Y)
    PlatHud(gScore, 3, 1, gHi)
    PlatFrameEnd()
    Tick(0)
    idle = idle + 1
    IF (inp BAND 8) = 0 THEN released = 1
    IF released = 1 AND (inp BAND 8) <> 0 THEN
      GameSeed(PlatFrames() + idle)
      RETURN 0
    END IF
    IF idle > 200 THEN RETURN 1
  LOOP
END FUNCTION

' A game. demo = 1: the attract mode (the computer plays, any key ends it,
' fixed seed); tune: the music to play (1 title, 2 in-game).
SUB RunGame(demo AS UBYTE, tune AS UBYTE)
  DIM ov AS UBYTE
  DIM keys AS UBYTE
  GameInit()
  IF demo = 1 THEN GameSeed(12345)
  PlatClear()
  PlatMusic(tune)
  ov = 0
  DO
    PlatFrameBegin()
    keys = PlatInput()
    IF demo = 1 THEN
      IF (keys BAND 8) <> 0 THEN EXIT DO
      inp = AttractInput()
    ELSE
      inp = keys
    END IF
    st = GameStep(inp)
    GameDraw()
    PlatHud(gScore, gLives, gWave, gHi)
    PlatFrameEnd()
    Tick(1)
    IF st = S_OVER THEN
      IF ov = 0 THEN
        PlatText(TX_OVER_C, TX_OVER_R, "GAME OVER")
        IF gScore = gHi AND gScore > 0 THEN PlatText(TX_NEW_C, TX_NEW_R, "NEW HIGH SCORE")
      END IF
      ov = ov + 1
      IF ov > 70 THEN EXIT DO
      IF ov > 20 AND (keys BAND 4) <> 0 THEN EXIT DO
    END IF
  LOOP
  PlatMusic(0)
END SUB

PlatInit()
GameSeed(1)
gHi = 0
gScore = 0

#ifdef BENCH
DO
  RunGame(1, 2)
LOOP
#else
#ifdef DEMO
RunGame(1, 1)
#endif
DO
  IF TitleScreen() = 0 THEN
    RunGame(0, 2)
  ELSE
    RunGame(1, 1)
  END IF
LOOP
#endif
