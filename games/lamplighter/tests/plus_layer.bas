REM Lamplighter Plus's platform layer (platform_plus.bas) with the real game
REM logic: which hardware sprite shows what after a step, read back from the
REM ASIC's sprite registers and pixel RAM, the sprite manager's cache (no
REM upload when a picture is already in a slot), and the flame's palette
REM cycling on pens 11-14. Needs a CPC Plus: runs as the firmware build on a
REM 6128 Plus and as a bare cartridge (Caprice32, CPCEC). Prints "PASS name" /
REM "FAIL name ..." lines and DONE.

#include once "../assets/rooms.bas"
#include "../platform_plus.bas"
#include "../game.bas"

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

' registers of sprite s (0 X low, 1 X high, 2 Y low, 3 Y high); Caprice32 does
' not read the magnification back, so it is not tested here (the picture on
' screen is, in the goldens)
FUNCTION Reg(s AS UBYTE, off AS UBYTE) AS UBYTE
  RETURN PlusPeek($6000 + CAST(UINTEGER, s) * 8 + off)
END FUNCTION

FUNCTION SprX(s AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, Reg(s, 0)) + CAST(UINTEGER, Reg(s, 1)) * 256
END FUNCTION

FUNCTION SprY(s AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, Reg(s, 2)) + CAST(UINTEGER, Reg(s, 3)) * 256
END FUNCTION

' how many objects have a slot
FUNCTION Held() AS UBYTE
  DIM s, n AS UBYTE
  n = 0
  FOR s = 0 TO NSLOT - 1
    IF pHs(s) <> 255 THEN n = n + 1
  NEXT s
  RETURN n
END FUNCTION

' 1 if hardware sprite s holds frame f of lpsprites (one pixel a byte)
FUNCTION HasFrame(s AS UBYTE, f AS UBYTE) AS UBYTE
  DIM i AS UINTEGER
  FOR i = 0 TO 255
    IF PlusPeek($4000 + CAST(UINTEGER, s) * 256 + i) <> PEEK(@lpsprites(0) + (CAST(UINTEGER, f) << 8) + i) THEN RETURN 0
  NEXT i
  RETURN 1
END FUNCTION

' the game's sprites for one step
SUB OneStep()
  GameDraw()
  PlatFrameEnd()
END SUB

DIM i, k, s, h, st AS UBYTE
DIM up AS UINTEGER

PlatInit()
CheckEq("a Plus", PlusAvailable(), 1)
CheckEq("no object has a slot after PlatInit", Held(), 0)

' --- the palette ---
CheckEq("pen 0 black", GetPalette12(0), $000)
CheckEq("pen 7 white", GetPalette12(7), $FFF)
CheckEq("border", GetPalette12(16), PL_BORDER)
CheckEq("sprite colour 1", GetPalette12(17), $80F)
CheckEq("flame pen 11", GetPalette12(11), pl_flame(0))
CheckEq("flame pen 12", GetPalette12(12), pl_flame(1))
CheckEq("flame pen 13", GetPalette12(13), pl_flame(2))
CheckEq("flame pen 14", GetPalette12(14), pl_flame(3))

' --- room 9: the player and one enemy ---
GameInit(9)
CheckEq("PlatRoom: no slot held", Held(), 0)
OneStep()
CheckEq("player and one enemy hold slots", Held(), 2)
Check("the others have none", pHs(2) = 255 AND pHs(3) = 255 AND pHs(4) = 255)
h = pHs(0)
CheckEq("player x = 4 pX", SprX(h), 4 * CAST(UINTEGER, pX))
CheckEq("player y = pY", SprY(h), pY)
Check("player picture: frame 0 (standing, facing right)", HasFrame(h, 0))
s = pHs(1)
CheckEq("enemy x = 4 eX", SprX(s), 4 * CAST(UINTEGER, eX(0)))
CheckEq("enemy y = eY", SprY(s), eY(0))
Check("enemy picture: frame 10", HasFrame(s, F_ENEMY))
Check("two different slots", h <> s)
CheckEq("two uploads so far", SprUploads(), 2)

' --- walking: positions follow, a new frame is one upload, the same none ---
up = SprUploads()
FOR k = 1 TO 4
  st = GameStep(I_RIGHT)
  OneStep()
NEXT k
CheckEq("player moved right, x", SprX(pHs(0)), 4 * CAST(UINTEGER, pX))
Check("player picture follows the walk frame", HasFrame(pHs(0), 1 + ((pAnim >> 1) BAND 1)))
Check("walking uploaded pictures", SprUploads() > up)
up = SprUploads()
PlatSprite(0, 1, pX, pY)
PlatFrameEnd()
PlatSprite(0, 1, pX + 2, pY)
PlatFrameEnd()
CheckEq("a move to the same frame: no upload", SprUploads(), up)
CheckEq("the sprite moved", SprX(pHs(0)), 4 * (CAST(UINTEGER, pX) + 2))

' --- hidden and shown again: the manager's cache, no upload ---
PlatSprite(0, 255, 0, 0)
PlatFrameEnd()
CheckEq("hidden: slot released", pHs(0), 255)
PlatSprite(0, 1, 40, 100)
PlatFrameEnd()
CheckEq("shown again: no upload (cache hit)", SprUploads(), up)
CheckEq("shown again at its place", SprX(pHs(0)), 160)

' --- a room change frees every slot, and the cache gives them back ---
up = SprUploads()
k = pHs(0)
PlatRoom(@cur(0))
CheckEq("PlatRoom hides every sprite", Held(), 0)
GameDraw()
PlatFrameEnd()
CheckEq("a new room: sprites back", Held(), 2)
CheckEq("a new room: no upload", SprUploads(), up)

' --- four enemies share one picture in four slots ---
PlatSprite(1, 10, 20, 40)
PlatSprite(2, 10, 40, 40)
PlatSprite(3, 11, 60, 40)
PlatSprite(4, 10, 80, 40)
PlatFrameEnd()
CheckEq("player and four enemies hold slots", Held(), 5)
CheckEq("enemy 2 x", SprX(pHs(2)), 160)
CheckEq("enemy 4 x", SprX(pHs(4)), 320)
Check("enemy 3 has frame 11", HasFrame(pHs(3), 11))
Check("enemy 4 has frame 10", HasFrame(pHs(4), 10))
FOR k = 1 TO 4
  PlatSprite(k, 255, 0, 0)
NEXT k
PlatFrameEnd()
CheckEq("enemies hidden", Held(), 1)
PlatClear()
CheckEq("PlatClear: nothing held", Held(), 0)

' --- the flame: four colours rotate over pens 11-14 every second step ---
PlatRoom(@cur(0))
FlameStart()
CheckEq("flame starts at offset 0", GetPalette12(11), pl_flame(0))
PlatFrameEnd()
CheckEq("after 1 step: unchanged", GetPalette12(11), pl_flame(0))
PlatFrameEnd()
CheckEq("after 2 steps: pen 11 shows colour 1", GetPalette12(11), pl_flame(1))
CheckEq("after 2 steps: pen 14 shows colour 0", GetPalette12(14), pl_flame(0))
FOR k = 1 TO 6
  PlatFrameEnd()
NEXT k
CheckEq("after 8 steps: round again", GetPalette12(11), pl_flame(0))
CheckEq("other pens untouched: pen 3", GetPalette12(3), $F00)
CheckEq("sprite colour 1 untouched", GetPalette12(17), $80F)

PRINT "DONE"
