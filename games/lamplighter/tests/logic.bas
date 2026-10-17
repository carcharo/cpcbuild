REM Lamplighter game logic tests (games/lamplighter/game.bas), driven with
REM scripted input. Runs on any build: it uses the null layer
REM (platform_null.bas) and prints "PASS name" / "FAIL name ..." lines and
REM DONE, the convention of tests/conformance.

#include "platform_null.bas"
#include "../game.bas"

DIM i, k, n, lo, hi, st AS UBYTE

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

' n steps with input inp; the state after the last
FUNCTION Steps(n AS UBYTE, inp AS UBYTE) AS UBYTE
  DIM i, r AS UBYTE
  r = 0
  FOR i = 1 TO n
    r = GameStep(inp)
  NEXT i
  RETURN r
END FUNCTION

' n steps with the room's enemies removed at every step (they are loaded
' again by each room change)
FUNCTION StepsAlone(n AS UBYTE, inp AS UBYTE) AS UBYTE
  DIM i, r AS UBYTE
  r = 0
  FOR i = 1 TO n
    nEn = 0
    r = GameStep(inp)
  NEXT i
  RETURN r
END FUNCTION

' The player alone in a room at cell (cx, cy), no enemies
SUB Put(room AS UBYTE, cx AS UBYTE, cy AS UBYTE)
  EnterRoom(room, cx << 3, cy << 3)
  nEn = 0
  pAir = 0
  pJt = 0
  pClimb = 0
END SUB

SUB Fresh()
  GameInit(9)
  sfxCount = 0
  nRooms = 0
END SUB

' --- the start of a game ---
Fresh()
CheckEq("room", pRoom, 9)
CheckEq("start x", pX, 8)
CheckEq("start y", pY, 160)
CheckEq("lives", gLives, 3)
CheckEq("lamps total", gTotal, 28)
CheckEq("lamps lit", gLit, 0)
CheckEq("room lamps", gRoomLamps, 2)
CheckEq("enemies", nEn, 1)
CheckEq("state", gState, S_PLAY)
CheckEq("door closed", cur(20 * 20 + 19), T_DOOR)
CheckEq("standing", Ground(), 1)

' --- every room: the start cell is free ground, no spikes ---
n = 0
FOR k = 0 TO 11
  EnterRoom(k, 255, 0)
  IF ColSolid((pX + 1) >> 3, pY) <> 0 OR ColSolid((pX + 6) >> 3, pY) <> 0 THEN n = n + 1
  IF Ground() = 0 THEN n = n + 1
  IF nEn > 4 THEN n = n + 1
NEXT k
CheckEq("room starts ok", n, 0)

' --- walking and walls ---
Fresh()
nEn = 0
st = Steps(10, I_RIGHT)
CheckEq("walk right", pX, 28)
CheckEq("still on the floor", pY, 160)
st = Steps(40, I_LEFT)
CheckEq("left wall", pX, 8)

' --- gravity ---
Put(9, 3, 5)
st = Steps(40, 0)
CheckEq("falls to the floor", pY, 160)
CheckEq("landed", pAir, 0)

' --- the jump: 25 lines up, then back ---
Put(9, 1, 20)
st = GameStep(I_FIRE)
lo = pY
FOR i = 1 TO 30
  st = GameStep(0)
  IF pY < lo THEN lo = pY
NEXT i
CheckEq("jump apex", lo, 135)
CheckEq("jump lands", pY, 160)
CheckEq("jump sound", sfxLast, 1)

' --- jumping onto a platform (row 19, columns 6-11) ---
Put(9, 5, 20)
st = GameStep(I_FIRE BOR I_RIGHT)
n = 0
FOR i = 1 TO 30
  st = GameStep(I_RIGHT)
  IF pY = 136 AND pAir = 0 THEN n = 1
NEXT i
CheckEq("on the platform", n, 1)

' --- a low ceiling: the head stops at a brick ---
Put(9, 3, 20)
pY = 8
pAir = 1
pJt = 0
st = Steps(1, 0)
CheckEq("brick above", pY, 8)

' --- lamps, doors, room flips ---
Fresh()
nEn = 0
Put(9, 3, 20)
st = GameStep(0)
CheckEq("lamp lit", gLit, 1)
CheckEq("lamp tile", cur(21 * 20 + 3), T_LIT)
CheckEq("lamp sound", sfxLast, 2)
CheckEq("door still closed", cur(20 * 20 + 19), T_DOOR)
Put(9, 8, 17)
st = GameStep(0)
CheckEq("second lamp", gLit, 2)
CheckEq("door open", cur(20 * 20 + 19), T_OPEN)
CheckEq("door open tile drawn", lastTile, T_OPEN)
Put(9, 17, 20)
st = Steps(10, I_RIGHT)
CheckEq("flipped right", pRoom, 10)
CheckEq("arrival x", pX, 2)
CheckEq("arrival y", pY, 160)
st = Steps(3, I_LEFT)
CheckEq("flipped back", pRoom, 9)
CheckEq("lit lamps kept", gRoomLit, 2)
CheckEq("lamp tile kept", cur(21 * 20 + 3), T_LIT)
CheckEq("door stays open", cur(20 * 20 + 19), T_OPEN)

' --- a closed door blocks ---
Fresh()
nEn = 0
Put(9, 17, 20)
st = Steps(30, I_RIGHT)
CheckEq("door blocks", pX, 144)
CheckEq("still in room", pRoom, 9)

' --- spikes cost a life; the room restarts from the entry point ---
Fresh()
pX = 96
FOR i = 1 TO 12
  st = GameStep(I_RIGHT)
  IF gLives < 3 THEN EXIT FOR
NEXT i
CheckEq("spikes: lives", gLives, 2)
CheckEq("spikes: back at entry x", pX, 8)
CheckEq("spikes: back at entry y", pY, 160)
CheckEq("spikes: death sound", sfxLast, 3)
CheckEq("spikes: still playing", gState, S_PLAY)

' --- an enemy costs a life ---
Fresh()
Put(9, 1, 20)
EnterRoom(9, 8, 160)
pX = 130
st = GameStep(0)
CheckEq("enemy near: lives", gLives, 3)
pX = eX(0)
st = GameStep(0)
CheckEq("enemy: lives", gLives, 2)

' --- game over after three ---
Fresh()
FOR i = 1 TO 3
  pX = 96
  st = Steps(8, I_RIGHT)
NEXT i
CheckEq("game over lives", gLives, 0)
CheckEq("game over state", st, S_OVER)

' --- the walker keeps between the spikes and the door ---
Fresh()
lo = 255
hi = 0
FOR i = 1 TO 200
  st = GameStep(0)
  IF eX(0) < lo THEN lo = eX(0)
  IF eX(0) > hi THEN hi = eX(0)
NEXT i
CheckEq("walker min x", lo, 128)
CheckEq("walker max x", hi, 144)
CheckEq("walker alive", gLives, 3)

' --- ladders: room 10, column 7, rows 16-21 ---
Put(10, 7, 20)
st = Steps(40, I_UP)
CheckEq("ladder up y", pY, 112)
CheckEq("ladder up x", pX, 56)
CheckEq("ladder top standing", pClimb + pAir, 0)
st = Steps(40, I_DOWN)
CheckEq("ladder down y", pY, 160)
CheckEq("ladder down done", pClimb + pAir, 0)

' --- up the ladder in room 11 into room 8 ---
Put(11, 15, 20)
st = StepsAlone(100, I_UP)
CheckEq("climbed to room", pRoom, 8)
CheckEq("climbed to y", pY, 160)
CheckEq("climbed standing", pClimb + pAir, 0)

' --- and down again ---
st = StepsAlone(100, I_DOWN)
CheckEq("climbed down to room", pRoom, 11)
CheckEq("climbed down to y", pY, 160)

' --- falling off the top of a room's ledge to the room below is a flip ---
Put(8, 15, 20)
pClimb = 0
st = Steps(1, 0)
CheckEq("ladder top is solid", pY, 160)

' --- enemies: floater, bat ---
EnterRoom(10, 255, 0)
lo = 255
hi = 0
FOR i = 1 TO 100
  st = GameStep(0)
  IF eY(0) < lo THEN lo = eY(0)
  IF eY(0) > hi THEN hi = eY(0)
NEXT i
CheckEq("floater top", lo, 96)
CheckEq("floater bottom", hi, 128)
EnterRoom(8, 255, 0)
lo = 255
hi = 0
n = 0
FOR i = 1 TO 100
  st = GameStep(0)
  IF eX(0) < lo THEN lo = eX(0)
  IF eX(0) > hi THEN hi = eX(0)
NEXT i
CheckEq("bat left", lo, 80)
CheckEq("bat right", hi, 128)

' --- the last lamp wins ---
Fresh()
nEn = 0
gTotal = 1
Put(9, 3, 20)
st = GameStep(0)
CheckEq("won", st, S_WON)

PRINT "DONE"
