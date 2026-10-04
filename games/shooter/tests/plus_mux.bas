REM Starfall Plus's multiplexed formation (platform_plus.bas under -D PLUS_MUX, the cartridge
REM build) with the real game logic: the raster handlers' work frame by frame, read back
REM from the ASIC by the handlers themselves (-D MX_TEST: platform_plus_mux.inc logs every
REM call: the row, whether the commit step had finished, the six sprites' X and Y and the
REM row's two colours as the ASIC holds them), the raster table, the sprites' pictures,
REM the software fallback. Bare cartridge on Caprice32 and CPCEC (CPCEC draws the
REM multiplexing, Caprice32 does not, but both run the handlers and keep the registers).
REM Prints "PASS name" / "FAIL name ..." lines and DONE.

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

' ---- access to the layer's test hooks ----
FUNCTION LogB(i AS UINTEGER) AS UBYTE
  ASM
  ld l, (ix+4)
  ld h, (ix+5)
  ld de, MX_TLOG
  add hl, de
  ld a, (hl)
  END ASM
END FUNCTION

FUNCTION LogN() AS UBYTE
  ASM
  ld a, (MX_TCNT)
  END ASM
END FUNCTION

SUB LogReset()
  ASM
  xor a
  ld (MX_TCNT), a
  ld (MX_VIOL), a
  ld (MX_LATE), a
  ld (MX_HCNT), a
  ld hl, MX_TLOG
  ld (MX_TPTR), hl
  END ASM
END SUB

FUNCTION Viol() AS UBYTE
  ASM
  ld a, (MX_VIOL)
  END ASM
END FUNCTION

FUNCTION Late() AS UBYTE
  ASM
  ld a, (MX_LATE)
  END ASM
END FUNCTION

FUNCTION MxOk() AS UBYTE
  ASM
  ld a, (MX_OK)
  END ASM
END FUNCTION

FUNCTION SfCount() AS UBYTE
  ASM
  ld a, (SF_CNT)
  END ASM
END FUNCTION

' the raster table: entry i's line, and the number of entries
FUNCTION RiLine(i AS UBYTE) AS UBYTE
  ASM
  ld a, (ix+5)
  ld e, a
  ld d, 0
  ld hl, .core.RI_LINE
  add hl, de
  ld a, (hl)
  END ASM
END FUNCTION

FUNCTION RiCount() AS UBYTE
  ASM
  ld a, (.core.RI_N)
  END ASM
END FUNCTION

FUNCTION LegsLoads() AS UBYTE
  ASM
  ld a, (MX_T4)
  END ASM
END FUNCTION

' ---- the log: entry k (30 bytes: row, done, 6 x X lo, X hi, Y lo, Y hi, then the colours) ----
FUNCTION LRow(k AS UBYTE) AS UBYTE
  RETURN LogB(CAST(UINTEGER, k) * 30)
END FUNCTION

FUNCTION LDone(k AS UBYTE) AS UBYTE
  RETURN LogB(CAST(UINTEGER, k) * 30 + 1)
END FUNCTION

FUNCTION LX(k AS UBYTE, s AS UBYTE) AS UINTEGER
  DIM b AS UINTEGER
  b = CAST(UINTEGER, k) * 30 + 2 + CAST(UINTEGER, s) * 4
  RETURN CAST(UINTEGER, LogB(b)) + 256 * CAST(UINTEGER, LogB(b + 1))
END FUNCTION

' the Y as 16 bits: 0-255 as is, 65408 (-128) for a hidden sprite
FUNCTION LY(k AS UBYTE, s AS UBYTE) AS UINTEGER
  DIM b AS UINTEGER
  b = CAST(UINTEGER, k) * 30 + 4 + CAST(UINTEGER, s) * 4
  RETURN CAST(UINTEGER, LogB(b)) + 256 * CAST(UINTEGER, LogB(b + 1))
END FUNCTION

FUNCTION LCol(k AS UBYTE, i AS UBYTE) AS UBYTE
  RETURN LogB(CAST(UINTEGER, k) * 30 + 26 + i)
END FUNCTION

CONST HID AS UINTEGER = 65408

SUB Frame()
  PlatFrameBegin()
  GameDraw()
  PlatFrameEnd()
END SUB

' Frames until the layer is steady, then one frame of handlers logged: entries 0-2 =
' rows 1, 2 and the top row again.
SUB Observe()
  DIM i AS UBYTE
  FOR i = 1 TO 3
    Frame()
  NEXT i
  LogReset()
  WaitVsync()
END SUB

' 1 if the three handler entries show rows 1, 2, 3 in order
FUNCTION Order3() AS UBYTE
  IF LogN() < 3 THEN RETURN 0
  IF LRow(0) <> 1 OR LRow(1) <> 2 OR LRow(2) <> 3 THEN RETURN 0
  RETURN 1
END FUNCTION

' the number of mismatches between the logged handler entries and the game's formation
FUNCTION Mismatch() AS UBYTE
  DIM e, r, c, s, bad AS UBYTE
  DIM x AS UINTEGER
  bad = 0
  IF Order3() = 0 THEN RETURN 100
  ' entry e: 0 = row 1 (the middle row, game row 1), 1 = row 2 (game row 0), 2 = the top (game row 2)
  FOR e = 0 TO 2
    IF e = 0 THEN r = 1
    IF e = 1 THEN r = 0
    IF e = 2 THEN r = 2
    s = 0
    FOR c = 0 TO 5
      IF (PEEK(@rm(0) + r) BAND bitv(c)) <> 0 THEN
        x = 4 * (16 + CAST(UINTEGER, FormX(c))) + 0
        IF LX(e, s) <> x THEN bad = bad + 1
        IF LY(e, s) <> CAST(UINTEGER, FormY(r)) + 16 THEN bad = bad + 1
        s = s + 1
      END IF
    NEXT c
    DO WHILE s < 6
      IF LY(e, s) <> HID THEN bad = bad + 1
      s = s + 1
    LOOP
  NEXT e
  RETURN bad
END FUNCTION

' 1 if sprite s of the ASIC holds lines l0..l1 of picture p of plsprites
FUNCTION HasLines(s AS UBYTE, p AS UBYTE, l0 AS UBYTE, l1 AS UBYTE) AS UBYTE
  DIM i AS UINTEGER
  DIM b, want AS UBYTE
  FOR i = CAST(UINTEGER, l0) * 16 TO CAST(UINTEGER, l1) * 16 + 15
    b = PEEK(@plsprites(0) + CAST(UINTEGER, p) * 128 + (i >> 1))
    IF (i BAND 1) = 0 THEN want = b >> 4 ELSE want = b BAND 15
    IF (PlusPeek($4000 + CAST(UINTEGER, s) * 256 + i) BAND 15) <> want THEN RETURN 0
  NEXT i
  RETURN 1
END FUNCTION

FUNCTION AllHave(p AS UBYTE, l0 AS UBYTE, l1 AS UBYTE) AS UBYTE
  DIM s AS UBYTE
  FOR s = 10 TO 15
    IF HasLines(s, p, l0, l1) = 0 THEN RETURN 0
  NEXT s
  RETURN 1
END FUNCTION

DIM i, k, n AS UBYTE
DIM bad, worst AS UINTEGER
DIM inp, st, keys AS UBYTE

PlatInit()
CheckEq("a Plus", PlusAvailable(), 1)
CheckEq("no formation sprite before a frame: raster table empty", RiCount(), 0)
Check("formation sprites hold the alien (frame 0) at the start", AllHave(8, 0, 7))
Check("the alien's lower half is clear", AllHave(8, 8, 15))

' --- a full formation: three rows of six ---
GameSeed(1)
gHi = 0
GameInit()
Observe()
CheckEq("handlers: rows 1, 2, then the top again", Order3(), 1)
CheckEq("formation drawn by the handlers, none in software", SfCount(), 0)
CheckEq("multiplexed", MxOk(), 1)
CheckEq("row 1 slot 0 x", LX(0, 0), 4 * (16 + 20))
CheckEq("row 1 slot 5 x", LX(0, 5), 4 * (16 + 100))
CheckEq("row 1 y = formation y + 12 + 16", LY(0, 0), gFy + 12 + 16)
CheckEq("row 2 y", LY(1, 3), gFy + 24 + 16)
CheckEq("top row y", LY(2, 5), gFy + 16)
CheckEq("no mismatch with the game's formation", Mismatch(), 0)
CheckEq("row 1 colours: body", LCol(0, 0) * 256 + LCol(0, 1), $F403)
CheckEq("row 1 colours: light", LCol(0, 2) * 256 + LCol(0, 3), $F909)
CheckEq("row 2 colours: body", LCol(1, 0) * 256 + LCol(1, 1), $340E)
CheckEq("top row colours: body", LCol(2, 0) * 256 + LCol(2, 1), $EE03)
CheckEq("raster table: four lines and the frame entry", RiCount(), 5)
CheckEq("line of the row 1 handler: 6 below the top row", RiLine(0), gFy + 16 + 6)
CheckEq("line of the row 2 handler", RiLine(1), gFy + 28 + 6)
CheckEq("line of the top row's handler", RiLine(2), gFy + 40 + 6)
CheckEq("line of the legs handler", RiLine(3), gFy + 40 + 6 + 14)
CheckEq("the frame entry stays", RiLine(4), 243)
CheckEq("commit work done before the first handler", Late(), 0)
CheckEq("handlers in order", Viol(), 0)
Check("formation sprites still hold the alien", AllHave(8, 0, 7))

' --- gaps: the formation's sprites are the living ones, left to right ---
rm(2) = 45                           ' columns 0, 2, 3, 5
rm(1) = 0
rm(0) = 18                           ' columns 1, 4
Observe()
CheckEq("gaps: no mismatch", Mismatch(), 0)
CheckEq("gaps: top row's 4th sprite is column 5", LX(2, 3), 4 * (16 + 100))
CheckEq("gaps: top row's 5th sprite hidden", LY(2, 4), HID)
CheckEq("gaps: the empty row hides all", LY(0, 0), HID)
CheckEq("gaps: still four handlers' lines", RiCount(), 5)

' --- the second frame of the aliens: the legs (lines 5-7) are rewritten by the handler ---
rm(0) = 63: rm(1) = 63: rm(2) = 63
n = LegsLoads()
gMoves = 1
Observe()
Check("frame 1: lines 5-7 of all six sprites", AllHave(9, 5, 7))
Check("frame 1: lines 0-4 are the same picture", AllHave(9, 0, 4))
CheckEq("the legs were loaded once", LegsLoads() - n, 1)
Observe()
CheckEq("the legs are not loaded again", LegsLoads() - n, 1)
gMoves = 0
Observe()
Check("frame 0 again: lines 5-7", AllHave(8, 5, 7))
CheckEq("loaded twice in all", LegsLoads() - n, 2)
CheckEq("no mismatch after the flips", Mismatch(), 0)

' --- the other sprites: the ship, a diver, bullets, bombs and 3 explosions (a 4th is dropped) ---
bl(0) = 20: bl(1) = 100
bm(0) = 30: bm(1) = 50
Boom(80, 80)
Boom(100, 60)
Boom(40, 70)
Boom(60, 120)
gDive = 2: gDvX = 50: gDvY = 60: gDvPh = 0
Observe()
CheckEq("ship x", PlusPeek($6000) + 256 * PlusPeek($6001), 4 * (16 + CAST(UINTEGER, gShipX)))
CheckEq("diver in slot 1", PlusPeek($6008) + 256 * PlusPeek($6009), 4 * (16 + 50))
CheckEq("bullet in slot 2", PlusPeek($6010) + 256 * PlusPeek($6011), 4 * (16 + 20))
CheckEq("bomb in slot 4", PlusPeek($6020) + 256 * PlusPeek($6021), 4 * (16 + 30))
CheckEq("explosion in slot 7", PlusPeek($6038) + 256 * PlusPeek($6039), 4 * (16 + 80))
CheckEq("explosion in slot 9", PlusPeek($6048) + 256 * PlusPeek($6049), 4 * (16 + 40))
CheckEq("the 4th explosion is dropped: slot 10 is a formation sprite", Mismatch(), 0)
Check("diver picture", HasLines(1, 1, 0, 7))
Check("explosion picture 0 in slot 7", HasLines(7, 5, 0, 15))
ClearShots()
gDive = 0
xp(2) = 0: xp(5) = 0: xp(8) = 0: xp(11) = 0

' --- the software fallback: whenever the multiplexing cannot show the formation ---
GameInit()
' a row of 7
PlatFrameBegin()
FOR i = 0 TO 6
  PlatSprite(K_ENEMY, 0, 2 * i, 60)
NEXT i
PlatFrameEnd()
CheckEq("7 in a row: software", SfCount(), 7)
CheckEq("7 in a row: not multiplexed", MxOk(), 0)
' rows 8 lines apart
PlatFrameBegin()
PlatSprite(K_ENEMY + 2, 0, 40, 40)
PlatSprite(K_ENEMY + 1, 0, 40, 48)
PlatFrameEnd()
CheckEq("rows 8 lines apart: software", SfCount(), 2)
CheckEq("rows 8 lines apart: not multiplexed", MxOk(), 0)
' one row, two heights
PlatFrameBegin()
PlatSprite(K_ENEMY, 0, 40, 40)
PlatSprite(K_ENEMY, 0, 60, 41)
PlatFrameEnd()
CheckEq("a row at two heights: software", SfCount(), 2)
' too low for the legs handler
PlatFrameBegin()
PlatSprite(K_ENEMY, 0, 40, 180)
PlatFrameEnd()
CheckEq("too low for the legs handler: not multiplexed", MxOk(), 0)
' too far right (x > 175)
PlatFrameBegin()
PlatSprite(K_ENEMY, 0, 180, 60)
PlatFrameEnd()
CheckEq("x out of the ASIC's range: software", SfCount(), 1)
' 25 aliens
PlatFrameBegin()
FOR i = 0 TO 24
  PlatSprite(K_ENEMY + (i MOD 3), 0, 10, 100)
NEXT i
PlatFrameEnd()
Check("more than 24 sprites: software (and not multiplexed)", MxOk() = 0 AND SfCount() > 0)
Observe()
CheckEq("the fallback ends with the next normal frame: multiplexed", MxOk(), 1)
CheckEq("...and nothing in software", SfCount(), 0)

' --- one row only: the other rows' lines are estimated 12 lines apart ---
GameInit()
gFy = 40
rm(2) = 0: rm(1) = 0: rm(0) = 63
Observe()
CheckEq("bottom row only: multiplexed", MxOk(), 1)
CheckEq("bottom row only: Y of its sprites", LY(1, 0), gFy + 24 + 16)
CheckEq("bottom row only: the handler lines follow the geometry", RiLine(0), gFy + 16 + 6)
CheckEq("bottom row only: row 2's line", RiLine(1), gFy + 28 + 6)
CheckEq("bottom row only: legs line", RiLine(3), gFy + 40 + 6 + 14)
Check("bottom row only: the rows without aliens hide", LY(0, 0) = HID AND LY(2, 0) = HID)
CheckEq("bottom row only: handlers in order", Order3(), 1)
' nothing at all
rm(0) = 0
Observe()
Check("no formation: all hidden", LY(0, 0) = HID AND LY(1, 0) = HID AND LY(2, 0) = HID)
CheckEq("no formation: lines kept", RiLine(0), gFy + 16 + 6)

' --- the game itself: 250 steps of the attract mode from wave 3 (dives, bombs, drops):
' every frame, the handlers show the formation of the state just drawn ---
GameInit()
GameSeed(12345)
gWave = 3
NewWave()
PlatClear()
bad = 0: worst = 0
FOR n = 1 TO 250
  PlatFrameBegin()
  keys = PlatInput()
  inp = AttractInput()
  st = GameStep(inp)
  GameDraw()
  PlatFrameEnd()
  LogReset()
  WaitVsync()
  i = Mismatch()
  IF i <> 0 THEN
    bad = bad + 1
    IF worst = 0 THEN worst = n
  END IF
  IF Viol() <> 0 THEN bad = bad + 100
  IF st = S_OVER THEN
    GameInit()
    gWave = 3
    NewWave()
  END IF
NEXT n
CheckEq("250 steps: every frame as the game has it", bad, 0)
CheckEq("250 steps: first bad step (0 = none)", worst, 0)

PRINT "DONE"
