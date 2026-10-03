REM Starfall game logic tests (games/shooter/game.bas), driven with scripted
REM input and placed bullets, bombs and divers. Runs on any build: it uses
REM the null layer (platform_null.bas) and prints "PASS name" / "FAIL name
REM ..." lines and DONE, the convention of tests/conformance.

#include "platform_null.bas"
#include "../game.bas"

DIM i, k, n, mx AS UBYTE
DIM s0 AS UINTEGER

SUB Check(name AS STRING, ok AS UBYTE)
  IF ok <> 0 THEN
    PRINT "PASS "; name
  ELSE
    PRINT "FAIL "; name
  END IF
END SUB

SUB CheckEq(name AS STRING, got AS LONG, want AS LONG)
  IF got = want THEN
    PRINT "PASS "; name
  ELSE
    PRINT "FAIL "; name; " got="; got; " want="; want
  END IF
END SUB

' A fresh game with a fixed seed, no stray shots
SUB Fresh()
  GameSeed(1)
  gHi = 0
  GameInit()
  nSprites = 0
  sfxLast = 0
  sfxCount = 0
END SUB

' n steps with input inp; the result of the last
FUNCTION Steps(n AS UBYTE, inp AS UBYTE) AS UBYTE
  DIM i, r AS UBYTE
  r = 0
  FOR i = 1 TO n
    r = GameStep(inp)
  NEXT i
  RETURN r
END FUNCTION

' Active player bullets
FUNCTION NBullets() AS UBYTE
  DIM n AS UBYTE
  n = 0
  IF bl(1) <> 255 THEN n = n + 1
  IF bl(3) <> 255 THEN n = n + 1
  RETURN n
END FUNCTION

' --- random numbers: one LCG, same on every build ---
GameSeed(1)
CheckEq("rand 1", Rand(), 31)
CheckEq("rand 2", Rand(), 231)
CheckEq("rand 3", Rand(), 128)
CheckEq("rand 4", Rand(), 235)
GameSeed(1)
CheckEq("rand again", Rand(), 31)

' --- the start of a game ---
Fresh()
CheckEq("lives", gLives, 3)
CheckEq("wave", gWave, 1)
CheckEq("score", gScore, 0)
CheckEq("alive", gAlive, 18)
CheckEq("rows", rm(0) + rm(1) + rm(2), 189)
CheckEq("state", gState, S_PLAY)
CheckEq("formation x", FormX(0), 20)
CheckEq("formation y top", FormY(2), 16)
CheckEq("formation y bottom", FormY(0), 40)
CheckEq("ship x", gShipX, 60)

' --- formation speed: thinner and later is faster ---
Fresh()
CheckEq("interval full", GameInterval(), 10)
gWave = 2
CheckEq("interval wave 2", GameInterval(), 9)
gWave = 5
CheckEq("interval wave 5", GameInterval(), 6)
gWave = 10
CheckEq("interval wave 10", GameInterval(), 1)
gWave = 1
gAlive = 2
CheckEq("interval 2 left", GameInterval(), 2)
gAlive = 0
CheckEq("interval none", GameInterval(), 1)
mx = 1
gWave = 1
FOR i = 18 TO 2 STEP -1
  gAlive = i
  k = GameInterval()
  gAlive = i - 1
  IF GameInterval() > k THEN mx = 0
NEXT i
Check("interval never slows as it thins", mx)

' --- the formation moves every interval steps, down at the edges ---
Fresh()
CheckEq("no move before the interval", Steps(9, 0) + gFxB, 116)
CheckEq("moves on the 10th step", Steps(1, 0) + gFxB, 118)
CheckEq("moved right by 2, animation frame", gMoves, 1)
Fresh()
gFxB = 134
gCount = 9
n = Steps(1, 0)
CheckEq("right edge: last step right", gFxB, 136)
CheckEq("right edge: not down yet", gFy, 16)
gCount = 9
n = Steps(1, 0)
CheckEq("right edge: steps down 6", gFy, 22)
CheckEq("right edge: turns left", gDir, 1)
CheckEq("right edge: x kept", gFxB, 136)
gCount = 9
n = Steps(1, 0)
CheckEq("then left", gFxB, 134)
Fresh()
gDir = 1
gFxB = 98
gCount = 9
n = Steps(1, 0)
CheckEq("left edge: last step left", gFxB, 96)
gCount = 9
n = Steps(1, 0)
CheckEq("left edge: steps down", gFy, 22)
CheckEq("left edge: turns right", gDir, 0)
Fresh()
rm(0) = 1: rm(1) = 1: rm(2) = 1
gAlive = 3
gDir = 1
gFxB = 98
gCount = 9
n = Steps(1, 0)
CheckEq("thin column: edge by the living column", gFxB, 96)
Fresh()
rm(0) = 0: rm(1) = 0: rm(2) = 32
gAlive = 1
gFxB = 100
gDir = 1
gCount = 9
n = Steps(1, 0)
CheckEq("only column 5 left: free to go to the left wall", gFxB, 98)

' --- the ship ---
Fresh()
n = Steps(2, 1)
CheckEq("ship left 4 a step", gShipX, 52)
n = Steps(30, 1)
CheckEq("ship stops at the left wall", gShipX, 0)
n = Steps(40, 2)
CheckEq("ship stops at the right wall", gShipX, 120)

' --- shooting: at most 2 bullets, a pause between ---
Fresh()
n = GameStep(4)
CheckEq("fire: a bullet", NBullets(), 1)
CheckEq("fire: at the ship's middle", bl(0), 64)
CheckEq("fire: flies up 6 a step", bl(1), SHIP_Y - 4 - 6)
CheckEq("fire: effect", sfxLast, SFX_SHOOT)
n = Steps(3, 4)
CheckEq("fire: pause between bullets", NBullets(), 1)
mx = 0
FOR i = 1 TO 10
  n = GameStep(4)
  IF NBullets() > mx THEN mx = NBullets()
  gTimer = 0
NEXT i
CheckEq("at most 2 bullets", mx, 2)

' --- bullets hit enemies: 10, 20, 30 by row ---
Fresh()
bl(0) = 56: bl(1) = 52
n = GameStep(0)
CheckEq("hit row 0: 10 points", gScore, 10)
CheckEq("hit: enemy gone", rm(0), 59)
CheckEq("hit: one fewer", gAlive, 17)
CheckEq("hit: bullet used up", bl(1), 255)
CheckEq("hit: effect", sfxLast, SFX_BOOM)
CheckEq("hit: explosion", xp(2), EXPL_STEPS - 1)
Fresh()
bl(0) = 72: bl(1) = 40
n = GameStep(0)
CheckEq("hit row 1: 20 points", gScore, 20)
CheckEq("hit row 1: enemy gone", rm(1), 55)
Fresh()
bl(0) = 24: bl(1) = 28
n = GameStep(0)
CheckEq("hit row 2: 30 points", gScore, 30)
CheckEq("hit row 2: enemy gone", rm(2), 62)
CheckEq("high score follows", gHi, 30)
Fresh()
bl(0) = 62: bl(1) = 52
n = GameStep(0)
CheckEq("between two enemies: a miss", gScore, 0)
CheckEq("miss: the bullet flies on", bl(1), 46)
Fresh()
rm(0) = 59
bl(0) = 56: bl(1) = 52
n = GameStep(0)
CheckEq("an empty slot is no target", gScore, 0)
Fresh()
bl(0) = 56: bl(1) = 4
n = GameStep(0)
CheckEq("bullet leaves at the top", bl(1), 255)
GameInit()
CheckEq("score restarts, high score stays", gScore + gHi * 1000, 0)

' --- bombs: a life lost, a pause, then play on ---
Fresh()
bm(0) = 62: bm(1) = 147
n = GameStep(0)
CheckEq("bomb hits: lives", gLives, 2)
CheckEq("bomb hits: dying", gState, S_DYING)
CheckEq("bomb hits: effect", sfxLast, SFX_HIT)
CheckEq("bomb hits: shots cleared", bm(1), 255)
n = Steps(DYING_STEPS - 1, 0)
CheckEq("still dying", gState, S_DYING)
n = Steps(1, 0)
CheckEq("play on after the pause", gState, S_PLAY)
CheckEq("play on: wave as it was", gAlive, 18)
Fresh()
bm(0) = 69: bm(1) = 147
n = GameStep(0)
CheckEq("bomb beside the ship misses", gLives, 3)
Fresh()
bm(0) = 62: bm(1) = 155
n = GameStep(0)
CheckEq("bomb leaves at the ground", bm(1), 255)
CheckEq("bomb at the ground is harmless", gLives, 3)

' --- game over: lives gone ---
Fresh()
FOR k = 1 TO 3
  bm(0) = gShipX + 2: bm(1) = 147
  n = GameStep(0)
  n = Steps(DYING_STEPS, 0)
NEXT k
CheckEq("no lives left", gLives, 0)
CheckEq("game over", gState, S_OVER)
CheckEq("stays over", GameStep(4), S_OVER)

' --- game over: the formation reaches the ship's row ---
Fresh()
gFy = 60
gFxB = 136
gCount = 9
n = Steps(1, 0)
CheckEq("high formation steps down and goes on", gState, S_PLAY)
Fresh()
gFy = 120
gFxB = 136
gCount = 9
n = Steps(1, 0)
CheckEq("formation reaches the ship: over", gState, S_OVER)
CheckEq("formation reaches the ship: lives kept", gLives, 3)

' --- a wave cleared, the next one faster and lower ---
Fresh()
rm(0) = 0: rm(1) = 0: rm(2) = 1
gAlive = 1
bl(0) = 24: bl(1) = 28
n = GameStep(0)
CheckEq("last enemy: wave cleared", gState, S_CLEAR)
CheckEq("wave cleared: effect", sfxLast, SFX_WAVE)
CheckEq("wave cleared: score", gScore, 30)
n = Steps(CLEAR_STEPS - 1, 0)
CheckEq("pause between waves", gState, S_CLEAR)
n = Steps(1, 0)
CheckEq("next wave", gWave, 2)
CheckEq("next wave: playing", gState, S_PLAY)
CheckEq("next wave: all back", gAlive, 18)
CheckEq("next wave: lower", gFy, 22)
CheckEq("next wave: faster", GameInterval(), 9)
CheckEq("next wave: lives and score kept", CAST(INTEGER, gLives) * 100 + gScore, 330)

' --- divers (from wave 2) ---
Fresh()
gWave = 2
gDive = 2: gDvR = 0: gDvC = 2: gDvX = 60: gDvY = 100: gDvPh = 0
rm(0) = 59
bl(0) = 64: bl(1) = 112
n = GameStep(0)
CheckEq("shot diver: 50 points", gScore, 50)
CheckEq("shot diver: gone", gDive, 0)
CheckEq("shot diver: one fewer", gAlive, 17)
Fresh()
gWave = 2
gDive = 2: gDvR = 0: gDvC = 2: gDvX = 60: gDvY = 146: gDvPh = 0
rm(0) = 59
n = GameStep(0)
CheckEq("diver rams the ship: a life", gLives, 2)
CheckEq("diver rams the ship: 50 points", gScore, 50)
Fresh()
gWave = 2
gDive = 3: gDvR = 1: gDvC = 3: gDvX = 0: gDvY = 0: gDvPh = 0
rm(1) = 55
n = 0
FOR i = 1 TO 120
  ClearShots()
  IF gDive <> 0 THEN n = GameStep(0): ELSE EXIT FOR
NEXT i
CheckEq("returning diver is home", gDive, 0)
CheckEq("returning diver: slot filled", rm(1), 63)
Fresh()
gWave = 2
gShipX = 60
n = 0
FOR i = 1 TO 250
  ClearShots()
  n = GameStep(0)
  IF gDive <> 0 AND n = 0 THEN k = 1
NEXT i
Check("a diver leaves the formation in wave 2", k)

' --- the attract mode plays by itself, the same every time ---
Fresh()
GameSeed(12345)
FOR i = 1 TO 250
  n = GameStep(AttractInput())
NEXT i
s0 = gScore
CheckEq("demo: state", gState, S_PLAY)
REM the values below come from the CPC build; every build must agree (the
REM logic is plain integer BASIC with a fixed seed)
CheckEq("demo score after 250 steps", s0, 130)
CheckEq("demo lives after 250 steps", gLives, 3)
CheckEq("demo enemies left", gAlive, 9)
CheckEq("demo formation x", gFxB, 100)

' --- drawing: one PlatSprite call per thing ---
Fresh()
nSprites = 0
GameDraw()
CheckEq("draw: 18 enemies and the ship", nSprites, 19)
bl(0) = 20: bl(1) = 100
bm(0) = 30: bm(1) = 50
Boom(80, 80)
nSprites = 0
GameDraw()
CheckEq("draw: and a bullet, a bomb, an explosion", nSprites, 22)

PRINT "DONE"
