REM Starfall Plus's platform layer (platform_plus.bas) with the real game logic:
REM which hardware sprite shows what after a frame, read back from the ASIC's
REM sprite registers and pixel RAM, and the 12-bit palette. Needs a CPC Plus (it
REM runs as the firmware build on a 6128 Plus and as a bare cartridge on
REM Caprice32); prints "PASS name" / "FAIL name ..." lines and DONE.

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

' register off (0 X low, 1 X high, 2 Y low, 3 Y high, 4 magnification) of sprite s
FUNCTION Reg(s AS UBYTE, off AS UBYTE) AS UBYTE
  RETURN PlusPeek($6000 + CAST(UINTEGER, s) * 8 + off)
END FUNCTION

' The magnification of slot s as the layer last sent it (0 = hidden). Caprice32
' does not read the ASIC's magnification register back (it mirrors the X and Y
' bytes there), so this is the layer's own table, which PlusPokeBlock wrote
' to the ASIC in one go together with the positions read back above.
FUNCTION Mag(s AS UBYTE) AS UBYTE
  RETURN PEEK(@hwReg(0) + CAST(UINTEGER, s) * 8 + 4)
END FUNCTION

FUNCTION SprX(s AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, Reg(s, 0)) + CAST(UINTEGER, Reg(s, 1)) * 256
END FUNCTION

FUNCTION SprY(s AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, Reg(s, 2)) + CAST(UINTEGER, Reg(s, 3)) * 256
END FUNCTION

' how many of the 16 sprites are shown
FUNCTION Shown() AS UBYTE
  DIM s, n AS UBYTE
  n = 0
  FOR s = 0 TO 15
    IF Mag(s) <> 0 THEN n = n + 1
  NEXT s
  RETURN n
END FUNCTION

' a whole frame of the game's sprites
SUB Frame()
  PlatFrameBegin()
  GameDraw()
  PlatFrameEnd()
END SUB

' 1 if slot s holds picture p of plsprites (one pixel a byte in the ASIC, one
' nibble a pixel in our data)
FUNCTION HasPicture(s AS UBYTE, p AS UBYTE) AS UBYTE
  DIM i AS UINTEGER
  DIM b, want AS UBYTE
  FOR i = 0 TO 255
    b = PEEK(@plsprites(0) + CAST(UINTEGER, p) * 128 + (i >> 1))
    IF (i BAND 1) = 0 THEN want = b >> 4 ELSE want = b BAND 15
    IF (PlusPeek($4000 + CAST(UINTEGER, s) * 256 + i) BAND 15) <> want THEN RETURN 0
  NEXT i
  RETURN 1
END FUNCTION

DIM i, k AS UBYTE

PlatInit()
CheckEq("a Plus", PlusAvailable(), 1)
CheckEq("no sprite shown after PlatInit", Shown(), 0)

' --- the palette ---
CheckEq("pen 0 black", GetPalette12(0), $000)
CheckEq("pen 12 deep blue", GetPalette12(12), $027)
CheckEq("border", GetPalette12(16), PL_BORDER)
CheckEq("sprite colour 1", GetPalette12(17), $8FF)

' --- a fresh game: the ship in slot 0, the formation is software ---
GameSeed(1)
gHi = 0
GameInit()
Frame()
CheckEq("one sprite shown: the ship", Shown(), 1)
CheckEq("ship magnified 2x1", Mag(0), 9)
CheckEq("ship x = 4 (16 + 60)", SprX(0), 304)
CheckEq("ship y = 16 + 152", SprY(0), 168)
Check("ship picture", HasPicture(0, 0))

' --- bullets, bombs, explosions go to their slots ---
bl(0) = 20: bl(1) = 100
bl(2) = 40: bl(3) = 90
bm(0) = 30: bm(1) = 50
bm(2) = 60: bm(3) = 20
bm(4) = 70: bm(5) = 30
Boom(80, 80)
Boom(100, 60)
Frame()
CheckEq("ship, 2 bullets, 3 bombs, 2 explosions", Shown(), 8)
CheckEq("bullet 0 in slot 2: x", SprX(2), 144)
CheckEq("bullet 0 in slot 2: y", SprY(2), 116)
CheckEq("bullet 1 in slot 3: x", SprX(3), 224)
CheckEq("bullet 1 in slot 3: y", SprY(3), 106)
Check("bullet picture", HasPicture(2, 3))
CheckEq("bomb 0 in slot 4: x", SprX(4), 184)
CheckEq("bomb 2 in slot 6: y", SprY(6), 46)
Check("bomb picture", HasPicture(5, 4))
CheckEq("explosion 0 in slot 7: x", SprX(7), 4 * (16 + 80))
CheckEq("explosion 0 in slot 7: y is 4 above", SprY(7), 80 + 12)
CheckEq("explosion 1 in slot 8: x", SprX(8), 4 * (16 + 100))
CheckEq("slot 9 unused", Mag(9), 0)
Check("explosion picture frame 0", HasPicture(7, 5))
CheckEq("the formation is not in a slot", Mag(11) + Mag(12) + Mag(13) + Mag(14) + Mag(15), 0)

' --- a picture is loaded when its frame changes, not before ---
PlusPoke($4000 + 256 * 7 + 40, 9)
Frame()
CheckEq("same picture: not loaded again", PlusPeek($4000 + 256 * 7 + 40), 9)
xp(2) = 4                            ' the explosion's timer: frame (6 - 4) >> 1 = 1
Frame()
Check("explosion picture frame 1", HasPicture(7, 6))
xp(2) = 2
Frame()
Check("explosion picture frame 2", HasPicture(7, 7))

' --- gone objects are hidden ---
ClearShots()
Frame()
CheckEq("only the ship is left", Shown(), 1)
CheckEq("ship still there", Mag(0), 9)

' --- the diver (slot 1): two pictures ---
gDive = 2: gDvX = 50: gDvY = 60: gDvPh = 0
Frame()
CheckEq("ship and diver", Shown(), 2)
CheckEq("diver in slot 1: x", SprX(1), 4 * (16 + 50))
CheckEq("diver in slot 1: y", SprY(1), 76)
Check("diver picture 0", HasPicture(1, 1))
gDvPh = 2
Frame()
Check("diver picture 1", HasPicture(1, 2))
gDive = 0

' --- the ship's own explosion replaces the ship ---
gState = S_DYING: gTimer = 30
Frame()
CheckEq("dying ship: the blast alone", Shown(), 1)
CheckEq("ship slot empty", Mag(0), 0)
CheckEq("blast in slot 7", Mag(7), 9)
gState = S_PLAY

' --- more objects than slots: the first ones are shown, the rest dropped ---
PlatFrameBegin()
PlatSprite(K_BULLET, 0, 10, 100)
PlatSprite(K_BULLET, 0, 20, 100)
PlatSprite(K_BULLET, 0, 30, 100)
PlatSprite(K_BOMB, 0, 40, 50)
FOR k = 1 TO 6
  PlatSprite(K_EXPL, 0, 10 * k, 30)
NEXT k
PlatFrameEnd()
CheckEq("2 bullets of 3, 1 bomb, 4 explosions of 6", Shown(), 7)
CheckEq("third bullet dropped, not in a bomb slot", Mag(5), 0)
CheckEq("the first bullet kept its slot", SprX(2), 4 * 26)
CheckEq("the second bullet", SprX(3), 4 * 36)
CheckEq("the bomb kept its slot", SprX(4), 4 * 56)
CheckEq("explosion 4 in slot 10", SprX(10), 4 * 56)

' --- the formation's kinds draw in software and use no slot ---
PlatClear()
CheckEq("PlatClear hides everything", Shown(), 0)
PlatFrameBegin()
PlatSprite(K_ENEMY, 0, 40, 40)
PlatSprite(K_ENEMY + 2, 1, 60, 40)
PlatFrameEnd()
CheckEq("formation: no hardware sprite", Shown(), 0)

PRINT "DONE"
