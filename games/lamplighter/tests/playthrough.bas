REM Lamplighter: the whole tower played through with a recorded input
REM sequence (playseq.bas, made by tests/reach.py from its model of the
REM movement) on the real game.bas, null layer, enemies off. Every lamp must
REM light and the game must be won.

#include "say.bas"
#include "platform_null.bas"
#include "../game.bas"
#include "playseq.bas"

DIM i, st, inp AS UBYTE
DIM k AS UINTEGER
DIM n AS UINTEGER
DIM cnt AS UINTEGER
DIM roomsDone AS UBYTE

GameInit(9)
n = 0
st = S_PLAY
roomsDone = 0
FOR k = 0 TO PLAY_PAIRS - 1
  inp = playSeq(k * 2)
  cnt = playSeq(k * 2 + 1)
  FOR i = 1 TO cnt
    nEn = 0
    st = GameStep(inp)
    n = n + 1
  NEXT i
NEXT k

IF st = S_WON THEN Say("PASS won") ELSE Say("FAIL won state=" + STR$(st))
IF gLit = gTotal AND gTotal = 28 THEN Say("PASS all 28 lamps") ELSE Say("FAIL lamps lit=" + STR$(gLit) + " of " + STR$(gTotal))
IF gLives = 3 THEN Say("PASS no life lost") ELSE Say("FAIL lives=" + STR$(gLives))
IF pRoom = 0 THEN Say("PASS ended in the belfry") ELSE Say("FAIL room=" + STR$(pRoom))
Say("INFO steps=" + STR$(n))
AllDone()
